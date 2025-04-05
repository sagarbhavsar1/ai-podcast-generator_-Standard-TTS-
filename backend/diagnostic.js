/**
 * Diagnostic tool to test Groq API and AWS Polly independently
 * Usage: node diagnostic.js [test-groq|test-aws|test-all]
 */

const axios = require("axios");
const AWS = require("aws-sdk");
const fs = require("fs-extra");
const path = require("path");
require("dotenv").config();

// Setup AWS configuration
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || "us-east-1",
});

const polly = new AWS.Polly();

// Basic test message
const TEST_TEXT =
  "This is a test message for PDFCast diagnostic tool. Testing API connectivity.";

// Test script for Groq
const testScript = `Ashley: Hi everyone, welcome to today's podcast! I'm Ashley.
Ric: And I'm Ric. Today we're testing the PDFCast diagnostic tool.
Ashley: That's right! We're checking if our API connections are working properly.
Ric: Let's hope everything is in order so we can get back to generating awesome podcasts!`;

// Test Groq API
async function testGroq() {
  console.log("\n🧪 TESTING GROQ API CONNECTION 🧪");
  console.log("================================");
  console.log(
    `Using GROQ_API_KEY: ${
      process.env.GROQ_API_KEY
        ? process.env.GROQ_API_KEY.substring(0, 8) + "..."
        : "NOT SET"
    }`
  );

  try {
    console.log("Sending test request to Groq API...");

    const startTime = Date.now();
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "deepseek-r1-distill-llama-70b",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant.",
          },
          {
            role: "user",
            content:
              "Please respond with 'Groq API connection successful!' if you receive this message.",
          },
        ],
        temperature: 0.7,
        max_tokens: 100,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000, // 30-second timeout
      }
    );

    const duration = (Date.now() - startTime) / 1000;

    console.log("✅ GROQ API TEST SUCCESSFUL");
    console.log(`Response time: ${duration.toFixed(2)} seconds`);
    console.log("Response content:", response.data.choices[0].message.content);

    return {
      success: true,
      duration,
      message: response.data.choices[0].message.content,
    };
  } catch (error) {
    console.log("❌ GROQ API TEST FAILED");

    if (error.response) {
      console.error(`Status code: ${error.response.status}`);
      console.error(
        "Response data:",
        JSON.stringify(error.response.data, null, 2)
      );
    } else if (error.request) {
      console.error("No response received from API");
      console.error("Request:", error.request);
    } else {
      console.error(`Error setting up request: ${error.message}`);
    }

    return {
      success: false,
      error: error.message,
      details: error.response ? error.response.data : "No response from server",
    };
  }
}

// Test AWS Polly
async function testAWS() {
  console.log("\n🧪 TESTING AWS POLLY CONNECTION 🧪");
  console.log("=================================");
  console.log(
    `Using AWS_ACCESS_KEY_ID: ${
      process.env.AWS_ACCESS_KEY_ID
        ? process.env.AWS_ACCESS_KEY_ID.substring(0, 8) + "..."
        : "NOT SET"
    }`
  );
  console.log(`Using AWS_REGION: ${process.env.AWS_REGION || "us-east-1"}`);

  try {
    // First, let's test the credentials with a simple describeVoices call
    console.log("Checking AWS Polly service access...");

    const startTime = Date.now();
    const voicesResult = await polly
      .describeVoices({ LanguageCode: "en-US" })
      .promise();
    const duration = (Date.now() - startTime) / 1000;

    console.log(
      `✅ AWS Polly service accessible (${voicesResult.Voices.length} voices available)`
    );
    console.log(`Response time: ${duration.toFixed(2)} seconds`);

    // Now test actual speech synthesis
    console.log("\nTesting speech synthesis...");

    // Create temp directory if it doesn't exist
    const tempDir = path.join(__dirname, "temp_diagnostic");
    await fs.ensureDir(tempDir);

    // Generate audio file path
    const outputFile = path.join(tempDir, "test_audio.mp3");

    // Synthesize speech
    const synthParams = {
      OutputFormat: "mp3",
      SampleRate: "24000",
      Text: TEST_TEXT,
      TextType: "text",
      VoiceId: "Joanna",
    };

    const synthStart = Date.now();
    console.log("Requesting speech synthesis...");

    const synthResult = await polly.synthesizeSpeech(synthParams).promise();
    const synthDuration = (Date.now() - synthStart) / 1000;

    // Write audio file to disk
    await fs.writeFile(outputFile, synthResult.AudioStream);
    const fileStats = await fs.stat(outputFile);

    console.log("✅ AWS POLLY SYNTHESIS SUCCESSFUL");
    console.log(`Synthesis time: ${synthDuration.toFixed(2)} seconds`);
    console.log(`Audio file created: ${outputFile} (${fileStats.size} bytes)`);

    return {
      success: true,
      voiceCount: voicesResult.Voices.length,
      synthDuration,
      audioFile: outputFile,
      fileSize: fileStats.size,
    };
  } catch (error) {
    console.log("❌ AWS POLLY TEST FAILED");
    console.error(`Error: ${error.message}`);

    // Additional AWS error details
    if (error.code) {
      console.error(`AWS Error Code: ${error.code}`);
    }
    if (error.statusCode) {
      console.error(`Status Code: ${error.statusCode}`);
    }
    if (error.requestId) {
      console.error(`Request ID: ${error.requestId}`);
    }

    return {
      success: false,
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
    };
  }
}

// Run tests
async function runTests() {
  const arg = process.argv[2] || "test-all";

  console.log("🔍 PDFCAST DIAGNOSTIC TOOL 🔍");
  console.log("=============================");
  console.log(`Running test: ${arg}`);

  let results = {
    groq: null,
    aws: null,
  };

  if (arg === "test-groq" || arg === "test-all") {
    results.groq = await testGroq();
  }

  if (arg === "test-aws" || arg === "test-all") {
    results.aws = await testAWS();
  }

  console.log("\n📊 TEST RESULTS SUMMARY 📊");
  console.log("========================");

  if (results.groq) {
    console.log(`Groq API: ${results.groq.success ? "✅ PASS" : "❌ FAIL"}`);
  }

  if (results.aws) {
    console.log(`AWS Polly: ${results.aws.success ? "✅ PASS" : "❌ FAIL"}`);
  }

  // Final verdict
  if (
    (results.groq && !results.groq.success) ||
    (results.aws && !results.aws.success)
  ) {
    console.log("\n❌ DIAGNOSTIC FAILED - Fix the issues reported above");

    // Suggestions
    console.log("\n🔧 SUGGESTIONS:");

    if (results.groq && !results.groq.success) {
      console.log(
        "- Check if your Groq API key is valid and has sufficient credits"
      );
      console.log("- Verify network connectivity to api.groq.com");
      console.log("- Check for rate limiting issues with Groq API");
    }

    if (results.aws && !results.aws.success) {
      console.log("- Verify your AWS credentials are correct");
      console.log("- Check if your AWS region is properly configured");
      console.log("- Ensure your AWS account has permissions for Polly");
      console.log("- Check if you've exceeded your AWS Polly free tier limits");
    }
  } else if (results.groq?.success && results.aws?.success) {
    console.log(
      "\n✅ ALL TESTS PASSED - Your environment is correctly configured!"
    );
  }
}

// Execute tests
runTests().catch((err) => {
  console.error("Unhandled error in diagnostic tool:", err);
});
