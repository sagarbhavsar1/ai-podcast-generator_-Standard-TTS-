import sys
import json
import os
import time
import requests
import numpy as np
import soundfile as sf
import io
import random
import re

def generate_podcast_audio(script_data):
    """
    Generate podcast audio using Kokoro TTS API with enhanced naturalness.
    Creates a WAV file with natural speech for the podcast conversation.
    """
    output_filename = f"../public/podcasts/podcast_{int(time.time())}.wav"

    # Get the script and voice preferences
    script = script_data.get("script", "")
    voices = script_data.get("voices", {})
    host_a_voice = voices.get("hostA", "af_bella")  # Updated to use bella
    host_b_voice = voices.get("hostB", "am_Echo")   # Updated to use Echo

    # Ensure temp and output directories exist
    os.makedirs("../temp", exist_ok=True)
    os.makedirs("../public/podcasts", exist_ok=True)

    # Parse script into speaker turns
    lines = script.strip().split('\n')
    audio_segments = []
    sample_rate = 24000  # Kokoro's output sample rate

    # Voice settings for consistency
    host_a_settings = {
        "voice": host_a_voice,
        "speed": 1.0,
        "pitch": 0.0,  # Default pitch
        "volume": 1.0   # Default volume
    }

    host_b_settings = {
        "voice": host_b_voice,
        "speed": 1.0,
        "pitch": 0.0,  # Default pitch
        "volume": 1.0   # Default volume
    }

    # Process each line with retry logic
    for i, line in enumerate(lines):
        if not line.strip():
            continue

        parts = line.split(':', 1)
        if len(parts) != 2:
            continue

        speaker, text = parts[0].strip(), parts[1].strip()

        # Select voice settings based on speaker
        if "Host A" in speaker:
            voice_settings = host_a_settings.copy()
            # Slight variations for naturalness while maintaining consistency
            voice_settings["speed"] = random.uniform(0.97, 1.03)
        else:
            voice_settings = host_b_settings.copy()
            # Slight variations for naturalness while maintaining consistency
            voice_settings["speed"] = random.uniform(0.97, 1.03)

        # Process emotional cues and pauses
        text, emotion_adjustments = process_emotional_cues(text)

        # Apply emotion-based adjustments to voice settings
        for param, adjustment in emotion_adjustments.items():
            if param in voice_settings:
                voice_settings[param] += adjustment

        # Generate speech using Kokoro API with retry logic
        temp_file = f"../temp/line_{i}.wav"

        # Clean up text - remove any remaining bracketed content
        clean_text = re.sub(r'\[.*?\]', '', text).strip()

        # Replace pause markers with actual pauses (periods)
        clean_text = clean_text.replace("[pause]", ".")

        # Try up to 3 times to generate this line
        max_retries = 3
        for retry in range(max_retries):
            try:
                # Call the Kokoro API with the correct endpoint and voice settings
                response = requests.post(
                    "http://localhost:8343/v1/audio/speech",
                    json={
                        "model": "kokoro",
                        "input": clean_text,
                        "voice": voice_settings["voice"],
                        "speed": voice_settings["speed"]
                        # Note: Kokoro may not support pitch and volume directly
                    },
                    headers={"accept": "application/json", "Content-Type": "application/json"},
                    timeout=15  # Shorter timeout to fail faster
                )

                if response.status_code == 200:
                    # Save the binary audio data directly to file
                    with open(temp_file, "wb") as f:
                        f.write(response.content)

                    # Keep track of the file
                    audio_segments.append(temp_file)

                    # Add strategic pauses based on content
                    if "[pause]" in text or re.search(r'[.!?]', text):
                        pause_file = f"../temp/pause_{i}.wav"
                        # Create a pause of appropriate length
                        pause_length = 0.4  # Default pause

                        # Longer pauses for sentence endings
                        if "." in text:
                            pause_length = 0.6
                        elif "!" in text or "?" in text:
                            pause_length = 0.7

                        pause_samples = int(sample_rate * pause_length)
                        pause_audio = np.zeros(pause_samples)
                        sf.write(pause_file, pause_audio, sample_rate)
                        audio_segments.append(pause_file)

                    # Success - break out of retry loop
                    break
                else:
                    print(f"Error generating audio for line {i} (attempt {retry+1}/{max_retries}): {response.text}", file=sys.stderr)
                    if retry < max_retries - 1:
                        # Wait before retrying
                        time.sleep(2)
            except Exception as e:
                print(f"Exception generating audio for line {i} (attempt {retry+1}/{max_retries}): {str(e)}", file=sys.stderr)
                if retry < max_retries - 1:
                    # Wait before retrying
                    time.sleep(2)

        # Add a small delay between processing lines to avoid overwhelming the TTS service
        time.sleep(0.5)

    # Combine all audio segments
    if audio_segments:
        combined_audio = []
        for file in audio_segments:
            try:
                if os.path.exists(file) and os.path.getsize(file) > 0:
                    audio, sr = sf.read(file)
                    combined_audio.append(audio)
            except Exception as e:
                print(f"Error processing audio file {file}: {str(e)}", file=sys.stderr)

        if combined_audio:
            # Concatenate all audio
            final_audio = np.concatenate(combined_audio)

            # Apply audio enhancements
            final_audio = enhance_audio(final_audio)

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

