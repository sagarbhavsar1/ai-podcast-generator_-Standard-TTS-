const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const { extractTextFromPdf } = require("./ocr-service");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - SINGLE DECLARATIONS ONLY
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 25, // limit each IP to 25 requests per minute (below Groq's 30/min limit)
  message: "Too many requests, please try again later.",
});

// Configure storage for uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "../uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed!"), false);
    }
  },
});

// Ensure directories exist
fs.ensureDirSync("../uploads");
fs.ensureDirSync("../public/podcasts");
fs.ensureDirSync("../temp");

// Routes
app.post("/api/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded" });
    }

    console.log(
      `Processing PDF: ${req.file.originalname} (${req.file.size} bytes)`
    );

    // Extract text from PDF using OCR
    const text = await extractTextFromPdf(req.file.path);

    // Log the extracted text (first 500 chars)
    console.log("Extracted text (preview):", text.substring(0, 500));
    console.log("Total text length:", text.length);
    console.log(
      "Extraction method:",
      text.length > 100 ? "Direct PDF extraction" : "OCR fallback"
    );

    // Return the extracted text
    res.json({
      text: text,
      filename: req.file.filename,
    });
  } catch (error) {
    console.error("Error processing PDF:", error);
    res.status(500).json({ error: "Failed to process PDF" });
  }
});

// Podcast generation endpoint
app.post("/api/generate", apiLimiter, async (req, res) => {
  try {
    const { text, filename, voiceOptions, podcastLength = "medium" } = req.body;

    console.log(`Generating podcast for file: ${filename}`);
    console.log(`Text length: ${text.length} characters`);
    console.log(`Requested podcast length: ${podcastLength}`);

    // Determine max tokens based on requested length
    const lengthTokens = {
      short: 3000,
      medium: 6000,
      long: 9000,
    };

    const maxTokens = lengthTokens[podcastLength] || 6000;

    // Call Groq API for script generation with enhanced prompt
    console.log("Calling Groq API for script generation...");
    const llmResponse = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile", // Use a more capable model
        messages: [
          {
            role: "system",
            content: `You are an expert podcast scriptwriter who creates incredibly natural, conversational scripts between two hosts (Host A and Host B).

Your scripts should:
- Include natural speech patterns with filler words (um, uh, hmm, you know, like)
- Feature realistic interruptions, overlaps, and back-and-forth exchanges
- Incorporate casual asides, personal anecdotes, and humor
- Cover ALL details from the source material thoroughly and in extreme detail
- Include moments where hosts ask questions, express surprise, or disagree slightly
- Sound exactly like two friends having an informed conversation, not a rehearsed presentation
- Have distinct personality differences between Host A (more analytical) and Host B (more enthusiastic)
- Include introduction, detailed discussion of all points, and conclusion
- Be approximately 4,000-6,000 words to create a 20-30 minute podcast

The script should sound like a real podcast conversation, not like an AI-generated script. Make it authentic, engaging, and natural.`,
          },
          {
            role: "user",
            content: `Create a podcast conversation discussing this content in extreme detail. Format as "Host A: [speech]" and "Host B: [speech]". Make it sound genuinely conversational with filler words, interruptions, and natural speech patterns.

The hosts should discuss EVERY detail in the content, leaving nothing out. Make sure the conversation flows naturally while covering all the information.

Content: ${text}`,
          },
        ],
        temperature: 0.8, // Slightly higher temperature for more creative responses
        max_tokens: maxTokens,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Script generated successfully");

    // Apply additional enhancements to make the script more natural
    const enhancedScript = enhanceScript(
      llmResponse.data.choices[0].message.content
    );

    const scriptData = {
      script: enhancedScript,
    };

    // Generate audio using voice_service.py
    console.log("Generating audio with Kokoro TTS...");
    const { spawn } = require("child_process");
    const audioProcess = spawn("python", ["voice_service.py"]);

    let audioOutput = "";

    audioProcess.stdout.on("data", (data) => {
      audioOutput += data.toString();
    });

    audioProcess.stderr.on("data", (data) => {
      console.error(`TTS Error: ${data.toString()}`);
    });

    audioProcess.on("error", (error) => {
      console.error("Error spawning audio process:", error);
      return res
        .status(500)
        .json({ error: "Failed to generate podcast audio" });
    });

    // Pass voice options if provided
    const inputData = {
      script: scriptData.script,
      voices: voiceOptions || { hostA: "am_adam", hostB: "bf_emma" },
    };

    audioProcess.stdin.write(JSON.stringify(inputData));
    audioProcess.stdin.end();

    await new Promise((resolve, reject) => {
      audioProcess.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`TTS process exited with code ${code}`));
      });
    });

    let audioData;
    try {
      // Look for the last line that contains valid JSON
      const lines = audioOutput.trim().split("\n");
      let jsonLine = "";
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim().startsWith("{")) {
          jsonLine = lines[i];
          break;
        }
      }

      if (jsonLine) {
        audioData = JSON.parse(jsonLine);
        console.log("Parsed audio data:", audioData);
      } else {
        throw new Error("No valid JSON found in output");
      }
    } catch (e) {
      console.error("Failed to parse audio output:", e.message);
      console.error("Raw audio output:", audioOutput);
      return res.status(500).json({ error: "Invalid audio output" });
    }

    console.log(`Podcast generated successfully: ${audioData.audio_file}`);

    // Return podcast data
    res.json({
      script: scriptData.script,
      audioUrl: `/podcasts/${path.basename(audioData.audio_file)}`,
    });
  } catch (error) {
    console.error("Error generating podcast:", error);
    res.status(500).json({ error: "Failed to generate podcast" });
  }
});

// Serve static files from the public directory
app.use(
  "/podcasts",
  express.static(path.join(__dirname, "../public/podcasts"))
);

// Basic health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "Server is running" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
