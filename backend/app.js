const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const { extractTextFromPdf } = require("./tessaractOCR");
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

// Function to optimize script for TTS
function optimizeScriptForTTS(script) {
  // Split into lines
  const lines = script.split("\n");
  const optimizedLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // Skip lines that are just stage directions
    if (line.startsWith("[") && line.endsWith("]")) continue;

    // Extract speaker and text
    const parts = line.split(":", 1);
    if (parts.length < 2) {
      optimizedLines.push(line);
      continue;
    }

    const speaker = parts[0].trim();
    let text = line.substring(parts[0].length + 1).trim();

    // Break very long sentences into shorter ones
    if (text.length > 150) {
      const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
      text = sentences.join(" ");
    }

    // Add pauses at natural breaks
    text = text.replace(/\. /g, ". [pause] ");
    text = text.replace(/\! /g, "! [pause] ");
    text = text.replace(/\? /g, "? [pause] ");

    // Add the optimized line
    optimizedLines.push(`${speaker}: ${text}`);
  }

  return optimizedLines.join("\n");
}

// Function to split text into manageable chunks
function splitTextIntoChunks(text, chunkSize = 8000) {
  // If text is smaller than chunk size, return it as is
  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    // Find a good breaking point (end of sentence) near the chunk size
    let endIndex = Math.min(startIndex + chunkSize, text.length);

    // If we're not at the end of the text, try to find the end of a sentence
    if (endIndex < text.length) {
      // Look for the last period, question mark, or exclamation point
      const lastPeriod = text.lastIndexOf(".", endIndex);
      const lastQuestion = text.lastIndexOf("?", endIndex);
      const lastExclamation = text.lastIndexOf("!", endIndex);

      // Find the maximum of these positions
      const maxPunctuation = Math.max(
        lastPeriod,
        lastQuestion,
        lastExclamation
      );

      // If we found a sentence end, use it as the breaking point
      if (maxPunctuation > startIndex) {
        endIndex = maxPunctuation + 1;
      }
    }

    // Add the chunk to our array
    chunks.push(text.substring(startIndex, endIndex));

    // Move to the next chunk
    startIndex = endIndex;
  }

  return chunks;
}

