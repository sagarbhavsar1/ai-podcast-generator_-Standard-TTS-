/**
 * Utility functions for podcast script generation and processing
 */

// Calculate word count from script text
function countWords(script) {
  if (!script) return 0;
  return script
    .replace(/\[.*?\]/g, "") // Remove stage directions
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

// Create a proper conclusion if needed
function ensureProperConclusion(script, minConclusionWords = 100) {
  const lines = script.split("\n");
  let hasProperConclusion = false;

  // Check last 5 lines for conclusion patterns
  const lastLines = lines.slice(-5).join(" ").toLowerCase();
  const conclusionPatterns = [
    "wrap up",
    "conclude",
    "to sum up",
    "in conclusion",
    "thank you for listening",
    "thanks for joining",
    "until next time",
  ];

  // Check if any conclusion patterns exist in last lines
  hasProperConclusion = conclusionPatterns.some((pattern) =>
    lastLines.includes(pattern)
  );

  if (!hasProperConclusion) {
    console.log("No proper conclusion detected, adding one...");

    // Add a natural conclusion
    lines.push("");
    lines.push(
      "Host A: Well, that brings us to the end of our discussion today. We covered a lot of ground on this fascinating topic."
    );
    lines.push(
      "Host B: Absolutely! I really enjoyed our conversation. There's so much depth to this subject, and I feel like we've given our listeners a good overview of the key points."
    );
    lines.push(
      "Host A: If you found this interesting, we encourage you to dive deeper into some of the concepts we covered today."
    );
    lines.push(
      "Host B: Thanks for joining us, and we hope you'll tune in next time for more engaging discussions!"
    );
  }

  return lines.join("\n");
}

module.exports = {
  countWords,
  ensureProperConclusion,
};
