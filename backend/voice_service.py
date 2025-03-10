import sys
import json
import os
import time
import wave
import struct
import random

def generate_podcast_audio(script):
    """
    Generate a valid WAV file for podcast audio.
    This creates a dynamic audio file with varying "silence" to simulate speech patterns.
    In production, you would replace this with actual TTS.
    """
    output_filename = f"../public/podcasts/podcast_{int(time.time())}.wav"

    # Create a more interesting WAV file (varying amplitude to simulate speech)
    # Parameters
    sample_rate = 44100  # samples per second
    duration = 30  # seconds (longer for a more realistic podcast length)

    # Create a new WAV file
    with wave.open(output_filename, 'w') as wav_file:
        # Set parameters
        wav_file.setnchannels(1)  # mono
        wav_file.setsampwidth(2)  # 2 bytes per sample (16 bits)
        wav_file.setframerate(sample_rate)

        # Generate audio data with varying amplitude
        # This creates a "pattern" that sounds more like speech than pure silence
        lines = script.split('\n')
        for line in lines:
            if not line.strip():
                continue

            # Determine if it's Host A or Host B
            amplitude = 2000 if "Host A:" in line else 3000

            # Duration based on line length
            line_duration = 0.1 * len(line)  # rough approximation

            # Generate "speech-like" pattern
            for i in range(int(line_duration * sample_rate)):
                # Create a pattern that vaguely resembles speech cadence
                if i % 1000 < 500:
                    value = int(amplitude * 0.8 * random.random())
                else:
                    value = int(amplitude * 0.2 * random.random())
                wav_file.writeframes(struct.pack('h', value))

            # Add a short pause between lines
            for i in range(int(0.5 * sample_rate)):
                wav_file.writeframes(struct.pack('h', 0))

    return output_filename

if __name__ == "__main__":
    # Read input from stdin
    script_data = json.loads(sys.stdin.read())
    output_file = generate_podcast_audio(script_data["script"])
    # Only output the JSON, no status messages
    print(json.dumps({"audio_file": output_file}))