// Function to process a single chunk with Groq API with retry logic
async function processChunkWithGroq(
  chunk,
  isFirstChunk,
  isLastChunk,
  podcastLength,
  chunkNumber,
  totalChunks
) {
  const lengthTokens = {
    short: 3000,
    medium: 6000,
    long: 9000,
  };

  const maxTokens = lengthTokens[podcastLength] || 6000;

  // Adjust system prompt based on chunk position
  let systemPrompt = `You are the world's best podcast script creator. You transform written content into authentic, engaging conversations between two hosts (Host A and Host B) that sound EXACTLY like real podcasts.

Your podcast scripts should:

1. Be genuinely conversational - not scripted-sounding narration taking turns
2. Include natural speech patterns with appropriate filler words ("um", "like", "you know") but use them sparingly
3. Feature hosts interrupting each other, finishing each other's sentences, and building on ideas
4. Include emotional reactions with clear tone indicators ("Wow!" [excited], "That's fascinating!" [curious], "Wait, really?" [surprised])
5. Have hosts ask each other questions to drive the conversation forward
6. Include brief personal anecdotes or examples that relate to the content
7. Have distinct personalities: Host A is more analytical and detail-oriented, Host B is more enthusiastic and asks clarifying questions
8. Discuss EVERY detail from the source material, even small points, exploring them thoroughly
9. Include tangents and side discussions that naturally emerge from the content
10. Feature moments of humor, surprise, or disagreement between hosts
11. Use concise, clear sentences that are easy to speak aloud - avoid complex, run-on sentences`;

  // Adjust user prompt based on chunk position
  let userPrompt;

  if (isFirstChunk && isLastChunk) {
    // Single chunk - complete podcast
    userPrompt = `Create a complete podcast script from the following PDF content. The script should be a natural conversation between Host A and Host B that thoroughly discusses EVERY detail and nuance in the content.

Include a proper introduction at the beginning and a conclusion at the end.

PDF Content: ${chunk}`;
  } else if (isFirstChunk) {
    // First chunk - include introduction
    userPrompt = `Create the beginning of a podcast script from the following PDF content (this is part 1 of ${totalChunks} parts). The script should be a natural conversation between Host A and Host B.

Start with a proper introduction to the topic and the hosts. This is just the beginning of the podcast, so don't conclude the discussion.

PDF Content (Part 1/${totalChunks}): ${chunk}`;
  } else if (isLastChunk) {
    // Last chunk - include conclusion
    userPrompt = `Continue a podcast script from the following PDF content (this is part ${chunkNumber} of ${totalChunks} parts). The script should be a natural conversation between Host A and Host B.

This is the final part of the podcast, so include a proper conclusion that wraps up the entire discussion.

PDF Content (Part ${chunkNumber}/${totalChunks}): ${chunk}`;
  } else {
    // Middle chunk - continue conversation
    userPrompt = `Continue a podcast script from the following PDF content (this is part ${chunkNumber} of ${totalChunks} parts). The script should be a natural conversation between Host A and Host B.

This is a continuation of an ongoing podcast, so don't introduce the topic again or conclude the discussion.

PDF Content (Part ${chunkNumber}/${totalChunks}): ${chunk}`;
  }

  // Implement retry logic with exponential backoff
  const maxRetries = 5;
  let retryCount = 0;
  let retryDelay = 3000; // Start with 3 second delay, can also do 2500 i.e 2.5 seconds

  while (retryCount <= maxRetries) {
    try {
      console.log(
        `Attempting to process chunk ${chunkNumber}/${totalChunks} (Attempt ${
          retryCount + 1
        }/${maxRetries + 1})`
      );

      // Call Groq API
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
          temperature: 0.7,
          max_tokens: maxTokens,
          top_p: 0.9,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(`Successfully processed chunk ${chunkNumber}/${totalChunks}`);
      return response.data.choices[0].message.content;
    } catch (error) {
      retryCount++;

      // Check if it's a rate limit error (429)
      if (error.response && error.response.status === 429) {
        // Get retry-after header if available
        const retryAfter = error.response.headers["retry-after"];
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : retryDelay;

        console.log(
          `Rate limit exceeded. Waiting ${
            waitTime / 1000
          } seconds before retrying...`
        );

        // Wait for the specified time
        await new Promise((resolve) => setTimeout(resolve, waitTime));

        // Increase the delay for next potential retry (exponential backoff)
        retryDelay = retryDelay * 2;
      } else if (retryCount <= maxRetries) {
        // For other errors, also retry with backoff
        console.log(
          `Error processing chunk: ${error.message}. Retrying in ${
            retryDelay / 1000
          } seconds...`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        retryDelay = retryDelay * 2;
      } else {
        // If we've exhausted all retries, throw the error
        throw error;
      }
    }
  }

  throw new Error(
    `Failed to process chunk ${chunkNumber} after ${maxRetries} retries`
  );
}

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

    // Determine target length based on content size
    let targetLength;
    if (text.length < 2000) {
      targetLength = "short"; // 10-15 minutes
    } else if (text.length < 5000) {
      targetLength = "medium"; // 15-25 minutes
    } else {
      targetLength = "long"; // 25-35 minutes
    }

    // Override with user preference if provided
    if (podcastLength) {
      targetLength = podcastLength;
    }

    // Split text into manageable chunks to avoid payload size limits
    const CHUNK_SIZE = 8000; // Adjust this value based on Groq's limits
    const chunks = splitTextIntoChunks(text, CHUNK_SIZE);

    console.log(`Split content into ${chunks.length} chunks for processing`);

    // Process each chunk sequentially
    let completeScript = "";

    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1} of ${chunks.length}...`);

      const isFirstChunk = i === 0;
      const isLastChunk = i === chunks.length - 1;

      // Process this chunk with retry logic
      const chunkScript = await processChunkWithGroq(
        chunks[i],
        isFirstChunk,
        isLastChunk,
        targetLength,
        i + 1,
        chunks.length
      );

      // Add to complete script
      completeScript += chunkScript + "\n\n";

      // Add a standard delay between chunks to avoid rate limits
      // Even if we didn't hit a rate limit, this helps prevent them
      if (!isLastChunk) {
        console.log("Adding standard delay between chunks (3 seconds)...");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    console.log("Script generation completed successfully");

    // Optimize the script for TTS
    const optimizedScript = optimizeScriptForTTS(completeScript);

    const scriptData = {
      script: optimizedScript,
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
      voices: voiceOptions || { hostA: "af_bella", hostB: "am_echo" }, // Updated to bella and echo
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
