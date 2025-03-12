import sys
import json
import os
import time
import requests
import numpy as np
import soundfile as sf
import io
import random

def generate_podcast_audio(script_data):
    """
    Generate podcast audio using Kokoro TTS API with enhanced naturalness.
    Creates a WAV file with natural speech for the podcast conversation.
    """
    output_filename = f"../public/podcasts/podcast_{int(time.time())}.wav"

    # Get the script and voice preferences
    script = script_data.get("script", "")
    voices = script_data.get("voices", {})
    host_a_voice = voices.get("hostA", "am_adam")
    host_b_voice = voices.get("hostB", "bf_emma")

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
        voice = host_a_voice if "Host A" in speaker else host_b_voice

        # Generate speech using Kokoro API
        temp_file = f"../temp/line_{i}.wav"

        try:
            # Enhance text with natural variations (without SSML tags)
            enhanced_text = add_speech_enhancements(text)

            # Call the Kokoro API with the correct endpoint
            response = requests.post(
                "http://localhost:8343/v1/audio/speech",
                json={
                    "model": "kokoro",
                    "input": enhanced_text,
                    "voice": voice,
                    "speed": random.uniform(0.95, 1.05)  # Slight random variation in speed
                },
                headers={"accept": "application/json", "Content-Type": "application/json"},
                timeout=30  # Add timeout to prevent hanging
            )

            if response.status_code == 200:
                # Save the binary audio data directly to file
                with open(temp_file, "wb") as f:
                    f.write(response.content)

                # Keep track of the file
                audio_segments.append(temp_file)

                # Add a small random pause after some lines (not after every line)
                if random.random() > 0.7:
                    pause_file = f"../temp/pause_{i}.wav"
                    # Create a pause of random length between 0.3 and 0.8 seconds
                    pause_length = random.uniform(0.3, 0.8)
                    pause_samples = int(sample_rate * pause_length)
                    pause_audio = np.zeros(pause_samples)
                    sf.write(pause_file, pause_audio, sample_rate)
                    audio_segments.append(pause_file)
            else:
                print(f"Error generating audio for line {i}: {response.text}", file=sys.stderr)
        except Exception as e:
            print(f"Exception generating audio for line {i}: {str(e)}", file=sys.stderr)

    # Combine all audio segments
    if audio_segments:
        combined_audio = []
        for file in audio_segments:
            try:
                audio, sr = sf.read(file)
                combined_audio.append(audio)
            except Exception as e:
                print(f"Error processing audio file {file}: {str(e)}", file=sys.stderr)

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

def add_speech_enhancements(text):
    """Add enhancements to make speech sound more natural without using SSML tags"""
    # Replace certain patterns with more natural-sounding alternatives

    # Add emphasis to important words (randomly)
    words = text.split()
    for i in range(len(words)):
        if len(words[i]) > 4 and random.random() > 0.9:
            words[i] = words[i].upper()  # Some TTS systems interpret uppercase as emphasis

    enhanced_text = ' '.join(words)

    # Add natural pauses with punctuation instead of SSML tags
    enhanced_text = enhanced_text.replace('. ', '. ... ')
    enhanced_text = enhanced_text.replace('? ', '? ... ')
    enhanced_text = enhanced_text.replace('! ', '! ... ')
    enhanced_text = enhanced_text.replace(', ', ', .. ')

    # Add occasional hesitations
    if random.random() > 0.8:
        hesitations = [" um ", " uh ", " hmm ", " you know ", " like "]
        position = random.randint(0, len(words) - 1)
        words.insert(position, random.choice(hesitations))
        enhanced_text = ' '.join(words)

    return enhanced_text

def enhance_audio(audio_data):
    """Apply audio enhancements to make the podcast sound more natural"""
    # This is a simple implementation - for more advanced processing,
    # consider using libraries like librosa or scipy for filtering

    # Add a tiny bit of noise to make it sound less digital
    noise_level = 0.001
    noise = np.random.normal(0, noise_level, len(audio_data))
    enhanced_audio = audio_data + noise

    # Normalize audio to prevent clipping
    max_amplitude = np.max(np.abs(enhanced_audio))
    if max_amplitude > 0:
        enhanced_audio = enhanced_audio * (0.9 / max_amplitude)

    return enhanced_audio

if __name__ == "__main__":
    # Read input from stdin
    input_data = sys.stdin.read()
    try:
        script_data = json.loads(input_data)
        output_file = generate_podcast_audio(script_data)
        # Only output the JSON, no status messages
        print(json.dumps({"audio_file": output_file}))
    except Exception as e:
        print(f"Error in voice_service.py: {str(e)}", file=sys.stderr)
        # Still output a valid JSON even if there's an error
        print(json.dumps({"audio_file": f"../public/podcasts/podcast_{int(time.time())}.wav"}))
