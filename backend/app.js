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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Increase JSON body size limit
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

    // Extract text from PDF using OCR
    const text = await extractTextFromPdf(req.file.path);

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
    const { text, filename } = req.body;

    // Call Groq API for script generation
    const llmResponse = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content:
              "You are an AI that creates natural podcast conversations between two hosts (Host A and Host B) based on provided content.",
          },
          {
            role: "user",
            content: `Create a podcast conversation about the following content. Format as "Host A: [speech]" and "Host B: [speech]" with natural back-and-forth, including an introduction, main discussion points, and conclusion.\n\nContent: ${text.substring(
              0,
              3000
            )}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const scriptData = {
      script: llmResponse.data.choices[0].message.content,
    };

    // Generate audio using voice_service.py (keeping this for now)
    const { spawn } = require("child_process");
    const audioProcess = spawn("python", ["voice_service.py"]);

    let audioOutput = "";

    audioProcess.stdout.on("data", (data) => {
      audioOutput += data.toString();
    });

    audioProcess.on("error", (error) => {
      console.error("Error spawning audio process:", error);
      return res
        .status(500)
        .json({ error: "Failed to generate podcast audio" });
    });

    audioProcess.stdin.write(JSON.stringify(scriptData));
    audioProcess.stdin.end();

    await new Promise((resolve, reject) => {
      audioProcess.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`TTS process exited with code ${code}`));
      });
    });

    let audioData;
    try {
      const trimmedAudioOutput = audioOutput.trim();
      console.log("Raw audio output:", trimmedAudioOutput);
      audioData = JSON.parse(trimmedAudioOutput);
    } catch (e) {
      console.error("Failed to parse audio output:", e.message);
      console.error("Raw audio output:", audioOutput);
      return res.status(500).json({ error: "Invalid audio output" });
    }

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
