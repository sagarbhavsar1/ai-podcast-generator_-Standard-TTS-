const tesseract = require("node-tesseract-ocr");
const pdf = require("pdf-poppler");
const fs = require("fs-extra");
const path = require("path");
const pdfParse = require("pdf-parse");

// Configure Tesseract
const config = {
  lang: "eng",
  oem: 1,
  psm: 3,
};

// Function to convert PDF to images
async function convertPdfToImages(pdfPath) {
  const tempDir = path.join(__dirname, "../temp");
  await fs.ensureDir(tempDir);

  const outputDir = tempDir;
  const outputFile = path.join(outputDir, "output");

  const options = {
    format: "jpeg",
    out_dir: outputDir,
    out_prefix: "output",
    page: null,
  };

  try {
    await pdf.convert(pdfPath, options);

    // Get all generated image files
    const files = await fs.readdir(outputDir);
    const imageFiles = files
      .filter((file) => file.startsWith("output-") && file.endsWith(".jpg"))
      .map((file) => path.join(outputDir, file))
      .sort((a, b) => {
        // Sort by page number
        const pageA = parseInt(a.match(/output-(\d+)\.jpg/)[1]);
        const pageB = parseInt(b.match(/output-(\d+)\.jpg/)[1]);
        return pageA - pageB;
      });

    return imageFiles;
  } catch (error) {
    console.error("Error converting PDF to images:", error);
    throw error;
  }
}

// Function to extract text from images using OCR
async function extractTextFromImages(imageFiles) {
  let fullText = "";

  for (const imageFile of imageFiles) {
    try {
      const text = await tesseract.recognize(imageFile, config);
      fullText += text + "\n\n";
    } catch (error) {
      console.error(`Error processing image ${imageFile}:`, error);
    }
  }

  return fullText;
}

// Main function to extract text from PDF
async function extractTextFromPdf(pdfPath) {
  try {
    // First try standard PDF extraction
    const dataBuffer = fs.readFileSync(pdfPath);
    try {
      const pdfData = await pdfParse(dataBuffer);
      if (pdfData.text && pdfData.text.trim().length > 100) {
        // If we got reasonable text from pdf-parse, use it
        return pdfData.text;
      }
    } catch (e) {
      console.log("Standard PDF extraction failed, falling back to OCR");
    }

    // If standard extraction failed or returned too little text, use OCR
    const imageFiles = await convertPdfToImages(pdfPath);
    const text = await extractTextFromImages(imageFiles);

    // Clean up temporary files
    for (const file of imageFiles) {
      await fs.remove(file);
    }

    return text;
  } catch (error) {
    console.error("Error extracting text from PDF:", error);
    throw error;
  }
}

module.exports = {
  extractTextFromPdf,
};
