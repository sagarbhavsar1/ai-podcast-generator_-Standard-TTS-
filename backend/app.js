const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const { extractTextFromPdf } = require("./tessaractOCR");
const { synthesizeSpeech, getVoices } = require("./aws_polly_tts");
const { analyzeScript } = require("./scriptEnhancer");
const config = require("./config");
const debugHelper = require("./debug-helper");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - SINGLE DECLARATIONS ONLY
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Serve static frontend files from the 'frontend/dist' or 'frontend/build' directory if it exists
const frontendPath = path.join(__dirname, "../frontend/dist");
const altFrontendPath = path.join(__dirname, "../frontend/build");

if (fs.existsSync(frontendPath)) {
  console.log("Serving frontend from:", frontendPath);
  app.use(express.static(frontendPath));
} else if (fs.existsSync(altFrontendPath)) {
  console.log("Serving frontend from:", altFrontendPath);
  app.use(express.static(altFrontendPath));
} else {
  // If no frontend build exists, serve a simple HTML landing page at root
  app.get("/", (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>PDFcast API Server</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
            h1 { color: #333; }
            .endpoint { background: #f4f4f4; padding: 10px; border-radius: 4px; margin-bottom: 10px; }
            code { background: #eee; padding: 2px 4px; border-radius: 3px; }
          </style>
        </head>
        <body>
          <h1>PDFcast API Server</h1>
          <p>Your API server is running successfully!</p>

          <h2>Available Endpoints:</h2>
          <div class="endpoint"><code>POST /api/upload</code> - Upload a PDF file</div>
          <div class="endpoint"><code>POST /api/generate</code> - Generate a podcast from text</div>
          <div class="endpoint"><code>GET /api/health</code> - Server health check</div>
          <div class="endpoint"><code>GET /podcasts/:filename</code> - Stream a generated podcast</div>

          <p>For the frontend UI, clone and deploy the frontend repository or use the API directly.</p>
        </body>
      </html>
    `);
  });
}

// Validate required API keys at startup
console.log("Checking required API keys...");
if (!process.env.GROQ_API_KEY) {
  console.error("⚠️ GROQ_API_KEY environment variable is missing!");
}

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error("⚠️ AWS credentials are missing!");
}

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per minute (Groq's limit)
  message: "Too many requests, please try again later.",
});

// Define fixed podcast duration (10-15 min range) hard cap concept
const TARGET_PODCAST_DURATION = 12; // Target 12 minutes (middle of 10-15 range)

// Constants for optimized processing
const MAX_CONCURRENT_REQUESTS = 3; // Reduced from 5 to avoid rate limits
const MIN_REQUEST_INTERVAL = 1500; // Increased from 1000ms to 1500ms
const OPTIMAL_CHUNK_SIZE = 10000; // Increased from 6000 to 10000
const MAX_CHUNK_COUNT = 12; // New constant to limit total chunks

// UPDATED: Safe max chunk size for Groq API (6000 tokens × 3.5 chars-per-token × 0.9 margin)
const GROQ_MAX_TOKENS = 6000;
const GROQ_SAFE_CHARS_PER_TOKEN = 3.5; // Conservative estimate
const GROQ_MAX_CHUNK_CHARS = Math.floor(
  GROQ_MAX_TOKENS * GROQ_SAFE_CHARS_PER_TOKEN * 0.9
); // 90% margin

// Words per minute for speech calculation - adjusted for Kokoro TTS's actual speed
const WORDS_PER_MINUTE = 214; // Adjusted based on production data

// Function to calculate target word count based on duration
function calculateTargetWordCount(durationMinutes) {
  return durationMinutes * WORDS_PER_MINUTE;
}

// Function to count words in a script
function countWords(script) {
  if (!script) return 0;
  return script
    .replace(/\[.*?\]/g, "") // Remove stage directions
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

// Modified function to verify if script meets target duration with better logging
function verifyScriptDuration(script) {
  const wordCount = countWords(script);
  const estimatedMinutes = wordCount / WORDS_PER_MINUTE;
  const varianceMinutes = 5; // How much we allow duration to vary from target
  const isWithinRange =
    Math.abs(estimatedMinutes - TARGET_PODCAST_DURATION) <= varianceMinutes;

  return {
    wordCount,
    estimatedMinutes,
    targetMinutes: TARGET_PODCAST_DURATION,
    varianceAllowed: varianceMinutes,
    acceptableRange: `${TARGET_PODCAST_DURATION - varianceMinutes}-${
      TARGET_PODCAST_DURATION + varianceMinutes
    } minutes`,
    isWithinRange,
  };
}

// Function to validate if text is an actual podcast script
function isValidPodcastScript(text) {
  // Check if the text contains Host A and Host B patterns
  const hostAPattern = /Host A:/i;
  const hostBPattern = /Host B:/i;

  // It must contain dialogue from both hosts
  if (!hostAPattern.test(text) || !hostBPattern.test(text)) {
    return false;
  }

  // Check that it's not just instructions
  const instructionPatterns = [
    /step 1:/i,
    /identify unnecessary/i,
    /simplify analytical/i,
    /streamline host/i,
    /approach to condensing/i,
    /word count monitoring/i,
  ];

  for (const pattern of instructionPatterns) {
    if (pattern.test(text)) {
      return false;
    }
  }

  return true;
}

// Ensure all required directories exist
(async () => {
  try {
    await config.ensureDirectories();
    console.log("Storage directories initialized successfully");
  } catch (err) {
    console.error("Failed to initialize storage directories:", err);
    process.exit(1);
  }
})();

// Configure storage for uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOADS_DIR);
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

    // Add pauses at natural breaks with context-specific pause lengths
    text = text.replace(/\. /g, ". [pause] "); // End of statement
    text = text.replace(/\! /g, "! [longpause] "); // Emotional emphasis
    text = text.replace(/\? /g, "? [longpause] "); // Question pause

    // Add mid-sentence pauses with shorter duration
    text = text.replace(/, /g, ", [shortpause] "); // Comma pause
    text = text.replace(/; /g, "; [mediumpause] "); // Semicolon pause

    // Add pauses for rhetorical effect
    text = text.replace(/\.\.\. /g, "... [longerpause] "); // Ellipsis for dramatic effect

    // Add natural hesitation patterns
    text = text.replace(/(\b(?:well|um|uh|so)\b)( )/gi, "$1 [tinypause] ");

    // Add the optimized line
    optimizedLines.push(`${speaker}: ${text}`);
  }

  return optimizedLines.join("\n");
}

// Improved splitTextIntoChunks function
function splitTextIntoChunks(text) {
  // If text is very small, return it as is
  if (text.length < OPTIMAL_CHUNK_SIZE) {
    return [text];
  }

  // Calculate minimum number of chunks needed based on text length
  const minChunksNeeded = Math.ceil(text.length / OPTIMAL_CHUNK_SIZE);
  // Use actual chunks needed but cap at MAX_CHUNK_COUNT
  const targetChunks = Math.min(minChunksNeeded, MAX_CHUNK_COUNT);

  console.log(
    `Planning to split content into approximately ${targetChunks} chunks`
  );

  // Calculate target chunk size - larger than before to reduce chunks
  let targetChunkSize = Math.ceil(text.length / targetChunks);

  // Enforce Groq API max chunk size
  if (targetChunkSize > GROQ_MAX_CHUNK_CHARS) {
    console.warn(
      `Target chunk size (${targetChunkSize}) exceeds Groq API safe limit (${GROQ_MAX_CHUNK_CHARS}). Reducing.`
    );
    targetChunkSize = GROQ_MAX_CHUNK_CHARS;
  }

  const chunks = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    // Aim for target chunk size but don't exceed text length
    const idealEndIndex = startIndex + targetChunkSize;
    let endIndex = Math.min(idealEndIndex, text.length);

    // If we're not at the end, find a good breaking point
    if (endIndex < text.length) {
      // Search for break points within the last 20% of the chunk
      const searchWindowStart = Math.max(
        startIndex,
        endIndex - Math.floor(targetChunkSize * 0.2)
      );

      // Look for paragraph breaks first (double newline)
      const paragraphBreak = text.lastIndexOf("\n\n", endIndex);
      if (paragraphBreak > searchWindowStart) {
        endIndex = paragraphBreak + 2;
      } else {
        // Then look for single newline
        const lineBreak = text.lastIndexOf("\n", endIndex);
        if (lineBreak > searchWindowStart) {
          endIndex = lineBreak + 1;
        } else {
          // Then look for end of sentence
          const lastPeriod = text.lastIndexOf(".", endIndex);
          const lastQuestion = text.lastIndexOf("?", endIndex);
          const lastExclamation = text.lastIndexOf("!", endIndex);

          const maxPunctuation = Math.max(
            lastPeriod,
            lastQuestion,
            lastExclamation
          );

          if (maxPunctuation > searchWindowStart) {
            endIndex = maxPunctuation + 1;
          } else {
            // If all else fails, just use a space
            const lastSpace = text.lastIndexOf(" ", endIndex);
            if (lastSpace > searchWindowStart) {
              endIndex = lastSpace + 1;
            }
          }
        }
      }
    }

    // Add the chunk to our array
    const chunk = text.substring(startIndex, endIndex);
    if (chunk.length > GROQ_MAX_CHUNK_CHARS) {
      console.warn(
        `Chunk length (${chunk.length}) exceeds Groq API safe limit (${GROQ_MAX_CHUNK_CHARS}). Truncating.`
      );
      chunks.push(chunk.substring(0, GROQ_MAX_CHUNK_CHARS));
      startIndex += GROQ_MAX_CHUNK_CHARS;
    } else {
      chunks.push(chunk);
      startIndex = endIndex;
    }

    // Safety check - if we've hit MAX_CHUNK_COUNT and there's still text, combine the rest
    if (chunks.length === MAX_CHUNK_COUNT - 1 && startIndex < text.length) {
      chunks.push(text.substring(startIndex));
      break;
    }
  }

  console.log(
    `Split content into ${chunks.length} chunks (average size: ${Math.round(
      text.length / chunks.length
    )} chars)`
  );
  return chunks;
}

// Request queue manager for rate limiting
class RequestQueue {
  constructor(maxConcurrent = 5, minInterval = 1000) {
    this.queue = [];
    this.activeRequests = 0;
    this.maxConcurrent = maxConcurrent;
    this.minInterval = minInterval;
    this.lastRequestTime = 0;
  }

  async add(requestFn) {
    return new Promise((resolve, reject) => {
      const execRequest = async () => {
        this.activeRequests++;

        // Ensure minimum time between requests
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minInterval) {
          await new Promise((r) =>
            setTimeout(r, this.minInterval - timeSinceLastRequest)
          );
        }

        try {
          this.lastRequestTime = Date.now();
          const result = await requestFn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.activeRequests--;
          this.processQueue();
        }
      };

      this.queue.push(execRequest);
      this.processQueue();
    });
  }

  processQueue() {
    if (this.queue.length === 0) return;
    if (this.activeRequests >= this.maxConcurrent) return;

    const nextRequest = this.queue.shift();
    nextRequest();
  }
}

// Function to process a single chunk with Groq API with retry logic (used as fallback)
async function processChunkWithGroq(
  chunk,
  isFirstChunk,
  isLastChunk,
  chunkNumber,
  totalChunks,
  targetWordCount
) {
  // NEW: Prevent sending oversized chunks to Groq API
  if (chunk.length > GROQ_MAX_CHUNK_CHARS) {
    console.error(
      `Refusing to send chunk ${chunkNumber} (length ${chunk.length}) to Groq API: exceeds safe limit (${GROQ_MAX_CHUNK_CHARS} chars)`
    );
    throw new Error(
      `Chunk ${chunkNumber} too large for Groq API (length: ${chunk.length} chars)`
    );
  }

  // Calculate per-chunk word count
  const totalTargetWords = targetWordCount;

  // Allocate words more intelligently across chunks
  const baseWordsPerChunk = Math.floor(totalTargetWords / totalChunks);

  // Improved word budget allocation
  let chunkWordCount;
  if (isFirstChunk) {
    chunkWordCount = Math.floor(baseWordsPerChunk * 1.15); // 15% more for intro
  } else if (isLastChunk) {
    chunkWordCount = Math.floor(baseWordsPerChunk * 1.15); // 15% more for conclusion
  } else {
    // Consider content density for middle chunks
    if (chunkNumber <= Math.ceil(totalChunks / 2)) {
      // First half chunks get a bit more words since they usually contain more core content
      chunkWordCount = Math.floor(baseWordsPerChunk * 1.05); // 5% more for first half
    } else {
      // Later chunks typically have less dense content, so they get fewer words
      chunkWordCount = Math.floor(baseWordsPerChunk * 0.9); // 10% less for second half
    }
  }

  const maxTokens = 10000;

  // Adjust system prompt based on chunk position
  let systemPrompt = `You are the world's best podcast script creator. You transform written content into authentic, engaging conversations between two hosts (Ashley and Ric) that sound EXACTLY like real podcasts.

Your podcast scripts must have these characteristics:
1. Genuinely conversational with natural speech patterns, not scripted-sounding narration
2. Include casual language with contractions, filler words ("um", "y'know", "like"), and slang (use sparingly)
3. Feature hosts interrupting each other, finishing each other's sentences, and building on ideas
4. Include emotional reactions with tone indicators ("Wow!" [excited], "Wait, really?" [surprised], "Hmm..." [thoughtful])
5. Have hosts ask each other questions and respond authentically, not just taking turns making statements
6. Include brief personal anecdotes that relate to the content ("This reminds me of when I...")
7. Have distinct personalities: Ashley is more analytical and uses occasional jargon; Ric is more relatable and simplifies concepts
8. Include moments where hosts respectfully disagree or offer different perspectives
9. Use authentic back-channeling responses that show active listening ("right", "exactly", "oh wow")

NEVER include:
- References to "subscribing" or "following" the podcast
- Mentions of "next episode" or "series"
- Generic podcast language about "tune in next time"
- Any indication this is part ${chunkNumber}/${totalChunks} of a podcast script. Your chunk MUST be EXACTLY ${chunkWordCount} words. No more, no less.`;

  // Adjust user prompt based on chunk position
  let userPrompt;

  if (isFirstChunk && isLastChunk) {
    // Single chunk - complete podcast
    userPrompt = `Create a complete podcast script from the following PDF content. Your script must be a natural conversation between Ashley and Ric that covers the most important points.

Include an authentic introduction at the beginning and a content-focused conclusion at the end that offers final insights, NOT generic "subscribe and follow" language.

Make the hosts sound like real people having a genuine conversation - include interruptions, casual language, brief tangents, and authentic reactions.

IMPORTANT: Your script MUST be EXACTLY ${chunkWordCount} words. Focus only on the MOST important information and themes.

PDF Content: ${chunk}`;
  } else if (isFirstChunk) {
    // First chunk - include introduction
    userPrompt = `Create the first part of a podcast script from the following PDF content. Your script must be a natural, authentic conversation between Ashley and Ric.

Start with a casual, engaging introduction where the hosts welcome listeners and introduce the topic in a conversational way. This is just the beginning of the podcast, so don't conclude the discussion.

Make the hosts sound like real people - include filler words, casual language, and authentic reactions to each other.

IMPORTANT: Your script MUST be EXACTLY ${chunkWordCount} words. Focus on setting up the topic and introducing key concepts from the beginning of the document.

PDF Content (Beginning): ${chunk}`;
  } else if (isLastChunk) {
    // Last chunk - include conclusion
    userPrompt = `Create the final part of a podcast script from the following PDF content. Your script must be a natural conversation between Ashley and Ric.

This is the FINAL part of the podcast, so include a proper conclusion that wraps up the entire discussion naturally. Focus on content-specific insights and takeaways - DO NOT include generic "subscribe" language or references to "future episodes."

End with thought-provoking comments or questions about the topic itself, not podcast promotion.

IMPORTANT: Your script MUST be EXACTLY ${chunkWordCount} words. Focus on bringing the discussion to a natural conclusion that doesn't feel rushed or abrupt.

PDF Content (Ending): ${chunk}`;
  } else {
    // Middle chunk - continue conversation
    userPrompt = `Continue a podcast script from the following PDF content. Your script must be a natural conversation between Ashley and Ric.

This is part ${chunkNumber} of ${totalChunks} of an ongoing podcast, so don't introduce the topic again or conclude the discussion.

Maintain the conversational flow with interruptions, casual language, emotional reactions, and authentic dialogue. Have the hosts build on each other's points and occasionally challenge or question each other in a friendly way.

IMPORTANT: Your script MUST be EXACTLY ${chunkWordCount} words. Focus only on the most important points in this section of content.

PDF Content (Middle Section): ${chunk}`;
  }

  // Implement improved retry logic with exponential backoff and jitter
  const maxRetries = 5;
  let retryCount = 0;
  let retryDelay = 2000; // Start with 2 seconds delay

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
          model: "deepseek-r1-distill-llama-70b",
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
          max_tokens: 10000,
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

      // Remove <think> tags if present in the response
      let content = response.data.choices[0].message.content;
      content = content.replace(/<think>[\s\S]*?<\/think>/g, "");

      return content;
    } catch (error) {
      retryCount++;

      // Check if it's a rate limit error (429)
      if (error.response && error.response.status === 429) {
        // Get retry-after header if available
        const retryAfter = error.response.headers["retry-after"];
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : retryDelay;

        // Add jitter to avoid thundering herd problem (±20%)
        const jitter = waitTime * (0.8 + Math.random() * 0.4);

        console.log(
          `Rate limit exceeded. Waiting ${
            Math.round(jitter / 100) / 10
          } seconds before retrying...`
        );

        await new Promise((resolve) => setTimeout(resolve, jitter));
        retryDelay = Math.min(retryDelay * 1.5, 30000); // Cap at 30 seconds
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

// Function to trim script while preserving structure
function trimScriptPreservingStructure(script, maxWordCount) {
  // If already under limit, return as is
  const currentWordCount = countWords(script);
  if (currentWordCount <= maxWordCount) {
    return script;
  }

  console.log(
    `Smart trimming script from ${currentWordCount} to ${maxWordCount} words`
  );

  const lines = script.split("\n");
  const resultLines = [];
  let wordsAdded = 0;

  // Identify introduction and conclusion sections
  const introLines = Math.min(10, Math.floor(lines.length * 0.15)); // First 15% or max 10 lines
  const conclusionStart = Math.max(
    lines.length - 15,
    Math.floor(lines.length * 0.85)
  ); // Last 15% or last 15 lines

  // Process the script in sections (intro, middle, conclusion)
  // Always include the intro
  for (let i = 0; i < introLines; i++) {
    if (lines[i].trim()) {
      resultLines.push(lines[i]);
      wordsAdded += countWords(lines[i]);
    } else {
      resultLines.push(""); // Keep empty lines
    }
  }

  // Add middle section, limiting words
  let maxMiddleWords = Math.floor(maxWordCount * 0.7); // 70% of words for middle section
  for (let i = introLines; i < conclusionStart; i++) {
    if (!lines[i].trim()) {
      resultLines.push(""); // Keep empty lines
      continue;
    }

    const lineWords = countWords(lines[i]);
    if (wordsAdded + lineWords <= maxMiddleWords) {
      resultLines.push(lines[i]);
      wordsAdded += lineWords;
    } else {
      resultLines.push(""); // Keep empty lines
    }
  }

  // Always include conclusion
  for (let i = conclusionStart; i < lines.length; i++) {
    if (lines[i].trim()) {
      resultLines.push(lines[i]);
      wordsAdded += countWords(lines[i]);
    } else {
      resultLines.push(""); // Keep empty lines
    }
  }

  // Check if we need to add a conclusion
  const lastLines = resultLines.slice(-5).join(" ").toLowerCase();
  const conclusionPatterns = [
    "wrap up",
    "conclude",
    "to sum up",
    "in conclusion",
    "thank you for listening",
    "thanks for joining",
    "until next time",
  ];
  const hasConclusion = conclusionPatterns.some((pattern) =>
    lastLines.includes(pattern)
  );

  if (!hasConclusion) {
    // Add a natural conclusion
    resultLines.push("");
    resultLines.push(
      "Ashley: Well, that brings us to the end of our discussion today. We covered a lot of ground on this fascinating topic."
    );
    resultLines.push(
      "Ric: Absolutely! I really enjoyed our conversation. There's so much depth to this subject, and I feel like we've given our listeners a good overview of the key points."
    );
    resultLines.push(
      "Ashley: If you found this interesting, we encourage you to dive deeper into some of the concepts we covered today."
    );
    resultLines.push(
      "Ric: Thanks for joining us, and we hope you'll tune in next time for more engaging discussions!"
    );
  }

  return resultLines.join("\n");
}

// New function to replace Host A/B with Ashley/Ric in scripts
function replaceHostNamesInScript(script) {
  return script.replace(/Host A:/gi, "Ashley:").replace(/Host B:/gi, "Ric:");
}

// Original function to remove script metadata (title, section markers) and start directly with host dialogue
function cleanScriptMetadata(script) {
  // Split the script into lines
  const lines = script.split("\n");

  // Find the first actual dialogue line (starting with "Ashley:" or "Ric:" or "Host A:" or "Host B:")
  const firstDialogueIndex = lines.findIndex((line) =>
    /^(Ashley|Ric|Host A|Host B):/i.test(line.trim())
  );

  // If we found a dialogue line, remove everything before it
  if (firstDialogueIndex > 0) {
    console.log(`Removing ${firstDialogueIndex} metadata lines from script`);
    return lines.slice(firstDialogueIndex).join("\n");
  }

  // If no dialogue found, return the original script
  return script;
}

// Add detailed environment logging at startup
console.log("Environment configuration:");
console.log(`- PORT: ${PORT}`);
console.log(`- NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`- UPLOADS_DIR: ${config.UPLOADS_DIR}`);
console.log(`- TEMP_DIR: ${config.TEMP_DIR}`);
console.log(`- OUTPUT_DIR: ${config.OUTPUT_DIR}`);

// Improved directory setup with error handling
(async () => {
  try {
    // Check each directory with detailed permissions info
    const uploadsDirCheck = await debugHelper.checkDirectoryPermissions(
      config.UPLOADS_DIR
    );
    const tempDirCheck = await debugHelper.checkDirectoryPermissions(
      config.TEMP_DIR
    );
    const outputDirCheck = await debugHelper.checkDirectoryPermissions(
      config.OUTPUT_DIR
    );

    console.log("Directory permissions check:");
    console.log(
      `- UPLOADS_DIR: ${
        uploadsDirCheck.success ? "OK" : "FAILED - " + uploadsDirCheck.error
      }`
    );
    console.log(
      `- TEMP_DIR: ${
        tempDirCheck.success ? "OK" : "FAILED - " + tempDirCheck.error
      }`
    );
    console.log(
      `- OUTPUT_DIR: ${
        outputDirCheck.success ? "OK" : "FAILED - " + outputDirCheck.error
      }`
    );

    if (
      !uploadsDirCheck.success ||
      !tempDirCheck.success ||
      !outputDirCheck.success
    ) {
      console.error("⚠️ WARNING: Directory permission issues detected!");
    } else {
      console.log("✅ All directory permissions verified successfully");
    }
  } catch (err) {
    console.error("Failed to initialize storage directories:", err);
  }
})();

// Fix the upload route
app.post("/api/upload", (req, res) => {
  console.log("Upload request received");

  // Use single handler function for better error tracking
  upload.single("pdf")(req, res, async (err) => {
    try {
      if (err) {
        console.error("Multer upload error:", err);
        return res.status(400).json({ error: err.message });
      }

      if (!req.file) {
        console.error("No file uploaded");
        return res.status(400).json({ error: "No PDF file uploaded" });
      }

      console.log(
        `Processing PDF: ${req.file.originalname} (${req.file.size} bytes) at ${req.file.path}`
      );

      // Verify file existence
      try {
        await fs.access(req.file.path, fs.constants.R_OK);
        console.log("File is readable");
      } catch (accessErr) {
        console.error(`Cannot access uploaded file: ${accessErr.message}`);
        return res
          .status(500)
          .json({ error: `File access error: ${accessErr.message}` });
      }

      // Extract text from PDF
      try {
        const text = await extractTextFromPdf(req.file.path);
        console.log("Text extraction successful");
        console.log("Extracted text (preview):", text.substring(0, 500));
        console.log("Total text length:", text.length);

        return res.json({
          text: text,
          filename: req.file.filename,
        });
      } catch (extractErr) {
        console.error("Text extraction error:", extractErr);
        return res
          .status(500)
          .json({ error: `PDF extraction error: ${extractErr.message}` });
      }
    } catch (error) {
      console.error("General error in upload handler:", error);
      return res.status(500).json({ error: `Server error: ${error.message}` });
    }
  });
});

// Podcast generation endpoint
app.post("/api/generate", apiLimiter, async (req, res) => {
  try {
    const { text, filename, voiceOptions } = req.body;

    console.log(`===== PODCAST GENERATION STARTED =====`);
    console.log(`Source: ${filename}`);
    console.log(`Text length: ${text.length} characters`);
    console.log(`Target duration: ${TARGET_PODCAST_DURATION} minutes`);
    console.log(`TTS Engine: ${process.env.TTS_ENGINE || "standard"}`);

    // Add API key validation logging
    console.log(
      `GROQ API KEY: ${
        process.env.GROQ_API_KEY
          ? "***Key exists (first 4 chars: " +
            process.env.GROQ_API_KEY.substring(0, 4) +
            "***)"
          : "MISSING!"
      }`
    );
    console.log(
      `AWS ACCESS KEY: ${
        process.env.AWS_ACCESS_KEY_ID ? "***Key exists***" : "MISSING!"
      }`
    );
    console.log(
      `AWS SECRET KEY: ${
        process.env.AWS_SECRET_ACCESS_KEY ? "***Key exists***" : "MISSING!"
      }`
    );

    // Calculate target word count based on fixed duration
    const targetWordCount = calculateTargetWordCount(TARGET_PODCAST_DURATION);
    console.log(
      `Target word count: ${targetWordCount} words (at ${WORDS_PER_MINUTE} words/minute)`
    );

    let completeScript = "";
    let usedChunking = false;

    // Try to process the entire PDF in one go
    try {
      console.log("Attempting to process entire PDF in one API call...");
      console.log(
        "Using Groq API with key:",
        process.env.GROQ_API_KEY ? "Key is set" : "⚠️ KEY MISSING"
      );

      // System prompt for podcast creation
      const systemPrompt = `You are the world's best podcast script creator. You transform written content into authentic, engaging conversations between two hosts (Ashley and Ric).
EXTREMELY IMPORTANT: The script MUST be EXACTLY ${targetWordCount} words to produce a ${TARGET_PODCAST_DURATION}-minute podcast. No more, no less.

Create an authentic-sounding conversation with these characteristics:
1. Natural speech patterns with occasional filler words ("um", "like", "y'know")
2. Hosts interrupting each other or finishing each other's sentences
3. Varied sentence lengths and structures - mix of short and long sentences
4. Casual language with contractions, slang, and informal expressions
5. Back-channeling responses ("right", "hmm", "exactly", "oh wow")
6. Authentic reactions with emotional indicators ("That's wild!" [surprised], "No way..." [skeptical])
7. Brief personal anecdotes or examples that relate to the topic
8. Occasional disagreements or different perspectives between hosts
9. Meta-commentary about the content ("This is such a fascinating topic")

Host Personalities:
- Ashley: More analytical, detail-oriented, asks thought-provoking questions, occasionally uses industry jargon
- Ric: More relatable, provides real-world examples, asks clarifying questions, good at simplifying complex topics

IMPORTANT: NEVER include:
- References to "subscribing to our podcast"
- Mentions of "future episodes" or "series"
- Generic podcast outro language about "joining us next time"
- Any indication that this is part of a regular show

End with thoughtful content-specific conclusions, like highlighting key insights or posing thought-provoking questions about the topic itself.`;

      // User prompt for podcast creation
      const userPrompt = `Create a podcast script from the following PDF content. The script should be a natural, casual conversation between Ashley and Ric that discusses the main points and important details from the content.

Your script should sound like a REAL conversation, not like hosts taking turns reading prepared statements.

EXTREMELY IMPORTANT:
1. Your script MUST be EXACTLY ${targetWordCount} words
2. Include an authentic introduction, detailed discussion, and content-focused conclusion
3. Focus on the most important information from the source content
4. End with thoughtful reflections or questions about the topic itself, NOT with "subscribe" or "tune in next time" language
5. Make the conversation flow naturally with interruptions, tangents, and casual exchanges

PDF Content: ${text}`;

      // Call Groq API with DeepSeek R1 Distill Llama 70B model
      console.log(
        "Preparing Groq API call with model: deepseek-r1-distill-llama-70b"
      );
      console.log("API URL: https://api.groq.com/openai/v1/chat/completions");
      try {
        console.log("Making Groq API request now...");
        const startTime = Date.now();
        const response = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model: "deepseek-r1-distill-llama-70b",
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
            max_tokens: 10000,
            top_p: 0.9,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: 120000, // 2 minute timeout
          }
        );

        const endTime = Date.now();
        console.log(
          `Groq API call completed in ${(endTime - startTime) / 1000} seconds`
        );
        console.log(
          "Received response from Groq API with status:",
          response.status
        );

        // Remove <think> tags if present in the response
        completeScript = response.data.choices[0].message.content;
        completeScript = completeScript.replace(
          /<think>[\s\S]*?<\/think>/g,
          ""
        );

        // Verify script duration
        const durationCheck = verifyScriptDuration(completeScript);
        console.log(`\n=== SCRIPT GENERATION RESULTS ===`);
        console.log(`Word count: ${durationCheck.wordCount} words`);
        console.log(
          `Estimated duration: ${durationCheck.estimatedMinutes.toFixed(
            1
          )} minutes`
        );
        console.log(`Target duration: ${durationCheck.targetMinutes} minutes`);
        console.log(`Acceptable range: ${durationCheck.acceptableRange}`);
        console.log(
          `Within acceptable range: ${
            durationCheck.isWithinRange ? "Yes" : "No"
          }`
        );

        // Only apply minimal protection for extreme outliers (3x target length)
        if (durationCheck.estimatedMinutes > TARGET_PODCAST_DURATION * 3) {
          console.log(
            `\n=== APPLYING TRIMMING ===\nScript is excessively long (${durationCheck.estimatedMinutes.toFixed(
              1
            )} min, > ${(TARGET_PODCAST_DURATION * 3).toFixed(
              1
            )} min threshold)`
          );
          const safeMaxWords = calculateTargetWordCount(
            TARGET_PODCAST_DURATION * 2
          );
          completeScript = trimScriptPreservingStructure(
            completeScript,
            safeMaxWords
          );
          console.log(
            `After minimal trimming: ${countWords(completeScript)} words`
          );
        } else {
          console.log(
            `\n=== NO TRIMMING NEEDED ===\nScript length (${durationCheck.estimatedMinutes.toFixed(
              1
            )} min) below ${(TARGET_PODCAST_DURATION * 3).toFixed(
              1
            )} min threshold`
          );
        }

        console.log("Script generation completed successfully");
      } catch (groqError) {
        console.error("⚠️ ERROR CALLING GROQ API:", groqError.message);

        if (groqError.response) {
          console.error("Status code:", groqError.response.status);
          console.error(
            "Response headers:",
            JSON.stringify(groqError.response.headers)
          );
          console.error(
            "Response data:",
            JSON.stringify(groqError.response.data)
          );
        } else if (groqError.request) {
          console.error(
            "No response received. Request details:",
            groqError.request._currentUrl
          );
          console.error("Request timed out or network issue");
        } else {
          console.error("Error setting up request:", groqError.message);
        }

        // Check for 413 or "request too large" error
        const isTooLarge =
          (groqError.response && groqError.response.status === 413) ||
          (groqError.response &&
            groqError.response.data &&
            typeof groqError.response.data.error?.message === "string" &&
            groqError.response.data.error.message.includes(
              "Request too large"
            ));

        if (isTooLarge) {
          console.warn(
            "Single API call failed due to request size. Falling back to chunking logic."
          );
          // Use chunking logic
          usedChunking = true;
          const chunks = splitTextIntoChunks(text);
          console.log(`Processing ${chunks.length} chunks with Groq API...`);
          let scripts = [];
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const isFirst = i === 0;
            const isLast = i === chunks.length - 1;
            const chunkScript = await processChunkWithGroq(
              chunk,
              isFirst,
              isLast,
              i + 1,
              chunks.length,
              targetWordCount
            );
            scripts.push(chunkScript);
          }
          completeScript = scripts.join("\n\n");
        } else {
          // Not a size error, rethrow
          throw groqError;
        }
      }
    } catch (error) {
      console.error("Error processing PDF:", error.message);
      throw error;
    }

    // Analyze and enhance script
    console.log("\n=== ANALYZING AND ENHANCING SCRIPT ===");
    let scriptAnalysis = analyzeScript(completeScript);

    if (scriptAnalysis.improvements.length > 0) {
      console.log(
        `Applied ${scriptAnalysis.improvements.length} improvements:`
      );
      scriptAnalysis.improvements.forEach((improvement) =>
        console.log(`- ${improvement}`)
      );
      completeScript = scriptAnalysis.improvedScript;
    } else {
      console.log("No additional improvements needed");
    }

    // Script statistics
    console.log(
      `Host balance: Ashley (${scriptAnalysis.hostALines} lines), Ric (${scriptAnalysis.hostBLines} lines)`
    );
    console.log(
      `Has conversational elements: ${
        scriptAnalysis.hasConversationalElements ? "Yes" : "No"
      }`
    );
    console.log(
      `Has proper content-focused conclusion: ${
        scriptAnalysis.hasProperConclusion ? "Yes" : "No"
      }`
    );

    // Replace Host A/B with Ashley/Ric if needed
    completeScript = replaceHostNamesInScript(completeScript);

    // Clean script metadata to remove title and section markers
    completeScript = cleanScriptMetadata(completeScript);

    // Optimize the script for TTS
    const optimizedScript = optimizeScriptForTTS(completeScript);

    // Generate audio using AWS Polly instead of voice_service.py
    console.log("Generating audio with AWS Polly TTS...");
    console.log(
      "Using AWS credentials:",
      process.env.AWS_ACCESS_KEY_ID ? "Key is set" : "⚠️ KEY MISSING"
    );

    // Parse the script to separate Ashley and Ric lines
    const lines = optimizedScript.split("\n").filter((line) => line.trim());
    const audioSegments = [];
    const timestamp = Date.now();
    const tempDir = config.TEMP_DIR;
    const outputDir = config.OUTPUT_DIR;

    // Ensure directories exist
    await fs.ensureDir(tempDir);
    await fs.ensureDir(outputDir);

    // Change extension from .wav to .mp3 to match AWS Polly output format
    const outputFilename = `podcast_${timestamp}.mp3`;
    const outputPath = path.join(outputDir, outputFilename);

    // Get the voices based on the current TTS engine setting
    const voiceMapping = getVoices();

    // Log the selected voices
    console.log(
      `Using voice mapping: Ashley=${voiceMapping.Ashley}, Ric=${voiceMapping.Ric}`
    );

    // Process each line with the appropriate voice
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      // Extract speaker and text - FIX: Only split at the first colon when it follows a host pattern
      let speaker, text;

      // Improved regex to detect speaker prefixes like "Ashley:" or "Ric:"
      const speakerMatch = line.match(/^([^:]+?):\s*(.*)/);

      if (speakerMatch) {
        speaker = speakerMatch[1].trim();
        text = speakerMatch[2].trim();
      } else {
        speaker = i % 2 === 0 ? "Ashley" : "Ric";
        text = line.trim();
      }

      // Debug the speaker extraction
      console.log(`DEBUG: Extracted speaker: "${speaker}"`);

      // Determine which voice to use based on the speaker
      const isHostA = /ashley/i.test(speaker) || /host\s*a/i.test(speaker); // Match both Ashley and Host A
      const voice = isHostA ? voiceMapping.Ashley : voiceMapping.Ric;

      // Log the voice assignment
      console.log(`DEBUG: Assigned voice: ${voice} for speaker: ${speaker}`);

      // Generate the audio for this line
      const tempFile = path.join(tempDir, `line_${i}.mp3`);
      console.log(`Processing line ${i + 1}/${lines.length} with ${voice}...`);

      // Use AWS Polly to synthesize speech - using current TTS engine from environment
      const result = await synthesizeSpeech(text, voice, tempFile);

      // Improved error handling for budget exceeded scenario
      if (result === true) {
        audioSegments.push(tempFile);
        if (
          text.endsWith(".") ||
          text.endsWith("!") ||
          text.endsWith("?") ||
          text.includes("[pause]")
        ) {
          const pauseLength = text.endsWith(".")
            ? 0.6
            : text.endsWith("!") || text.endsWith("?")
            ? 0.7
            : 0.4;
          const pauseFile = path.join(tempDir, `pause_${i}.mp3`);
          // Create a silent MP3 file for the pause
          await createSilence(pauseFile, pauseLength);
          audioSegments.push(pauseFile);
        }
      } else if (result && result.error === "budget_exceeded") {
        console.error(`Budget exceeded: ${result.message}`);
        // Return a proper error response to the client
        return res.status(403).json({
          error: "budget_exceeded",
          message:
            result.message ||
            "Monthly TTS budget limit has been reached. Service will resume next month.",
        });
      } else {
        console.error(`Failed to generate audio for line ${i + 1}`);
      }
    }

    // Combine all audio segments into one file
    console.log("Combining audio segments...");
    const combinedFile = path.join(outputDir, outputFilename);
    let combinedSuccess = await combineAudioFiles(audioSegments, combinedFile);

    // Add post-processing to repair the MP3 file
    if (combinedSuccess) {
      console.log("Post-processing audio to ensure playback compatibility...");
      const repairSuccess = await repairMp3File(combinedFile, combinedFile);
      if (repairSuccess) {
        console.log("Audio post-processing successful");
      } else {
        console.warn(
          "Audio post-processing failed, using original combined file"
        );
      }
    } else {
      console.error("Failed to combine audio segments");
      return res
        .status(500)
        .json({ error: "Failed to generate podcast audio" });
    }

    // Clean up temp files
    for (const file of audioSegments) {
      await fs.remove(file).catch(() => {});
    }

    console.log(`Podcast generated successfully: ${combinedFile}`);

    // Return podcast data
    res.json({
      script: optimizedScript,
      audioUrl: `/podcasts/${path.basename(combinedFile)}`,
    });
  } catch (error) {
    console.error("PODCAST GENERATION FAILED:", error.message);
    console.error("Error type:", error.constructor.name);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", JSON.stringify(error.response.data));
    }

    // Return a more detailed error to the client
    res.status(500).json({
      error: "Failed to generate podcast",
      message: error.message,
      details: error.response
        ? `API returned ${error.response.status}`
        : "Network or server error",
    });
  }
});

