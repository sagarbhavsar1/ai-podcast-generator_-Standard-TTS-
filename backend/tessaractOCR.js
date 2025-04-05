const fs = require("fs-extra");
const path = require("path");
const pdfParse = require("pdf-parse");

// Main function to extract text from PDF - Linux compatible version
async function extractTextFromPdf(pdfPath) {
  try {
    // Use pdf-parse which works on all platforms
    const dataBuffer = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(dataBuffer);

    // Return the extracted text
    return pdfData.text || "Unable to extract text from PDF";
  } catch (error) {
    console.error("Error extracting text from PDF:", error);
    return "Error processing PDF document. Please try another file.";
  }
}

module.exports = {
  extractTextFromPdf,
};
