/**
 * Utility for handling audio URL construction and error handling
 */
export const getProperAudioUrl = (audioPath) => {
  if (!audioPath) return "";

  // If it's already a full URL
  if (audioPath.startsWith("http")) {
    return audioPath;
  }

  // If we're using a relative path
  const baseUrl = process.env.REACT_APP_API_URL || window.location.origin;
  return `${baseUrl}${audioPath}`;
};

export const handleAudioError = (error) => {
  console.error("Audio playback error:", error);
  return "An error occurred loading the audio. Please try again.";
};