// Add test script generation endpoint
app.post("/api/test-script", async (req, res) => {
  try {
    console.log("Test script generation endpoint called");

    // Create a simple hardcoded script for testing
    const mockScript = `Ashley: Hi everyone, welcome to today's podcast! I'm Ashley.
Ric: And I'm Ric. Today we're talking about a really interesting cover letter from Sagar Bhavsar.
Ashley: Yes, it's quite creative! Sagar starts by telling a story about developing an image dehazing model in college.
Ric: That's right. He mentions how his model won an award and was featured in a research paper.
Ashley: I think that's such a compelling way to start a cover letter, don't you think?
Ric: Absolutely! It immediately shows his technical skills and achievements in AI right from the start.
Ashley: And it seems he's been passionate about making "tech smarter, faster, and more impactful" ever since.
Ric: I love how he weaves a personal narrative into his professional achievements.
Ashley: Well, that's all we have time for today. This was just a quick test podcast!
Ric: Thanks for listening to our test script. Hope it works!`;

    console.log("Returning mock script for testing TTS only");
    return res.json({
      script: mockScript,
      audioUrl: "/test-script.mp3", // This won't actually exist unless TTS runs
    });
  } catch (error) {
    console.error("Test script generation failed:", error);
    res.status(500).json({
      error: "Test script generation failed",
      message: error.message,
    });
  }
});

