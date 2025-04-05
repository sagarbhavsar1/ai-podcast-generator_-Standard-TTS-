const AWS = require("aws-sdk");
const fs = require("fs-extra");
const path = require("path");
const { promisify } = require("util");
const stream = require("stream");
const pipeline = promisify(stream.pipeline);

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || "us-east-1",
});

// Create Polly service object
const polly = new AWS.Polly();

// Voice mapping configuration for different TTS engines
const VOICE_MAPPINGS = {
  standard: {
    Ashley: "Joanna", // Female voice for Ashley (main host)
    Ric: "Matthew", // Male voice for Ric
  },
  neural: {
    Ashley: "Danielle", // Female voice for Ashley (main host)
    Ric: "Stephen", // Male voice for Ric
  },
  generative: {
    Ashley: "Danielle", // Female voice for Ashley (main host)
    Ric: "Matthew", // Male voice for Ric
  },
};

// Default to standard engine if not specified
function getTtsEngine() {
  const engine = process.env.TTS_ENGINE || "standard";
  // Log the engine being used
  console.log(`Using AWS Polly TTS engine: ${engine}`);
  return engine;
}

// Get voices based on the current engine setting
function getVoices() {
  const engine = getTtsEngine();
  if (!VOICE_MAPPINGS[engine]) {
    console.warn(
      `Unknown TTS engine "${engine}", falling back to standard voices`
    );
    return VOICE_MAPPINGS.standard;
  }
  return VOICE_MAPPINGS[engine];
}

// Synthesize speech using AWS Polly
async function synthesizeSpeech(text, voice, outputFile, engineType = null) {
  try {
    // If no specific engineType is provided, use the environment variable
    const engine = engineType || getTtsEngine();

    // Update the voice if it's a character name (Ashley or Ric)
    if (voice === "Ashley" || voice === "Ric") {
      const voices = getVoices();
      voice = voices[voice];
    }

    // Set engine type based on the selected engine
    let engineSettings = {};
    if (engine === "neural" || engine === "generative") {
      engineSettings.Engine = engine;
    }

    console.log(
      `Synthesizing speech with ${engine} engine using voice: ${voice}`
    );

    // Set the parameters for speech synthesis
    const params = {
      OutputFormat: "mp3",
      SampleRate: "24000",
      Text: text,
      TextType: "text",
      VoiceId: voice,
      ...engineSettings,
    };

    // Log the API call for debugging
    console.log(`AWS Polly params: ${JSON.stringify(params, null, 2)}`);

    try {
      // Check for budget limit
      // This would be extended with your actual budget check implementation
      const monthlyBudgetLimit = process.env.AWS_POLLY_BUDGET_LIMIT;
      if (monthlyBudgetLimit && false) {
        // Placeholder for actual budget check
        return {
          error: "budget_exceeded",
          message: "Monthly AWS Polly budget limit has been reached.",
        };
      }

      // Call AWS Polly to synthesize speech
      const data = await polly.synthesizeSpeech(params).promise();

      // Create the output directory if it doesn't exist
      const outputDir = path.dirname(outputFile);
      await fs.ensureDir(outputDir);

      // Write the audio stream to the output file
      await fs.writeFile(outputFile, data.AudioStream);

      return true;
    } catch (error) {
      console.error("AWS Polly API error:", error);

      // Handle specific AWS errors
      if (error.code === "AccessDenied") {
        return {
          error: "access_denied",
          message: "AWS access denied. Check your credentials.",
        };
      }

      return false;
    }
  } catch (error) {
    console.error("Speech synthesis error:", error);
    return false;
  }
}

module.exports = {
  synthesizeSpeech,
  getVoices,
  getTtsEngine,
};
