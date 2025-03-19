const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

// Create a PDF file with test content
function createTestPDF() {
  const outputPath = path.join(__dirname, "test-document.pdf");
  const doc = new PDFDocument();

  // Pipe output to a file
  doc.pipe(fs.createWriteStream(outputPath));

  // Add content
  doc.fontSize(25).text("Test Document for AI Podcast Generator", {
    align: "center",
  });

  doc.moveDown();
  doc
    .fontSize(12)
    .text(
      "This is a test document that will be processed by the AI Podcast Generator. " +
        "The system should extract this text and convert it into a podcast format with " +
        "two hosts discussing the content in a conversational manner."
    );

  doc.moveDown();
  doc.text(
    "The benefits of AI-generated podcasts include saving time, converting written " +
      "content into audio format, and making information more accessible. However, " +
      "challenges may include maintaining natural speech patterns and ensuring " +
      "accurate representation of the source material."
  );

  doc.moveDown();
  doc.text(
    "This test will verify if the system can properly extract text from a PDF, " +
      "process it through a language model to create a conversational script, " +
      "and then use text-to-speech technology to create the final audio output."
  );

  doc.moveDown();
  doc.text(
    'The podcast should feature two distinct voices, with hosts labeled as "Host A" ' +
      'and "Host B" taking turns to discuss this material. The conversation should ' +
      "flow naturally and include appropriate transitions between topics."
  );

  // Finalize and end the document
  doc.end();

  console.log(`Test PDF created at: ${outputPath}`);
}

createTestPDF();