// Add special AWS Polly test endpoint
app.post("/api/test-aws-polly", async (req, res) => {
  try {
    console.log("Testing AWS Polly service with sample text");

    // Create temporary and output directories
    const tempDir = config.TEMP_DIR;
    const outputDir = config.OUTPUT_DIR;
    await fs.ensureDir(tempDir);
    await fs.ensureDir(outputDir);

    // Create a test output file
    const timestamp = Date.now();
    const outputFilename = `polly_test_${timestamp}.mp3`;
    const outputPath = path.join(outputDir, outputFilename);

    // Sample text to synthesize
    const sampleText =
      "This is a test of the AWS Polly service. If you can hear this message, your configuration is working correctly.";

    console.log("Synthesizing speech with AWS Polly");
    console.log(
      `AWS credentials: ${
        process.env.AWS_ACCESS_KEY_ID ? "Key exists" : "MISSING"
      }`
    );
    console.log(`AWS region: ${process.env.AWS_REGION || "default"}`);

    // Directly use the synthesizeSpeech function
    const result = await synthesizeSpeech(
      sampleText,
      "Joanna",
      outputPath,
      "standard"
    );

    if (result === true) {
      console.log("AWS Polly test successful!");
      return res.json({
        success: true,
        message: "AWS Polly test successful",
        audioUrl: `/podcasts/${outputFilename}`,
      });
    } else {
      console.error("AWS Polly test failed:", result);
      return res.status(500).json({
        success: false,
        error: "AWS Polly test failed",
        details: result,
      });
    }
  } catch (error) {
    console.error("AWS Polly test error:", error);
    return res.status(500).json({
      success: false,
      error: "AWS Polly test error",
      message: error.message,
    });
  }
});

