const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs-extra");
const path = require("path");
const { spawn } = require("child_process");
const { extractTextFromPdf } = require("./ocr-service");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
app.post("/api/generate", async (req, res) => {
  try {
    const { text, filename } = req.body;

    // Generate script using LLM
    const scriptProcess = spawn("python", ["llm_service.py"]);

    let scriptOutput = "";

    scriptProcess.stdout.on("data", (data) => {
      scriptOutput += data.toString();
    });

    scriptProcess.on("error", (error) => {
      console.error("Error spawning script process:", error);
      return res
        .status(500)
        .json({ error: "Failed to generate podcast script" });
    });

    scriptProcess.stdin.write(text);
    scriptProcess.stdin.end();

    await new Promise((resolve, reject) => {
      scriptProcess.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`LLM process exited with code ${code}`));
      });
    });

    let scriptData;
    try {
      // Trim any whitespace and ensure we're parsing valid JSON
      const trimmedOutput = scriptOutput.trim();
      console.log("Raw script output:", trimmedOutput);
      scriptData = JSON.parse(trimmedOutput);
    } catch (e) {
      console.error("Failed to parse script output:", e.message);
      console.error("Raw output:", scriptOutput);
      return res.status(500).json({ error: "Invalid script output" });
    }

    // Generate audio using TTS
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
