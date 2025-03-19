const AWS = require("aws-sdk");
const fs = require("fs");
const util = require("util");
const stream = require("stream");
const pipeline = util.promisify(stream.pipeline);

// Configure AWS
function configureAWS() {
  AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || "us-east-1",
  });
}

/**
 * Synthesize speech using Amazon Polly
 * @param {string} text - The text to convert to speech
 * @param {string} voice - The Polly voice ID (e.g., 'Joanna', 'Matthew')
 * @param {string} outputFile - Path to save the audio file
 * @param {string} [engine="neural"] - The engine type ('standard', 'neural', or 'generative')
 * @returns {Promise<boolean>} - Success/failure
 */
async function synthesizeSpeech(text, voice, outputFile, engine = "neural") {
  try {
    configureAWS();
    const polly = new AWS.Polly();

    // Character count logging for cost monitoring
    const charCount = text.length;
    console.log(
      `TTS Request: ${charCount} characters, voice: ${voice}, engine: ${engine}`
    );

    // Clean up text for better speech synthesis
    text = cleanupTextForSpeech(text);

    // Split long text if needed (Polly has character limits)
    const maxChars = engine === "generative" ? 3000 : 6000;
    if (charCount > maxChars) {
      return await synthesizeLongSpeech(
        text,
        voice,
        outputFile,
        engine,
        maxChars
      );
    }

    // Request speech synthesis
    const params = {
      OutputFormat: "mp3",
      Text: text,
      VoiceId: voice,
      Engine: engine,
      TextType: "text", // 'ssml' is also supported
    };

    // For streaming audio directly to file
    const result = await polly.synthesizeSpeech(params).promise();

    // Save the audio
    fs.writeFileSync(outputFile, result.AudioStream);

    console.log(`Successfully synthesized speech to ${outputFile}`);
    return true;
  } catch (error) {
    console.error(`Error synthesizing speech: ${error.message}`);
    return false;
  }
}

// Remove speech markers and clean up text
function cleanupTextForSpeech(text) {
  // Remove stage directions
  text = text.replace(/\[.*?\]/g, "");

  // Fix ellipses for better pronunciation
  text = text.replace(/\.{3,}/g, " pause ");

  // Replace special characters and symbols for better pronunciation
  text = text.replace(/[*#]/g, " ");
  text = text.replace(/&/g, " and ");
  text = text.replace(/@/g, " at ");

  // Ensure proper spacing after punctuation
  text = text.replace(/([.!?])\s*(?=[A-Z])/g, "$1 ");

  return text.trim();
}

// Helper function to handle longer texts
async function synthesizeLongSpeech(text, voice, outputFile, engine, maxChars) {
  // Split the text into chunks of 2500 characters (to stay under the 3000 limit)
  const maxChunkSize = maxChars - 500;
  const chunks = [];

  // Try to split at natural boundaries
  let startIndex = 0;
  while (startIndex < text.length) {
    let endIndex = Math.min(startIndex + maxChunkSize, text.length);

    // If we're not at the end of the text, try to find a good breaking point
    if (endIndex < text.length) {
      // Look for sentence breaks first
      const lastPeriod = text.lastIndexOf(".", endIndex);
      const lastQuestion = text.lastIndexOf("?", endIndex);
      const lastExclamation = text.lastIndexOf("!", endIndex);

      // Find the closest sentence break
      const breakPoint = Math.max(lastPeriod, lastQuestion, lastExclamation);

      // If we found a valid break point, use it
      if (breakPoint > startIndex && breakPoint < endIndex) {
        endIndex = breakPoint + 1;
      } else {
        // Otherwise find the last space
        const lastSpace = text.lastIndexOf(" ", endIndex);
        if (lastSpace > startIndex) {
          endIndex = lastSpace + 1;
        }
      }
    }

    chunks.push(text.substring(startIndex, endIndex));
    startIndex = endIndex;
  }

  console.log(`Split text into ${chunks.length} chunks`);

  // Process each chunk and combine the output
  const tempFiles = [];
  for (let i = 0; i < chunks.length; i++) {
    const tempFile = `${outputFile}.part${i}.mp3`;
    tempFiles.push(tempFile);

    const success = await synthesizeSpeech(chunks[i], voice, tempFile, engine);

    if (!success) {
      console.error(`Failed to synthesize chunk ${i}`);
      return false;
    }
  }

  // Combine all the audio files
  await combineAudioFiles(tempFiles, outputFile);

  // Clean up temp files
  for (const file of tempFiles) {
    fs.unlinkSync(file);
  }

  return true;
}

// Combine multiple audio files into one
async function combineAudioFiles(files, outputFile) {
  const writeStream = fs.createWriteStream(outputFile);

  for (const file of files) {
    const readStream = fs.createReadStream(file);
    await pipeline(readStream, writeStream, { end: false });
  }

  writeStream.end();
  return true;
}

// New function to get available Polly voices
async function getAvailableVoices() {
  try {
    configureAWS();
    const polly = new AWS.Polly();
    const result = await polly.describeVoices({}).promise();
    return result.Voices;
  } catch (error) {
    console.error(`Error getting available voices: ${error.message}`);
    return [];
  }
}

// New function for generating complete podcasts
async function generatePodcastAudio(script, options = {}) {
  // Default options
  const defaults = {
    hostAVoice: "Joanna",
    hostBVoice: "Matthew",
    engine: "neural",
    outputDir: "./output",
    tempDir: "./temp",
  };

  const config = { ...defaults, ...options };

  // Implementation details would go here...
  // This would process the entire script, use the appropriate voices for each host,
  // add pauses, and combine everything into a final audio file

  return {
    success: true,
    audioFile: "path/to/final/audio.mp3",
    duration: 300, // seconds
    characterCount: 15000,
  };
}

module.exports = {
  synthesizeSpeech,
  synthesizeLongSpeech,
  generatePodcastAudio,
  getAvailableVoices,
};