// Add TTS engine test endpoint
app.post("/api/test-tts-engine", async (req, res) => {
  try {
    // Get current TTS engine from environment
    const engine = process.env.TTS_ENGINE || "standard";
    const voices = getVoices();

    // Create temporary and output directories
    const tempDir = config.TEMP_DIR;
    const outputDir = config.OUTPUT_DIR;
    await fs.ensureDir(tempDir);
    await fs.ensureDir(outputDir);

    // Sample texts for Ashley and Ric
    const ashleySample =
      "Hello, I'm Ashley. This is a test of the voice configuration for the current TTS engine.";
    const ricSample =
      "And I'm Ric. We're testing different voices with AWS Polly.";

    // Create test output files
    const timestamp = Date.now();
    const ashleyFile = `ashley_test_${timestamp}.mp3`;
    const ricFile = `ric_test_${timestamp}.mp3`;
    const ashleyPath = path.join(outputDir, ashleyFile);
    const ricPath = path.join(outputDir, ricFile);

    // Generate test audio for both hosts
    console.log(
      `Testing ${engine} engine with voices: Ashley=${voices.Ashley}, Ric=${voices.Ric}`
    );
    const ashleyResult = await synthesizeSpeech(
      ashleySample,
      voices.Ashley,
      ashleyPath
    );
    const ricResult = await synthesizeSpeech(ricSample, voices.Ric, ricPath);

    if (ashleyResult === true && ricResult === true) {
      console.log("TTS engine test successful!");
      return res.json({
        success: true,
        engine: engine,
        voices: voices,
        ashleyAudioUrl: `/podcasts/${ashleyFile}`,
        ricAudioUrl: `/podcasts/${ricFile}`,
      });
    } else {
      console.error("TTS engine test failed:", ashleyResult, ricResult);
      return res.status(500).json({
        success: false,
        error: "TTS engine test failed",
        details: { ashleyResult, ricResult },
      });
    }
  } catch (error) {
    console.error("TTS engine test error:", error);
    return res.status(500).json({
      success: false,
      error: "TTS engine test error",
      message: error.message,
    });
  }
});

