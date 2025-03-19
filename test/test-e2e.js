const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const { execSync } = require("child_process");

// Configuration
const BACKEND_URL = "http://localhost:3000";
const TEST_PDF_PATH = path.join(__dirname, "test-document.pdf");
const TIMEOUT_MS = 300000; // 5 minutes max for the whole process
const BACKEND_DIR = path.join(__dirname, "..", "backend");

// Check for required dependencies
function checkDependencies() {
  console.log("Checking for required dependencies...");

  try {
    // Check if backend package.json exists
    const packageJsonPath = path.join(BACKEND_DIR, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      console.error(
        "❌ Backend package.json not found. Make sure you are in the correct directory."
      );
      return false;
    }

    // Check required packages
    const requiredPackages = ["aws-sdk", "express", "multer", "fs-extra"];
    const packageJson = require(packageJsonPath);
    const missingPackages = [];

    requiredPackages.forEach((pkg) => {
      if (!packageJson.dependencies?.[pkg]) {
        missingPackages.push(pkg);
      }
    });

    if (missingPackages.length > 0) {
      console.log(
        `❌ Missing required dependencies: ${missingPackages.join(", ")}`
      );
      console.log("Installing missing dependencies...");

      try {
        // Install missing packages
        execSync(
          `cd "${BACKEND_DIR}" && npm install ${missingPackages.join(" ")}`,
          {
            stdio: "inherit",
          }
        );
        console.log("✅ Dependencies installed successfully");
      } catch (error) {
        console.error(
          "❌ Failed to install dependencies. Please install them manually."
        );
        return false;
      }
    } else {
      console.log("✅ All required dependencies are present");
    }

    return true;
  } catch (error) {
    console.error("❌ Failed to check dependencies:", error);
    return false;
  }
}

async function testFullWorkflow() {
  console.log("Starting end-to-end test of AI Podcast Generator");
  console.log("=============================================");

  // Check dependencies first
  if (!checkDependencies()) {
    console.error(
      "❌ Dependency check failed. Please resolve the issues before continuing."
    );
    return false;
  }

  try {
    // Step 1: Check if backend is running
    console.log("\n1. Checking if backend server is running...");
    try {
      const healthCheck = await axios.get(`${BACKEND_URL}/api/health`);
      console.log("✅ Backend server is running");
    } catch (err) {
      console.error("❌ Backend server is not running. Please start it first.");
      console.log(
        "   To start the backend server, run: cd ../backend && node app.js"
      );
      return false;
    }

    // Step 2: Upload PDF
    console.log("\n2. Uploading test PDF...");
    if (!fs.existsSync(TEST_PDF_PATH)) {
      console.error(`❌ Test PDF not found at ${TEST_PDF_PATH}`);
      return false;
    }

    const form = new FormData();
    form.append("pdf", fs.createReadStream(TEST_PDF_PATH));

    const uploadResponse = await axios.post(`${BACKEND_URL}/api/upload`, form, {
      headers: {
        ...form.getHeaders(),
      },
      timeout: 30000, // 30 seconds timeout for upload
    });

    if (!uploadResponse.data || !uploadResponse.data.text) {
      console.error("❌ PDF upload failed or text extraction failed");
      console.log(uploadResponse.data);
      return false;
    }

    console.log("✅ PDF uploaded and text extracted successfully");
    console.log(`   Extracted ${uploadResponse.data.text.length} characters`);

    // Step 3: Generate podcast
    console.log("\n3. Generating podcast from extracted text...");
    console.log("   (This may take a few minutes)");

    const generateStartTime = Date.now();
    const generateResponse = await axios.post(
      `${BACKEND_URL}/api/generate`,
      {
        text: uploadResponse.data.text,
        filename: uploadResponse.data.filename,
      },
      {
        timeout: TIMEOUT_MS, // Longer timeout for podcast generation
      }
    );

    const generateDuration = ((Date.now() - generateStartTime) / 1000).toFixed(
      1
    );

    if (!generateResponse.data || !generateResponse.data.audioUrl) {
      console.error("❌ Podcast generation failed");
      console.log(generateResponse.data);
      return false;
    }

    console.log("✅ Podcast generated successfully!");
    console.log(`   Generation took ${generateDuration} seconds`);
    console.log(`   Audio URL: ${generateResponse.data.audioUrl}`);
    console.log(
      `   Script length: ${generateResponse.data.script.length} characters`
    );

    // Test complete
    console.log("\n✅ End-to-end test completed successfully!");
    console.log(
      "Test your frontend application to listen to the generated podcast"
    );

    return true;
  } catch (error) {
    console.error("❌ Test failed with error:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
    return false;
  }
}

// Run the test
testFullWorkflow()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error("Test failed with error:", err);
    process.exit(1);
  });
