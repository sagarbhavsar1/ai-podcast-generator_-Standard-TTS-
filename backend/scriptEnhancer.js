/**
 * Script Enhancer - Improves podcast script quality
 */

/**
 * Analyzes a podcast script to detect and fix common issues
 * @param {string} script - The raw podcast script
 * @returns {object} Analysis results and improved script
 */
function analyzeScript(script) {
  const results = {
    hasHostA: false,
    hasHostB: false,
    hostALines: 0,
    hostBLines: 0,
    hasSubscriptionLanguage: false,
    hasConversationalElements: false,
    hasProperConclusion: false,
    improvements: [],
    improvedScript: script,
  };

  // Check for hosts (include both old and new names)
  results.hasHostA = /Host A:|Ashley:/i.test(script);
  results.hasHostB = /Host B:|Ric:/i.test(script);

  // Count lines per host
  const lines = script.split("\n");
  lines.forEach((line) => {
    if (/Host A:|Ashley:/i.test(line)) results.hostALines++;
    if (/Host B:|Ric:/i.test(line)) results.hostBLines++;
  });

  // Check for subscription language
  const subscriptionPatterns = [
    /subscribe/i,
    /next episode/i,
    /tune in next/i,
    /follow us/i,
    /like and share/i,
  ];

  results.hasSubscriptionLanguage = subscriptionPatterns.some((pattern) =>
    pattern.test(script)
  );

  // Check for conversational elements
  const conversationalPatterns = [
    /\bum\b|\buh\b|\blike\b|\byou know\b|\by'know\b/i, // filler words
    /\bwait\b|\breally\?|\bseriously\?|\bno way\b/i, // interruptions/reactions
    /\bexactly\b|\bright\b|\byeah\b|\bhmmm\b/i, // back-channeling
    /\[surprised\]|\[laughs\]|\[excited\]/i, // emotional cues
  ];

  results.hasConversationalElements = conversationalPatterns.some((pattern) =>
    pattern.test(script)
  );

  // Check for proper conclusion (for analysis only, we won't modify it)
  const lastFewLines = lines.slice(-5).join(" ").toLowerCase();
  const conclusionPatterns = [
    /final thought/i,
    /takeaway/i,
    /to conclude/i,
    /in conclusion/i,
    /really makes you think/i,
    /that's all/i,
    /wrap up/i,
    /thank you for listening/i,
    /thanks for joining/i,
    /until next time/i,
  ];

  results.hasProperConclusion = conclusionPatterns.some((pattern) =>
    pattern.test(lastFewLines)
  );

  // Prepare improved script if issues found
  let improvedScript = script;

  // Fix subscription language if found
  if (results.hasSubscriptionLanguage) {
    results.improvements.push("Removed subscription language");
    improvedScript = removeSubscriptionLanguage(improvedScript);
  }

  // Add conversational elements if lacking
  if (!results.hasConversationalElements) {
    results.improvements.push("Added conversational elements");
    improvedScript = enhanceConversationalElements(improvedScript);
  }

  // NOTE: We've removed the conclusion improvement feature
  // as it was causing content issues

  // Replace any remaining Host A/B with Ashley/Ric
  improvedScript = improvedScript
    .replace(/Host A:/gi, "Ashley:")
    .replace(/Host B:/gi, "Ric:");

  results.improvedScript = improvedScript;
  return results;
}

/**
 * Removes subscription language and references to future episodes
 */
function removeSubscriptionLanguage(script) {
  const lines = script.split("\n");
  const filteredLines = lines.filter((line) => {
    // Filter out lines that are solely about subscriptions
    const subscriptionPatterns = [
      /subscribe to our podcast/i,
      /don't forget to subscribe/i,
      /hit that subscribe button/i,
      /tune in next time/i,
      /join us next week/i,
      /follow us on/i,
    ];

    return !subscriptionPatterns.some((pattern) => pattern.test(line));
  });

  // Join the filtered lines
  return filteredLines.join("\n");
}

/**
 * Enhances conversational elements in the script
 */
function enhanceConversationalElements(script) {
  const lines = script.split("\n");
  const enhancedLines = [];

  // Conversational enhancers to add
  const fillerWords = ["um", "like", "you know", "I mean"];
  const backChannels = ["Right", "Exactly", "Hmm", "Yeah"];
  const reactions = ["Wow", "Wait, really?", "That's fascinating", "No way"];

  // Process each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines
    if (!line.trim()) {
      enhancedLines.push(line);
      continue;
    }

    // Check if this is a host line
    if (
      line.includes("Host A:") ||
      line.includes("Ashley:") ||
      line.includes("Host B:") ||
      line.includes("Ric:")
    ) {
      // Random chance to enhance this line
      if (Math.random() < 0.3) {
        // Extract parts
        const [speaker, text] = line.split(":", 2);

        // Choose enhancement type (filler, reaction)
        if (Math.random() < 0.5) {
          // Add filler word
          const filler =
            fillerWords[Math.floor(Math.random() * fillerWords.length)];
          const words = text.trim().split(" ");

          // Insert filler at beginning or middle
          if (words.length > 5 && Math.random() < 0.5) {
            // Middle
            const position = Math.floor(words.length / 2);
            words.splice(position, 0, filler);
          } else {
            // Beginning
            words.unshift(filler);
          }

          // Combine back
          enhancedLines.push(`${speaker}: ${words.join(" ")}`);
        } else {
          // Add reaction if this is a response line (not the first line)
          if (i > 0) {
            const reaction =
              backChannels[Math.floor(Math.random() * backChannels.length)];
            enhancedLines.push(`${speaker}: ${reaction}. ${text.trim()}`);
          } else {
            enhancedLines.push(line);
          }
        }
      } else {
        // No enhancement for this line
        enhancedLines.push(line);
      }
    } else {
      // Not a host line
      enhancedLines.push(line);
    }
  }

  return enhancedLines.join("\n");
}

module.exports = {
  analyzeScript,
  removeSubscriptionLanguage,
  enhanceConversationalElements,
};
