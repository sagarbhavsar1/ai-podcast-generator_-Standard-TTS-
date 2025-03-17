const { execSync } = require("child_process");
const fs = require("fs");

// Check if package.json exists
if (!fs.existsSync("package.json")) {
  console.log("Creating package.json...");
  execSync("npm init -y");
}

console.log("Installing required dependencies...");
execSync(
  "npm install tesseract.js@^4.1.1 pdf-lib@^1.17.1 pdf-parse@^1.1.1 --save"
);

console.log("Dependencies installed successfully.");
console.log("Note: For best PDF text extraction, consider installing poppler:");
console.log("- On macOS: brew install poppler");
console.log("- On Ubuntu: sudo apt-get install poppler-utils");
console.log(
  "- On Windows: Install from http://blog.alivate.com.au/poppler-windows/"
);
