require("dotenv").config();
const { synthesizeSpeech } = require("./aws_polly_tts");

async function testPolly() {
  console.log("Testing AWS Polly...");

  const result = await synthesizeSpeech(
    "Hello, this is a test of the AWS Polly neural TTS service.",
    "Danielle", // Using our Host A voice
    "test-polly-output.mp3",
    "neural" // Using neural engine
  );

  if (result) {
    console.log("✅ Test successful! Audio saved to test-polly-output.mp3");
  } else {
    console.error(
      "❌ Test failed. Check your AWS credentials and permissions."
    );
  }
}

testPolly();