def process_emotional_cues(text):
    """Process emotional cues in text and return adjustments for TTS parameters"""
    # Default adjustments (no change)
    adjustments = {
        "speed": 0.0,
        "pitch": 0.0,
        "volume": 0.0
    }

    # Remove [pause] markers for processing (we'll handle them separately)
    text_without_pauses = text.replace("[pause]", "")

    # Look for emotional cues in brackets and adjust parameters
    excited_pattern = r'\[excited\]|\[enthusiastic\]|\[energetic\]'
    if re.search(excited_pattern, text_without_pauses, re.IGNORECASE):
        adjustments["speed"] = 0.05  # Slightly faster
        adjustments["pitch"] = 0.1   # Slightly higher pitch
        adjustments["volume"] = 0.1  # Slightly louder

    sad_pattern = r'\[sad\]|\[disappointed\]|\[somber\]'
    if re.search(sad_pattern, text_without_pauses, re.IGNORECASE):
        adjustments["speed"] = -0.1  # Slower
        adjustments["pitch"] = -0.1  # Lower pitch

    thoughtful_pattern = r'\[thoughtful\]|\[contemplative\]|\[reflective\]'
    if re.search(thoughtful_pattern, text_without_pauses, re.IGNORECASE):
        adjustments["speed"] = -0.05  # Slightly slower

    surprised_pattern = r'\[surprised\]|\[shocked\]|\[amazed\]'
    if re.search(surprised_pattern, text_without_pauses, re.IGNORECASE):
        adjustments["speed"] = 0.1   # Faster
        adjustments["pitch"] = 0.15  # Higher pitch

    questioning_pattern = r'\[questioning\]|\[curious\]|\[inquisitive\]'
    if re.search(questioning_pattern, text_without_pauses, re.IGNORECASE):
        adjustments["pitch"] = 0.05  # Slightly higher pitch at the end

    # Return the text with adjustments
    return text, adjustments

def enhance_audio(audio_data):
    """Apply audio enhancements to make the podcast sound more natural"""
    # This is a simple implementation - for more advanced processing,
    # consider using libraries like librosa or scipy for filtering

    # Add a tiny bit of noise to make it sound less digital
    noise_level = 0.0005  # Reduced from previous version
    noise = np.random.normal(0, noise_level, len(audio_data))
    enhanced_audio = audio_data + noise

    # Normalize audio to prevent clipping
    max_amplitude = np.max(np.abs(enhanced_audio))
    if max_amplitude > 0:
        enhanced_audio = enhanced_audio * (0.9 / max_amplitude)

    return enhanced_audio

def preprocess_text_for_tts(text):
    """Prepare text for TTS to avoid spelling out and improve pronunciation"""
    # Replace abbreviations with full words to prevent spelling out
    replacements = {
        "e.g.": "for example",
        "i.e.": "that is",
        "etc.": "etcetera",
        "vs.": "versus",
        "Fig.": "Figure",
        "fig.": "figure",
        "Dr.": "Doctor",
        "Mr.": "Mister",
        "Mrs.": "Misses",
        "Ph.D.": "PhD",
        "M.D.": "MD",
        "B.A.": "BA",
        "M.A.": "MA",
        "B.S.": "BS",
        "M.S.": "MS",
        "U.S.": "US",
        "U.K.": "UK",
        "E.U.": "EU"
    }

    for abbr, full in replacements.items():
        text = text.replace(abbr, full)

    # Handle numbers and percentages for better pronunciation
    text = text.replace("%", " percent")

    # Remove any remaining problematic characters
    text = text.replace("*", "")
    text = text.replace("#", "number ")
    text = text.replace("&", "and")
    text = text.replace("@", "at")

    return text

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
