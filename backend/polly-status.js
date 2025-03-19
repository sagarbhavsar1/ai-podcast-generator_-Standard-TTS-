require("dotenv").config();
const { synthesizeSpeech } = require("./aws_polly_tts");
const fs = require("fs-extra");
const path = require("path");

// Test all available voices and engines
async function testPollyVoices() {
  console.log("AWS Polly Status Check");
  console.log("=====================");

  // Ensure credentials are set
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error("❌ AWS credentials not found in .env file");
    return false;
  }

  // Create test directory
  const testDir = path.join(__dirname, "polly-tests");
  await fs.ensureDir(testDir);

  // Test text
  const testText =
    "This is a test of the AWS Polly TTS service. How does this voice sound?";

  // Test neural voices (best for podcast)
  const voices = [
    {
      name: "Danielle",
      gender: "Female",
      description: "US English female voice (Host A)",
    },
    {
      name: "Stephen",
      gender: "Male",
      description: "US English male voice (Host B)",
    },
  ];

  console.log("Testing with Neural engine (recommended for podcast quality):");

  let allSuccessful = true;
  for (const voice of voices) {
    const outputFile = path.join(testDir, `${voice.name}-neural.mp3`);
    console.log(`Testing ${voice.name} (${voice.description})...`);

    const startTime = Date.now();
    const success = await synthesizeSpeech(
      testText,
      voice.name,
      outputFile,
      "neural"
    );
    const duration = Date.now() - startTime;

    if (success) {
      console.log(`✅ ${voice.name}: Success (${duration}ms)`);
    } else {
      console.log(`❌ ${voice.name}: Failed`);
      allSuccessful = false;
    }
  }

  if (allSuccessful) {
    console.log("\n✅ All voice tests passed! AWS Polly is working correctly.");
    console.log(`Test files saved to: ${testDir}`);
    return true;
  } else {
    console.log(
      "\n❌ Some voice tests failed. Please check your AWS configuration."
    );
    return false;
  }
}

testPollyVoices();