// Serve static files from the public directory
app.use("/podcasts", express.static(config.OUTPUT_DIR));

// Basic health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "Server is running" });
});

// Enhanced podcast streaming with improved error handling and validation
app.get("/podcasts/:filename", async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(config.OUTPUT_DIR, filename);

    // Validate the file exists
    try {
      await fs.access(filePath);
    } catch (err) {
      console.error(`File not found: ${filePath}`, err);
      return res.status(404).send("Audio file not found");
    }

    const stat = await fs.stat(filePath);
    const fileSize = stat.size;

    if (fileSize === 0) {
      console.error(`Empty audio file: ${filePath}`);
      return res.status(500).send("Invalid audio file (zero bytes)");
    }

    // Set proper headers for streaming media
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const range = req.headers.range;

    if (range) {
      // Parse range header
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);

      // Handle invalid start position
      if (isNaN(start) || start < 0 || start >= fileSize) {
        console.warn(`Invalid range request for ${filename}: ${range}`);
        return res.status(416).send("Range Not Satisfiable");
      }

      // Calculate end position
      const end = parts[1]
        ? Math.min(parseInt(parts[1], 10), fileSize - 1)
        : fileSize - 1;
      const chunkSize = end - start + 1;

      // Log the range request
      console.log(`Range request: ${start}-${end}/${fileSize} for ${filename}`);

      // Set appropriate headers for partial content
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Content-Length", chunkSize);

      // Create read stream with high watermark for better performance
      const stream = fs.createReadStream(filePath, {
        start,
        end,
        highWaterMark: 65536, // 64KB chunks for more efficient streaming
      });

      // Handle stream errors
      stream.on("error", (err) => {
        console.error(`Stream error for ${filename}:`, err);
        if (!res.headersSent) {
          res.status(500).send("Error streaming file");
        } else {
          res.end();
        }
      });

      // Pipe the file stream to the response
      stream.pipe(res);
    } else {
      // Full file request (no range)
      console.log(`Serving complete file ${filename} (${fileSize} bytes)`);

      res.setHeader("Content-Length", fileSize);

      // Create read stream with improved buffer size
      const stream = fs.createReadStream(filePath, {
        highWaterMark: 65536, // 64KB buffer
      });

      // Handle stream errors
      stream.on("error", (err) => {
        console.error(`Stream error for ${filename}:`, err);
        if (!res.headersSent) {
          res.status(500).send("Error streaming file");
        } else {
          res.end();
        }
      });

      // Pipe the file stream to the response
      stream.pipe(res);
    }
  } catch (error) {
    console.error(`Error streaming podcast ${req.params.filename}:`, error);
    if (!res.headersSent) {
      res.status(500).send("Server error while streaming audio");
    } else {
      res.end();
    }
  }
});

