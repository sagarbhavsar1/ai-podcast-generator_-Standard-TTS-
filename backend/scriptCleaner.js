/**
 * Utilities for cleaning podcast scripts
 */

/**
 * Clean a podcast script to remove stage directions and ensure proper format
 * @param {string} script - The raw script from the AI
 * @returns {string} The cleaned script
 */
function cleanPodcastScript(script) {
  // Split into lines
  const lines = script.split("\n");
  const cleanedLines = [];
  let skipNextLines = 0;

  // Process each line
  for (let i = 0; i < lines.length; i++) {
    // Skip lines if we're in a skipping phase
    if (skipNextLines > 0) {
      skipNextLines--;
      continue;
    }

    let line = lines[i].trim();

    // Skip empty lines
    if (!line) {
      cleanedLines.push("");
      continue;
    }

    // Skip pure stage directions
    if (/^\[.*\]$/.test(line)) {
      continue;
    }

    // Skip typical podcast metadata at the start
    if (
      i < 5 &&
      (/^title:/i.test(line) ||
        /^episode/i.test(line) ||
        /^intro:/i.test(line) ||
        /^duration:/i.test(line) ||
        /^theme:/i.test(line) ||
        /^music/i.test(line))
    ) {
      // Also skip the next line if it's likely a value for this metadata
      skipNextLines = 1;
      continue;
    }

    // Handle lines with speaker
    if (line.includes(":")) {
      const parts = line.split(":", 2);
      const speaker = parts[0].trim();
      let text = parts[1].trim();

      // Skip non-host speakers (sound effects, music, etc.)
      if (!/^host\s*[ab12]/i.test(speaker)) {
        continue;
      }

      // Remove any stage directions
      text = text.replace(/\[.*?\]/g, "");

      // Skip if the line is now empty
      if (!text.trim()) continue;

      // Add the cleaned line
      cleanedLines.push(`${speaker}: ${text}`);
    }
    // Skip lines without speaker designation
    else {
      continue;
    }
  }

  return cleanedLines.join("\n");
}

/**
 * Extract speaker information from a text line
 * @param {string} line - Line of script
 * @returns {object} speaker and text information
 */
function extractSpeakerInfo(line) {
  if (!line || !line.includes(":")) {
    return { isValid: false };
  }

  const parts = line.split(":", 2);
  const speaker = parts[0].trim();
  const text = parts[1] ? parts[1].trim() : "";

  const isHostA = /^host\s*a/i.test(speaker) || /^host\s*1/i.test(speaker);
  const isHostB = /^host\s*b/i.test(speaker) || /^host\s*2/i.test(speaker);

  // Remove stage directions from text
  const cleanText = text.replace(/\[.*?\]/g, "").trim();

  return {
    isValid: (isHostA || isHostB) && cleanText.length > 0,
    isHostA,
    isHostB,
    speaker,
    text: cleanText,
  };
}

module.exports = {
  cleanPodcastScript,
  extractSpeakerInfo,
};
