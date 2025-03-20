const fs = require("fs-extra");
const { execSync } = require("child_process");
const { promisify } = require("util");
const stream = require("stream");
const pipeline = promisify(stream.pipeline);
const path = require("path");

/**
 * Check if ffmpeg is installed and available
 * @returns {boolean} True if ffmpeg is available, false otherwise
 */
function isFFmpegAvailable() {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch (e) {
    return false;
  }
}

// Check ffmpeg availability once at startup
const ffmpegAvailable = isFFmpegAvailable();
if (!ffmpegAvailable) {
  console.warn(
    "⚠️ ffmpeg is not installed. Audio quality will be significantly reduced."
  );
  console.warn("Please install ffmpeg for optimal audio quality:");
  console.warn("- macOS: brew install ffmpeg");
  console.warn("- Ubuntu/Debian: sudo apt install ffmpeg");
  console.warn("- Windows: download from https://ffmpeg.org/download.html");
}

/**
 * Create a silent audio file of specified duration
 * @param {string} outputFile - Path to save the silence file
 * @param {number} durationSeconds - Duration of silence in seconds
 * @returns {Promise<boolean>} Success/failure
 */
async function createSilence(outputFile, durationSeconds) {
  try {
    // Try using ffmpeg (more accurate)
    if (ffmpegAvailable) {
      execSync(
        `ffmpeg -f lavfi -i anullsrc=r=24000:cl=mono -t ${durationSeconds} -q:a 9 -acodec libmp3lame "${outputFile}"`,
        { stdio: "ignore" }
      );
      return true;
    } else {
      // If ffmpeg fails, create a minimal MP3 file
      console.log("Using fallback silence generator");

      // Create a minimal valid MP3 file
      const silenceBuffer = Buffer.from([
        // MP3 header and minimal silent frame
        0xff, 0xfb, 0x90, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        // Repeat for a longer silence
        0xff, 0xfb, 0x90, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        // Another frame for longer silence
        0xff, 0xfb, 0x90, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
      ]);

      await fs.writeFile(outputFile, silenceBuffer);
      return true;
    }
  } catch (error) {
    console.error("Failed to create silence file:", error);
    return false;
  }
}

/**
 * Combine multiple audio files into one
 * @param {string[]} files - Array of file paths to combine
 * @param {string} outputFile - Output file path
 * @returns {Promise<boolean>} Success/failure
 */
async function combineAudioFiles(files, outputFile) {
  if (files.length === 0) {
    throw new Error("No audio files to combine");
  }

  try {
    // Try using ffmpeg (better quality)
    if (ffmpegAvailable) {
      // Create temp file list for ffmpeg
      const tempListFile = `${outputFile}.list`;
      await fs.writeFile(
        tempListFile,
        files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n")
      );

      execSync(
        `ffmpeg -f concat -safe 0 -i "${tempListFile}" -c copy "${outputFile}"`,
        { stdio: "ignore" }
      );

      // Clean up temp file
      await fs.remove(tempListFile);
      return true;
    } else {
      // Fallback to improved native Node.js method
      console.log("Using fallback file combiner (ffmpeg not available)");

      // Create a temporary concatenation directory
      const tempDir = path.dirname(outputFile);
      const combinedTempFile = path.join(
        tempDir,
        `combined_temp_${Date.now()}.mp3`
      );

      // Use a single writeStream to avoid memory leaks
      const writeStream = fs.createWriteStream(combinedTempFile);

      // Process each file sequentially to avoid memory issues
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!(await fs.pathExists(file))) {
          console.warn(`Warning: File not found: ${file}`);
          continue;
        }

        // Read the file content and write it to the combined file
        const fileContent = await fs.readFile(file);
        writeStream.write(fileContent);
      }

      // Close the write stream properly
      await new Promise((resolve, reject) => {
        writeStream.end();
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });

      // Move the temp file to the final location
      await fs.move(combinedTempFile, outputFile, { overwrite: true });
      return true;
    }
  } catch (error) {
    console.error("Failed to combine audio files:", error);
    return false;
  }
}

/**
 * Post-process an MP3 file to fix potential structural issues
 * @param {string} inputFile - Path to the input file
 * @param {string} outputFile - Path to save the processed file (can be same as input)
 * @returns {Promise<boolean>} Success/failure
 */
async function repairMp3File(inputFile, outputFile) {
  if (!ffmpegAvailable) {
    console.warn("Cannot repair MP3: ffmpeg not available");
    return false;
  }

  try {
    const tempFile = `${outputFile}.repaired.mp3`;

    // Use ffmpeg to re-encode the MP3 file, which fixes header and frame issues
    console.log(`Repairing MP3 file: ${inputFile}`);

    // Command with options specifically to fix MP3 streaming issues:
    // -c:a libmp3lame - Use LAME MP3 encoder
    // -b:a 128k - Use consistent bitrate for better streaming
    // -ar 44100 - Standard sampling rate for wide compatibility
    // -ac 2 - Stereo audio
    // -write_xing 1 - Write Xing header for better streaming
    // -id3v2_version 3 - Compatible ID3 tags
    execSync(
      `ffmpeg -y -i "${inputFile}" -c:a libmp3lame -b:a 128k -ar 44100 -ac 2 -write_xing 1 -id3v2_version 3 "${tempFile}"`,
      { stdio: "ignore" }
    );

    // Verify the repaired file
    const stats = await fs.stat(tempFile);
    if (stats.size < 1024) {
      console.error("Repaired MP3 file is too small, repair failed");
      return false;
    }

    // Replace the original with the repaired version
    await fs.move(tempFile, outputFile, { overwrite: true });
    console.log(`MP3 repair complete: ${outputFile} (${stats.size} bytes)`);
    return true;
  } catch (error) {
    console.error("Failed to repair MP3 file:", error);
    return false;
  }
}

module.exports = {
  createSilence,
  combineAudioFiles,
  isFFmpegAvailable,
  repairMp3File,
};
