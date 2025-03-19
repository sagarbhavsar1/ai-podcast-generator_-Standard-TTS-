const axios = require("axios");
const fs = require("fs");
const util = require("util");
const writeFile = util.promisify(fs.writeFile);

async function synthesizeSpeech(text, voice, outputFile) {
  try {
    // Example using Google Cloud TTS
    const response = await axios({
      method: "post",
      url: "https://texttospeech.googleapis.com/v1/text:synthesize",
      headers: {
        Authorization: `Bearer ${process.env.GOOGLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      data: {
        input: { text },
        voice: { languageCode: "en-US", name: voice },
        audioConfig: { audioEncoding: "MP3" },
      },
      responseType: "json",
    });

    // Decode and save the audio
    const audioContent = Buffer.from(response.data.audioContent, "base64");
    await writeFile(outputFile, audioContent);
    return true;
  } catch (error) {
    console.error(`Error synthesizing speech: ${error}`);
    return false;
  }
}

module.exports = { synthesizeSpeech };
