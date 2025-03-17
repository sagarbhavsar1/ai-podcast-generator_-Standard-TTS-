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

# Update the default TTS service URL to use port 8880 instead of 8343
DEFAULT_TTS_SERVICE_URL = "http://localhost:8880"

# Simple logging with levels - changed to INFO for better visibility
LOG_LEVEL = "INFO"  # Can be "DEBUG", "INFO", "ERROR", "NONE"

# Track failed lines by host
host_a_failed = 0
host_b_failed = 0
host_a_success = 0
host_b_success = 0

def log(level, message):
    """Log messages with priority filtering"""
    if LOG_LEVEL == "NONE":
        return

    levels = {"DEBUG": 0, "INFO": 1, "ERROR": 2}
    if levels.get(level, 0) >= levels.get(LOG_LEVEL, 1):
        # Only show "TTS Error:" prefix for actual errors
        if level == "ERROR":
            print(f"TTS Error: {message}", file=sys.stderr)
        else:
            # For non-error messages, use cleaner format
            print(f"TTS: {message}", file=sys.stderr)

def generate_podcast_audio(script_data):
    """
    Generate podcast audio using Kokoro TTS API with enhanced naturalness.
    Creates a WAV file with natural speech for the podcast conversation.
    """
    output_filename = f"../public/podcasts/podcast_{int(time.time())}.wav"

    global host_a_failed, host_b_failed, host_a_success, host_b_success
    host_a_failed = host_b_failed = host_a_success = host_b_success = 0

    # Get the script and voice preferences
    script = script_data.get("script", "")

    # MODIFIED: Always use bella for Host A and echo for Host B
    host_a_voice = "af_bella"  # Always use bella for Host A
    host_b_voice = "am_echo"   # Always use echo for Host B

    # Log voice assignments for debugging
    log("INFO", f"Voice assignments - Host A: {host_a_voice} (bella), Host B: {host_b_voice} (echo)")

    # Allow TTS service URL override from input data
    tts_service_url = script_data.get("ttsServiceUrl", DEFAULT_TTS_SERVICE_URL)
    log("INFO", f"Using TTS service at: {tts_service_url}")

    # Ensure temp and output directories exist
    os.makedirs("../temp", exist_ok=True)
    os.makedirs("../public/podcasts", exist_ok=True)

    # Split script into lines and remove any empty ones
    lines = [line for line in script.strip().split('\n') if line.strip()]
    log("INFO", f"Processing podcast script with {len(lines)} lines")

    # Check if script has proper host alternation
    host_a_count = sum(1 for line in lines if re.search(r'^Host A:', line, re.IGNORECASE))
    host_b_count = sum(1 for line in lines if re.search(r'^Host B:', line, re.IGNORECASE))
    log("INFO", f"Script contains {host_a_count} Host A lines and {host_b_count} Host B lines")

    # Save script with speaker annotations for debugging
    debug_script_path = f"../temp/debug_script_{int(time.time())}.txt"
    try:
        with open(debug_script_path, "w") as f:
            f.write(f"Host A voice: {host_a_voice}\n")
            f.write(f"Host B voice: {host_b_voice}\n\n")
            f.write(script)
        log("INFO", f"Saved debug script to {debug_script_path}")
    except Exception as e:
        log("ERROR", f"Could not save debug script: {str(e)}")

    # Add dummy Host A/B prefix to any lines missing them to ensure proper alternation
    for i in range(len(lines)):
        if ":" not in lines[i]:
            # Determine which host should speak based on alternating pattern
            if i % 2 == 0:
                lines[i] = f"Host A: {lines[i]}"
            else:
                lines[i] = f"Host B: {lines[i]}"

    audio_segments = []
    sample_rate = 24000  # Kokoro's output sample rate
    processed_line_count = 0
    failed_line_count = 0

    # Voice settings for consistency
    host_a_settings = {"voice": host_a_voice, "speed": 1.0}
    host_b_settings = {"voice": host_b_voice, "speed": 1.0}

    # Process each line with improved speaker detection
    for i, line in enumerate(lines):
        try:
            # Skip truly empty lines
            if not line.strip():
                continue

            # Try to extract speaker and text - more flexible parsing
            if ":" in line:
                parts = line.split(":", 1)  # Split on first colon only
                speaker, text = parts[0].strip(), parts[1].strip()
            else:
                # No colon found, use alternating speakers
                if i % 2 == 0:
                    speaker, text = "Host A", line.strip()
                else:
                    speaker, text = "Host B", line.strip()

            # Skip if text is too short
            if len(text) < 2:
                log("DEBUG", f"Line {i+1}: Skipping - text too short")
                continue

            # IMPROVED SPEAKER DETECTION - More precise regex matching at the beginning of the line
            # This is the key fix that was causing the issue
            is_host_a = bool(re.search(r'^Host\s*A\b|^HOST\s*A\b|^HostA\b|^HOSTA\b', speaker, re.IGNORECASE))
            is_host_b = bool(re.search(r'^Host\s*B\b|^HOST\s*B\b|^HostB\b|^HOSTB\b', speaker, re.IGNORECASE))

            # If neither is matched explicitly, use fallback pattern
            if not is_host_a and not is_host_b:
                if i % 2 == 0:
                    is_host_a = True
                    is_host_b = False
                else:
                    is_host_a = False
                    is_host_b = True
                log("DEBUG", f"Line {i+1}: Using fallback host assignment - Host {is_host_a and 'A' or 'B'}")

            # Log which voice is being used for this line
            if is_host_a:
                voice_settings = host_a_settings.copy()
                voice_settings["speed"] = random.uniform(0.97, 1.03)
                log("DEBUG", f"Line {i+1}: Using HOST A voice ({host_a_voice})")
            else:
                voice_settings = host_b_settings.copy()
                voice_settings["speed"] = random.uniform(0.97, 1.03)
                log("DEBUG", f"Line {i+1}: Using HOST B voice ({host_b_voice})")

            # Process emotional cues and pauses
            text, emotion_adjustments = process_emotional_cues(text)

            # Generate speech using Kokoro API
            temp_file = f"../temp/line_{i}.wav"

            # Clean up text
            clean_text = re.sub(r'\[.*?\]', '', text).strip()
            clean_text = clean_text.replace("[pause]", ".")

            # Basic text preprocessing - improved to handle problematic inputs
            clean_text = preprocess_text_for_tts(clean_text)

            # Skip empty lines after cleaning
            if not clean_text or len(clean_text) < 2:
                log("INFO", f"Line {i+1}: Skipped - no valid text after preprocessing")
                continue

            log("INFO", f"Line {i+1}: Processing \"{clean_text[:30]}...\" with voice {voice_settings['voice']}")

            # Try up to 3 times to generate this line
            max_retries = 3
            success = False

            for retry in range(max_retries):
                try:
                    # Call the Kokoro API
                    response = requests.post(
                        f"{tts_service_url}/v1/audio/speech",
                        json={
                            "model": "kokoro",
                            "input": clean_text,
                            "voice": voice_settings["voice"],
                            "speed": voice_settings["speed"]
                        },
                        headers={"accept": "application/json", "Content-Type": "application/json"},
                        timeout=30  # Increased timeout for longer text
                    )

                    if response.status_code == 200:
                        # Check if response contains audio data (must be significant size)
                        if len(response.content) > 500:  # Increased threshold for valid audio
                            # Save the binary audio data directly to file
                            with open(temp_file, "wb") as f:
                                f.write(response.content)

                            # Verify file was created and has content
                            if os.path.exists(temp_file) and os.path.getsize(temp_file) > 500:
                                audio_segments.append(temp_file)
                                processed_line_count += 1
                                success = True

                                # Update host-specific counters
                                if is_host_a:
                                    host_a_success += 1
                                else:
                                    host_b_success += 1
                            else:
                                log("ERROR", f"Audio file empty for line {i+1}: {speaker}")
                        else:
                            log("ERROR", f"TTS response too small ({len(response.content)} bytes) for: {speaker}: {clean_text[:30]}...")

                        # Add strategic pauses based on content
                        if "[pause]" in text or re.search(r'[.!?]', text):
                            pause_file = f"../temp/pause_{i}.wav"
                            pause_length = 0.4  # Default pause

                            # Longer pauses for sentence endings
                            if "." in text:
                                pause_length = 0.6
                            elif "!" in text or "?" in text:
                                pause_length = 0.7

                            pause_samples = int(sample_rate * pause_length)
                            pause_audio = np.zeros(pause_samples)

                            # Suppressing Xing warnings during write
                            original_stderr = sys.stderr
                            try:
                                sys.stderr = open(os.devnull, 'w')
                                sf.write(pause_file, pause_audio, sample_rate)
                            finally:
                                sys.stderr = original_stderr

                            audio_segments.append(pause_file)

                        # Success - break out of retry loop
                        break
                    else:
                        log("ERROR", f"HTTP {response.status_code} for line {i+1}: {speaker}")
                        if retry < max_retries - 1:
                            time.sleep(1)
                except Exception as e:
                    log("ERROR", f"Exception for line {i+1}: {str(e)}")
                    if retry < max_retries - 1:
                        time.sleep(1)

            if not success:
                failed_line_count += 1
                # Update host-specific failure counters
                if is_host_a:
                    host_a_failed += 1
                else:
                    host_b_failed += 1

                # Try falling back to the other host's voice as a last resort
                try:
                    fallback_voice = host_b_voice if is_host_a else host_a_voice
                    log("INFO", f"Trying fallback voice {fallback_voice} for line {i+1}")

                    response = requests.post(
                        f"{tts_service_url}/v1/audio/speech",
                        json={
                            "model": "kokoro",
                            "input": clean_text,
                            "voice": fallback_voice,
                            "speed": 1.0
                        },
                        headers={"accept": "application/json", "Content-Type": "application/json"},
                        timeout=30
                    )

                    if response.status_code == 200 and len(response.content) > 500:
                        with open(temp_file, "wb") as f:
                            f.write(response.content)

                        if os.path.exists(temp_file) and os.path.getsize(temp_file) > 500:
                            audio_segments.append(temp_file)
                            log("INFO", f"Successfully used fallback voice for line {i+1}")

                            # Add pause
                            pause_file = f"../temp/pause_{i}.wav"
                            pause_samples = int(sample_rate * 0.5)
                            pause_audio = np.zeros(pause_samples)

                            original_stderr = sys.stderr
                            try:
                                sys.stderr = open(os.devnull, 'w')
                                sf.write(pause_file, pause_audio, sample_rate)
                            finally:
                                sys.stderr = original_stderr

                            audio_segments.append(pause_file)
                    else:
                        log("ERROR", f"Fallback voice also failed for line {i+1}")
                except:
                    pass

            # Show progress only every 5 lines to avoid excessive logging
            if (i+1) % 5 == 0 or i+1 == len(lines):
                log("INFO", f"Progress: {i+1}/{len(lines)} lines ({processed_line_count} successful)")

        except Exception as e:
            failed_line_count += 1
            log("ERROR", f"Error processing line {i+1}: {str(e)}")

    # Log host-specific stats
    log("INFO", f"Host A: {host_a_success} successful, {host_a_failed} failed")
    log("INFO", f"Host B: {host_b_success} successful, {host_b_failed} failed")

    # Combine all audio segments with better error reporting
    log("INFO", f"Audio generation complete: {processed_line_count} successful, {failed_line_count} failed")

    if audio_segments:
        combined_audio = []

        # Use completely silent handling of audio file reading
        for idx, file in enumerate(audio_segments):
            try:
                if os.path.exists(file) and os.path.getsize(file) > 0:
                    # Completely suppress all warnings during audio operations
                    original_stderr = sys.stderr
                    try:
                        sys.stderr = open(os.devnull, 'w')
                        audio, sr = sf.read(file)
                    finally:
                        sys.stderr = original_stderr

                    combined_audio.append(audio)
            except Exception as e:
                log("ERROR", f"Error processing audio segment {idx+1}")

        if combined_audio:
            # Concatenate all audio
            final_audio = np.concatenate(combined_audio)
            audio_length_seconds = len(final_audio)/sample_rate
            audio_length_minutes = audio_length_seconds / 60

            log("INFO", f"Final audio length: {audio_length_minutes:.1f} minutes ({audio_length_seconds:.1f} seconds)")

            # Apply audio enhancements
            final_audio = enhance_audio(final_audio)

            # Save to output file - completely suppress all warnings
            original_stderr = sys.stderr
            try:
                sys.stderr = open(os.devnull, 'w')
                sf.write(output_filename, final_audio, sample_rate)
            finally:
                sys.stderr = original_stderr

            log("INFO", f"Saved podcast audio to {output_filename}")
        else:
            log("ERROR", "No valid audio segments to combine")
            sf.write(output_filename, np.zeros(1000), sample_rate)

        # Clean up temp files silently
        for file in audio_segments:
            try:
                if os.path.exists(file):
                    os.remove(file)
            except:
                pass
    else:
        log("ERROR", "No audio segments were generated")
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
    if not text:
        return ""

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

    # Ensure the text isn't empty after cleaning
    if not text.strip():
        return ""

    # Fix any double/triple spaces
    text = re.sub(r'\s+', ' ', text).strip()

    # Limit text length for API stability
    if len(text) > 500:
        text = text[:497] + "..."

    return text

if __name__ == "__main__":
    # Read input from stdin
    input_data = sys.stdin.read()
    try:
        script_data = json.loads(input_data)

        # Save the script to a debug file but with quiet logging
        debug_script_path = f"../temp/last_script_{int(time.time())}.txt"
        with open(debug_script_path, "w") as f:
            f.write(script_data.get("script", ""))

        output_file = generate_podcast_audio(script_data)
        # Only output the JSON, no status messages
        print(json.dumps({"audio_file": output_file}))
    except Exception as e:
        log("ERROR", f"Fatal error in voice_service.py: {str(e)}")
        # Still output a valid JSON even if there's an error
        print(json.dumps({"audio_file": f"../public/podcasts/podcast_{int(time.time())}.wav", "error": str(e)}))