// Make the debug endpoint more accessible at both / and /api routes
app.get(["/debug", "/api/debug"], async (req, res) => {
  try {
    // Get hostname information
    const hostname = req.hostname || "unknown";
    const fullUrl = req.protocol + "://" + req.get("host") + req.originalUrl;
    const results = {
      server: {
        hostname: hostname,
        requestUrl: fullUrl,
        timestamp: new Date().toISOString(),
      },
      environment: {
        node_env: process.env.NODE_ENV,
        port: PORT,
        renderService: process.env.RENDER || "Not running on Render",
      },
      directories: {
        uploads: {
          path: config.UPLOADS_DIR,
          exists: await fs.pathExists(config.UPLOADS_DIR),
          ...(await debugHelper.checkDirectoryPermissions(config.UPLOADS_DIR)),
        },
        temp: {
          path: config.TEMP_DIR,
          exists: await fs.pathExists(config.TEMP_DIR),
          ...(await debugHelper.checkDirectoryPermissions(config.TEMP_DIR)),
        },
        output: {
          path: config.OUTPUT_DIR,
          exists: await fs.pathExists(config.OUTPUT_DIR),
          ...(await debugHelper.checkDirectoryPermissions(config.OUTPUT_DIR)),
        },
      },
    };

    // Try to get disk space information if available
    try {
      const { execSync } = require("child_process");
      const diskData = execSync("df -h").toString();
      results.diskSpace = {
        info: diskData,
      };
    } catch (err) {
      results.diskSpace = {
        error: err.message,
      };
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Check and display ffmpeg status
const {
  createSilence,
  combineAudioFiles,
  isFFmpegAvailable,
  repairMp3File,
} = require("./audio-utils");

if (!isFFmpegAvailable()) {
  console.log("\n⚠️  WARNING: ffmpeg is not installed on this system.");
  console.log(
    "Audio quality will be reduced. For best results, install ffmpeg:"
  );
  console.log("- macOS: brew install ffmpeg");
  console.log("- Ubuntu/Debian: sudo apt install ffmpeg");
  console.log("- Windows: download from https://ffmpeg.org/download.html\n");
} else {
  console.log(
    "ffmpeg detected: audio processing will use optimal quality settings"
  );
}

// For all other routes, serve the frontend app
app.get("*", (req, res) => {
  if (req.url.startsWith("/api/") || req.url.startsWith("/podcasts/")) {
    return res.status(404).send("API endpoint not found");
  }

  if (fs.existsSync(path.join(frontendPath, "index.html"))) {
    res.sendFile(path.join(frontendPath, "index.html"));
  } else if (fs.existsSync(path.join(altFrontendPath, "index.html"))) {
    res.sendFile(path.join(altFrontendPath, "index.html"));
  } else {
    res.redirect("/");
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
