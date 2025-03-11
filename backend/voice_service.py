import sys
import json
import os
import time
import requests
import numpy as np
import soundfile as sf
import io

def generate_podcast_audio(script):
    """
    Generate podcast audio using Kokoro TTS API.
    Creates a WAV file with natural speech for the podcast conversation.
    """
    output_filename = f"../public/podcasts/podcast_{int(time.time())}.wav"

    # Ensure temp and output directories exist
    os.makedirs("../temp", exist_ok=True)
    os.makedirs("../public/podcasts", exist_ok=True)

    # Parse script into speaker turns
    lines = script.strip().split('\n')
    audio_segments = []
    sample_rate = 24000  # Kokoro's output sample rate

    # Process each line
    for i, line in enumerate(lines):
        if not line.strip():
            continue

        parts = line.split(':', 1)
        if len(parts) != 2:
            continue

        speaker, text = parts[0].strip(), parts[1].strip()

        # Select voice based on speaker
        voice = "am_adam" if "Host A" in speaker else "bf_emma"


        # Generate speech using Kokoro API
        temp_file = f"../temp/line_{i}.wav"

        try:
            # Call the Kokoro API with the correct endpoint
            response = requests.post(
                "http://localhost:8343/v1/audio/speech",
                json={
                    "model": "kokoro",
                    "input": text,
                    "voice": voice
                },
                headers={"accept": "application/json", "Content-Type": "application/json"}
            )

            if response.status_code == 200:
                # Save the binary audio data directly to file
                with open(temp_file, "wb") as f:
                    f.write(response.content)

                # Keep track of the file
                audio_segments.append(temp_file)
            else:
                print(f"Error generating audio for line {i}: {response.text}")
        except Exception as e:
            print(f"Exception generating audio for line {i}: {str(e)}")

    # Combine all audio segments
    if audio_segments:
        combined_audio = []
        for file in audio_segments:
            try:
                audio, sr = sf.read(file)
                combined_audio.append(audio)
            except Exception as e:
                print(f"Error processing audio file {file}: {str(e)}")

        if combined_audio:
            # Concatenate all audio
            final_audio = np.concatenate(combined_audio)

            # Save to output file
            sf.write(output_filename, final_audio, sample_rate)
        else:
            # Create an empty file if no audio was processed
            sf.write(output_filename, np.zeros(1000), sample_rate)

        # Clean up temp files
        for file in audio_segments:
            if os.path.exists(file):
                os.remove(file)
    else:
        # Create an empty file if no audio was generated
        sf.write(output_filename, np.zeros(1000), sample_rate)

    return output_filename

if __name__ == "__main__":
    # Read input from stdin
    script_data = json.loads(sys.stdin.read())
    output_file = generate_podcast_audio(script_data.get("script", ""))
    # Only output the JSON, no status messages
    print(json.dumps({"audio_file": output_file}))
