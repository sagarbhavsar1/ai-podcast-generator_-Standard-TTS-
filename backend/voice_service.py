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
import threading
import concurrent.futures
import socket
from collections import defaultdict
from typing import List, Dict, Tuple, Any, Optional

# Update the default TTS service URL to use port 8880 instead of 8343
DEFAULT_TTS_SERVICE_URL = "http://localhost:8880"

# Simple logging with levels - changed to INFO for better visibility
LOG_LEVEL = "INFO"  # Can be "DEBUG", "INFO", "ERROR", "NONE"

# Track failed lines by host
host_a_failed = 0
host_b_failed = 0
host_a_success = 0
host_b_success = 0

# Adaptive retry settings
MAX_RETRIES = 4
BASE_RETRY_DELAY = 1.0
MAX_RETRY_DELAY = 16.0

# Optimization settings - IMPORTANT CHANGES!
ENABLE_PARALLEL_PROCESSING = False  # Disabled to reduce load
ENABLE_BATCHING = False             # Disabled to reduce load
MAX_BATCH_SIZE = 1                  # Reduced to single lines only
MAX_WORKERS = 1                     # Single thread only
REQUEST_THROTTLE_TIME = 2.0         # Add 2 second delay between requests

# TTS Service Configuration
VERIFY_TTS_SERVICE = True
TTS_CHECK_TIMEOUT = 3
TTS_CONNECTION_RETRIES = 2
SKIP_AUDIO_IF_TTS_DOWN = True
USE_FILE_BASED_TTS_FALLBACK = True

# Add last_request_time global variable to throttle requests
last_request_time = 0

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

def check_tts_service_availability(url):
    """Check if the TTS service is running and available"""
    log("INFO", f"Checking TTS service availability at {url}...")

    # Parse URL to extract hostname and port
    try:
        # Handle URLs with http:// prefix
        if url.startswith('http://'):
            hostname = url.split('://')[1].split(':')[0]
            port_str = url.split(':')[-1].split('/')[0]
            port = int(port_str)
        # Handle direct hostname:port format
        else:
            parts = url.split(':')
            hostname = parts[0]
            port = int(parts[1].split('/')[0])

        log("INFO", f"Parsed TTS service address: {hostname}:{port}")

        # First check with a plain socket connection
        for attempt in range(TTS_CONNECTION_RETRIES):
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(TTS_CHECK_TIMEOUT)
                result = sock.connect_ex((hostname, port))
                sock.close()

                if result == 0:
                    log("INFO", f"Socket connection to port {port} successful.")
                    break
                else:
                    log("ERROR", f"Could not connect to port {port} (attempt {attempt+1}/{TTS_CONNECTION_RETRIES})")
                    if attempt < TTS_CONNECTION_RETRIES - 1:
                        time.sleep(2)  # Wait before retrying
            except socket.error as e:
                log("ERROR", f"Socket error when checking TTS service: {str(e)}")
                if attempt < TTS_CONNECTION_RETRIES - 1:
                    time.sleep(2)  # Wait before retrying

            if attempt == TTS_CONNECTION_RETRIES - 1:
                log("ERROR", f"TTS service not available at {hostname}:{port} after {TTS_CONNECTION_RETRIES} attempts")
                return False

        # If the socket connection worked, try the health endpoint first (most reliable)
        try:
            response = requests.get(
                f"{url}/health",
                timeout=TTS_CHECK_TIMEOUT,
                headers={"accept": "application/json"}
            )

            if response.status_code == 200:
                log("INFO", "TTS service health check successful")
                return True
        except requests.exceptions.RequestException as e:
            log("INFO", f"Health check endpoint not available: {str(e)}")
            # Continue with other checks if health check fails

        # Try the voices endpoint next (according to docs this is /v1/audio/voices)
        try:
            response = requests.get(
                f"{url}/v1/audio/voices",
                timeout=TTS_CHECK_TIMEOUT,
                headers={"accept": "application/json"}
            )

            if response.status_code == 200:
                log("INFO", "TTS service voices endpoint responded successfully")
                return True
            else:
                log("INFO", f"Voices endpoint returned status code {response.status_code}, trying models endpoint")
        except requests.exceptions.RequestException as e:
            log("INFO", f"Could not access voices endpoint: {str(e)}")

        # Also try the models endpoint for completeness
        try:
            response = requests.get(
                f"{url}/v1/models",
                timeout=TTS_CHECK_TIMEOUT,
                headers={"accept": "application/json"}
            )

            if response.status_code == 200:
                log("INFO", "TTS service models endpoint responded successfully")
                return True
            else:
                log("WARNING", f"Models endpoint returned status code {response.status_code}")
        except requests.exceptions.RequestException as e:
            log("WARNING", f"Could not access models endpoint: {str(e)}")

        # If all specific endpoints failed but socket connection worked, consider service available
        log("INFO", "Socket connection succeeded but API endpoints not accessible - service may be starting up")
        return True

    except Exception as e:
        log("ERROR", f"Error checking TTS service: {str(e)}")
        return False

def generate_podcast_audio(script_data):
    """
    Generate podcast audio using Kokoro TTS API with enhanced naturalness.
    Creates a WAV file with natural speech for the podcast conversation.
    """
    start_time = time.time()
    output_filename = f"../public/podcasts/podcast_{int(start_time)}.wav"

    global host_a_failed, host_b_failed, host_a_success, host_b_success
    host_a_failed = host_b_failed = host_a_success = host_b_success = 0

    # Get the script and voice preferences
    script = script_data.get("script", "")

    # Always use bella for Host A and echo for Host B
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

    # Check if TTS service is available before proceeding
    tts_available = True
    if VERIFY_TTS_SERVICE:
        tts_available = check_tts_service_availability(tts_service_url)
        if not tts_available:
            log("ERROR", "TTS service is not available!")
            if SKIP_AUDIO_IF_TTS_DOWN:
                log("INFO", "Creating empty audio file since TTS service is down")
                # Create a short silent audio file with a message and return early
                generate_silent_audio_with_message(output_filename)
                return output_filename

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

    # If TTS service is down, use file-based fallback mode
    if not tts_available and USE_FILE_BASED_TTS_FALLBACK:
        audio_segments = process_with_file_based_fallback(lines)
    # Otherwise use the optimized processing modes
    elif ENABLE_BATCHING:
        audio_segments = process_with_batching(lines, host_a_voice, host_b_voice, tts_service_url)
    elif ENABLE_PARALLEL_PROCESSING:
        audio_segments = process_with_parallelism(lines, host_a_voice, host_b_voice, tts_service_url)
    else:
        # Fall back to original sequential processing if optimizations are disabled
        audio_segments = process_lines_sequentially(lines, host_a_voice, host_b_voice, tts_service_url)

    # Log host-specific stats
    log("INFO", f"Host A: {host_a_success} successful, {host_a_failed} failed")
    log("INFO", f"Host B: {host_b_success} successful, {host_b_failed} failed")

    # Combine all audio segments
    log("INFO", f"Audio generation complete: Processing completed segments")
    sample_rate = 24000  # Kokoro's output sample rate

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
                log("ERROR", f"Error processing audio segment {idx+1}: {str(e)}")

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
            generate_silent_audio_with_message(output_filename)
    else:
        log("ERROR", "No audio segments were generated")
        generate_silent_audio_with_message(output_filename)

    # Clean up temp files silently
    for file in audio_segments:
        try:
            if os.path.exists(file):
                os.remove(file)
        except:
            pass

    # Report total processing time
    total_time = time.time() - start_time
    log("INFO", f"Total processing time: {total_time:.2f} seconds")

    return output_filename

def generate_silent_audio_with_message(output_filename):
    """Generate a silent audio file with a brief error message"""
    sample_rate = 24000
    duration = 3  # 3 seconds of silence
    silent_audio = np.zeros(sample_rate * duration)

    # Create directories if needed
    os.makedirs(os.path.dirname(output_filename), exist_ok=True)

    # Save the silent audio
    sf.write(output_filename, silent_audio, sample_rate)
    log("INFO", f"Generated silent audio file: {output_filename}")

def process_with_file_based_fallback(lines):
    """Process lines using a file-based approach for local TTS as a complete fallback"""
    log("INFO", "Using FILE-BASED FALLBACK mode since TTS service is unavailable")

    global host_a_success, host_b_success, host_a_failed, host_b_failed
    audio_segments = []
    sample_rate = 24000

    # Create a simple sine wave tone as a pause marker
    def create_tone(freq=440, duration=0.5):
        t = np.linspace(0, duration, int(sample_rate * duration))
        tone = np.sin(2 * np.pi * freq * t) * 0.1  # Reduced amplitude
        # Apply fade in/out
        fade = 0.1  # seconds
        fade_len = int(fade * sample_rate)
        if fade_len * 2 < len(tone):
            fade_in = np.linspace(0, 1, fade_len)
            fade_out = np.linspace(1, 0, fade_len)
            tone[:fade_len] *= fade_in
            tone[-fade_len:] *= fade_out
        return tone

    # Create silence
    def create_silence(duration=0.5):
        return np.zeros(int(sample_rate * duration))

    # Create a marker for Host A (higher pitched tone)
    host_a_marker = create_tone(freq=880, duration=0.2)
    pause_a = create_silence(0.3)

    # Create a marker for Host B (lower pitched tone)
    host_b_marker = create_tone(freq=440, duration=0.2)
    pause_b = create_silence(0.3)

    # Process each line
    for i, line in enumerate(lines):
        if not line.strip():
            continue

        # Determine if this is Host A or B
        if ":" in line:
            parts = line.split(":", 1)
            speaker = parts[0].strip()
        else:
            speaker = "Host A" if i % 2 == 0 else "Host B"

        is_host_a = bool(re.search(r'^Host\s*A\b|^HOST\s*A\b|^HostA\b|^HOSTA\b', speaker, re.IGNORECASE))

        # Create an audio marker file for this line
        marker_file = f"../temp/marker_{i}.wav"
        if is_host_a:
            marker_audio = np.concatenate([host_a_marker, pause_a])
            host_a_success += 1
        else:
            marker_audio = np.concatenate([host_b_marker, pause_b])
            host_b_success += 1

        # Save the marker
        sf.write(marker_file, marker_audio, sample_rate)
        audio_segments.append(marker_file)

        # Add a pause after each line
        pause_file = f"../temp/pause_{i}.wav"
        pause_audio = create_silence(0.5)
        sf.write(pause_file, pause_audio, sample_rate)
        audio_segments.append(pause_file)

    # Add intro and outro message that TTS was unavailable
    message = "Text to speech service was unavailable. Please try again later."
    log("INFO", f"Created {len(audio_segments)} audio markers as TTS fallback")

    return audio_segments

def process_batch(batch_idx, speaker_type, batch, voice, tts_service_url):
    """Process a batch of lines from the same speaker"""
    global host_a_success, host_b_success, host_a_failed, host_b_failed
    audio_segments = []

    # Process each line in the batch
    for i, speaker, text in batch:
        temp_file = f"../temp/line_{i}.wav"
        if process_single_line(i, speaker, text, voice, tts_service_url, temp_file):
            audio_segments.append(temp_file)

            # Add pause after the line
            pause_file = add_pause_after_line(text, i)
            if pause_file:
                audio_segments.append(pause_file)

            # Update success counters
            if speaker_type == "A":
                host_a_success += 1
            else:
                host_b_success += 1
        else:
            # Update failure counters
            if speaker_type == "A":
                host_a_failed += 1
            else:
                host_b_failed += 1

    return audio_segments

def process_with_batching(lines, host_a_voice, host_b_voice, tts_service_url):
    """Process lines with batching for same-speaker consecutive lines"""
    log("INFO", "Using BATCHED processing mode")

    batches = []
    current_batch = []
    current_speaker = None

    # Group consecutive lines from the same speaker into batches
    for i, line in enumerate(lines):
        if not line.strip():
            continue

        # Determine speaker
        if ":" in line:
            parts = line.split(":", 1)
            speaker = parts[0].strip()
            text = parts[1].strip()
        else:
            speaker = "Host A" if i % 2 == 0 else "Host B"
            text = line.strip()

        is_host_a = bool(re.search(r'^Host\s*A\b|^HOST\s*A\b|^HostA\b|^HOSTA\b', speaker, re.IGNORECASE))

        # If this is a new speaker or batch is too large, start a new batch
        if current_speaker is not None and ((is_host_a and current_speaker != "A") or
                                           (not is_host_a and current_speaker != "B") or
                                           len(current_batch) >= MAX_BATCH_SIZE):
            batches.append((current_speaker, current_batch[:]))
            current_batch = []

        # Set current speaker
        current_speaker = "A" if is_host_a else "B"

        # Add to current batch
        current_batch.append((i, speaker, text))

    # Add the last batch if not empty
    if current_batch:
        batches.append((current_speaker, current_batch[:]))

    log("INFO", f"Created {len(batches)} batches from {len(lines)} lines")

    # Process batches with parallelism
    audio_segments = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        batch_futures = []

        # Submit all batches for processing
        for batch_idx, (speaker_type, batch) in enumerate(batches):
            future = executor.submit(
                process_batch,
                batch_idx,
                speaker_type,
                batch,
                host_a_voice if speaker_type == "A" else host_b_voice,
                tts_service_url
            )
            batch_futures.append(future)

        # Collect results as they complete
        for future in concurrent.futures.as_completed(batch_futures):
            try:
                batch_segments = future.result()
                audio_segments.extend(batch_segments)
            except Exception as e:
                log("ERROR", f"Batch processing error: {str(e)}")

    # Sort segments by line number to maintain correct order
    audio_segments.sort(key=lambda x: int(os.path.basename(x).split('_')[1].split('.')[0]))
    return audio_segments

def process_with_parallelism(lines, host_a_voice, host_b_voice, tts_service_url):
    """Process lines with parallel execution for Host A and Host B lines"""
    log("INFO", "Using PARALLEL processing mode")

    # Separate Host A and Host B lines
    host_a_lines = []
    host_b_lines = []

    for i, line in enumerate(lines):
        if not line.strip():
            continue

        if ":" in line:
            parts = line.split(":", 1)
            speaker = parts[0].strip()
        else:
            speaker = "Host A" if i % 2 == 0 else "Host B"

        is_host_a = bool(re.search(r'^Host\s*A\b|^HOST\s*A\b|^HostA\b|^HOSTA\b', speaker, re.IGNORECASE))

        if is_host_a:
            host_a_lines.append((i, line))
        else:
            host_b_lines.append((i, line))

    log("INFO", f"Split lines: Host A: {len(host_a_lines)}, Host B: {len(host_b_lines)}")

    # Process both hosts' lines in parallel
    host_a_segments = []
    host_b_segments = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        # Submit processing for both hosts
        host_a_future = executor.submit(
            process_host_lines, "A", host_a_lines, host_a_voice, tts_service_url)
        host_b_future = executor.submit(
            process_host_lines, "B", host_b_lines, host_b_voice, tts_service_url)

        # Get results
        host_a_segments = host_a_future.result()
        host_b_segments = host_b_future.result()

    # Combine both hosts' segments and sort by line number
    all_segments = host_a_segments + host_b_segments
    all_segments.sort(key=lambda x: int(os.path.basename(x).split('_')[1].split('.')[0]))

    return all_segments

def process_host_lines(host_type, lines, voice, tts_service_url):
    """Process all lines for one host"""
    global host_a_success, host_b_success, host_a_failed, host_b_failed

    audio_segments = []

    for i, line in lines:
        if ":" in line:
            parts = line.split(":", 1)
            speaker, text = parts[0].strip(), parts[1].strip()
        else:
            speaker = f"Host {host_type}"
            text = line.strip()

        # Skip if text is too short
        clean_text = preprocess_text_for_tts(text)
        if not clean_text or len(clean_text) < 2:
            continue

        temp_file = f"../temp/line_{i}.wav"
        if process_single_line(i, speaker, clean_text, voice, tts_service_url, temp_file):
            audio_segments.append(temp_file)

            # Add a pause after the line
            pause_file = add_pause_after_line(text, i)
            if pause_file:
                audio_segments.append(pause_file)

            # Update counters
            if host_type == "A":
                host_a_success += 1
            else:
                host_b_success += 1
        else:
            if host_type == "A":
                host_a_failed += 1
            else:
                host_b_failed += 1

    return audio_segments

def process_lines_sequentially(lines, host_a_voice, host_b_voice, tts_service_url):
    """Original sequential processing logic - fallback if optimizations are disabled"""
    global host_a_success, host_b_success, host_a_failed, host_b_failed

    audio_segments = []
    sample_rate = 24000
    processed_line_count = 0
    failed_line_count = 0

    # Voice settings for consistency
    host_a_settings = {"voice": host_a_voice, "speed": 1.0}
    host_b_settings = {"voice": host_b_voice, "speed": 1.0}

    # Process each line
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
            voice_settings = host_a_settings.copy() if is_host_a else host_b_settings.copy()
            voice_settings["speed"] = random.uniform(0.97, 1.03)
            voice = voice_settings["voice"]

            # Clean up text
            clean_text = preprocess_text_for_tts(text)

            # Skip empty lines after cleaning
            if not clean_text or len(clean_text) < 2:
                log("INFO", f"Line {i+1}: Skipped - no valid text after preprocessing")
                continue

            log("INFO", f"Line {i+1}: Processing \"{clean_text[:30]}...\" with voice {voice}")

            # Process the line
            temp_file = f"../temp/line_{i}.wav"
            if process_single_line(i, speaker, clean_text, voice, tts_service_url, temp_file):
                audio_segments.append(temp_file)
                processed_line_count += 1

                # Update host-specific counters
                if is_host_a:
                    host_a_success += 1
                else:
                    host_b_success += 1

                # Add strategic pauses based on content
                pause_file = add_pause_after_line(text, i)
                if pause_file:
                    audio_segments.append(pause_file)
            else:
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
                    if process_single_line(i, speaker, clean_text, fallback_voice, tts_service_url, temp_file):
                        audio_segments.append(temp_file)
                        log("INFO", f"Successfully used fallback voice for line {i+1}")

                        # Add pause
                        pause_file = f"../temp/pause_{i}.wav"
                        add_pause(pause_file, 0.5)
                        audio_segments.append(pause_file)
                except Exception as e:
                    log("ERROR", f"Fallback failed for line {i+1}: {str(e)}")

            # Show progress only every 5 lines to avoid excessive logging
            if (i+1) % 5 == 0 or i+1 == len(lines):
                log("INFO", f"Progress: {i+1}/{len(lines)} lines ({processed_line_count} successful)")

        except Exception as e:
            failed_line_count += 1
            log("ERROR", f"Error processing line {i+1}: {str(e)}")

    return audio_segments

def process_single_line(i, speaker, text, voice, tts_service_url, output_file):
    """Process a single line with adaptive retry"""
    global last_request_time

    # Add throttling between requests to avoid overloading the TTS service
    current_time = time.time()
    time_since_last = current_time - last_request_time
    if time_since_last < REQUEST_THROTTLE_TIME:
        sleep_time = REQUEST_THROTTLE_TIME - time_since_last
        log("INFO", f"Throttling request for {sleep_time:.2f} seconds")
        time.sleep(sleep_time)

    last_request_time = time.time()

    # Try up to MAX_RETRIES times to generate this line
    success = False
    retry_count = 0
    retry_delay = BASE_RETRY_DELAY

    # Reduce text length if it's too long
    if len(text) > 200:
        text = text[:197] + "..."
        log("INFO", f"Text for line {i+1} truncated to 200 chars")

    while retry_count < MAX_RETRIES and not success:
        try:
            # Call the Kokoro API with updated parameters according to the API docs
            response = requests.post(
                f"{tts_service_url}/v1/audio/speech",
                json={
                    "model": "kokoro",
                    "input": text,
                    "voice": voice,
                    "speed": random.uniform(0.97, 1.03),  # Slight speed variation for naturalness
                    "response_format": "mp3",  # Explicitly set format
                    "stream": False  # Make sure streaming is disabled for our use case
                },
                headers={"accept": "application/json", "Content-Type": "application/json"},
                timeout=30  # Increased timeout for longer text
            )

            if response.status_code == 200:
                # Check if response contains audio data (must be significant size)
                if len(response.content) > 500:  # Increased threshold for valid audio
                    # Save the binary audio data directly to file
                    with open(output_file, "wb") as f:
                        f.write(response.content)

                    # Verify file was created and has content
                    if os.path.exists(output_file) and os.path.getsize(output_file) > 500:
                        success = True
                        return True
                    else:
                        log("ERROR", f"Audio file empty for line {i+1}: {speaker}")
                else:
                    log("ERROR", f"TTS response too small ({len(response.content)} bytes) for: {speaker}: {text[:30]}...")
            else:
                log("ERROR", f"HTTP {response.status_code} for line {i+1}: {speaker}")

                # For rate limiting (429), use server-suggested retry time if available
                if response.status_code == 429 and 'retry-after' in response.headers:
                    retry_seconds = int(response.headers['retry-after'])
                    log("INFO", f"Rate limited. Server suggests waiting {retry_seconds} seconds")
                    time.sleep(retry_seconds + random.uniform(0, 1))  # Add jitter
                    retry_count += 1
                    continue

            # Adaptive backoff for failures
            if retry_count < MAX_RETRIES - 1:
                # Add jitter to prevent thundering herd
                jitter = random.uniform(0.75, 1.25)
                sleep_time = retry_delay * jitter
                log("INFO", f"Attempt {retry_count+1} failed. Retrying in {sleep_time:.2f}s...")
                time.sleep(sleep_time)
                retry_delay = min(retry_delay * 2, MAX_RETRY_DELAY)  # Exponential backoff
        except Exception as e:
            log("ERROR", f"Exception for line {i+1}: {str(e)}")

            # Adaptive backoff for exceptions too
            if retry_count < MAX_RETRIES - 1:
                jitter = random.uniform(0.75, 1.25)
                sleep_time = retry_delay * jitter
                log("INFO", f"Attempt {retry_count+1} failed with exception. Retrying in {sleep_time:.2f}s...")
                time.sleep(sleep_time)
                retry_delay = min(retry_delay * 2, MAX_RETRY_DELAY)

        retry_count += 1

    # If we reach here, all retries failed
    if i >= 0:  # Don't log for batched segments
        log("ERROR", f"All {MAX_RETRIES} attempts failed for line {i+1}")

    try_local_tts_fallback(i, text, output_file)
    return False

# Fix the local TTS fallback to avoid 'run loop already started' error
def try_local_tts_fallback(i, text, output_file):
    """Try to use local TTS as a fallback for failed lines"""
    try:
        # Only attempt for short text segments
        if len(text) <= 50:  # Reduced from 100 to 50
            # Import only if needed to avoid dependency issues
            import pyttsx3

            # Use a simplified approach to avoid threading issues
            log("INFO", f"Trying local TTS fallback for line {i+1}")

            # Create a new engine instance each time
            engine = pyttsx3.init()
            engine.setProperty('rate', 150)

            # Save as temporary WAV file
            temp_wav = f"{output_file}.temp.wav"
            engine.save_to_file(text, temp_wav)

            try:
                engine.runAndWait()
            except RuntimeError:
                # Handle 'run loop already started' error
                log("INFO", "Using alternative TTS method due to run loop error")
                # Create a simple silent file instead
                sample_rate = 24000
                duration = 1  # 1 second of silence
                silent_audio = np.zeros(sample_rate * duration)
                sf.write(output_file, silent_audio, sample_rate)
                return True

            # Convert to the correct sample rate
            if os.path.exists(temp_wav) and os.path.getsize(temp_wav) > 0:
                import librosa
                from scipy.io import wavfile

                y, sr = librosa.load(temp_wav, sr=24000)
                wavfile.write(output_file, 24000, y)
                os.remove(temp_wav)
                log("INFO", f"Successfully created fallback audio for line {i+1}")
                return True
    except Exception as e:
        log("ERROR", f"Local TTS fallback failed: {str(e)}")

    return False

def add_pause_after_line(text, i):
    """Add a pause after a line based on punctuation"""
    sample_rate = 24000
    if "[pause]" in text or re.search(r'[.!?]', text):
        pause_file = f"../temp/pause_{i}.wav"

        # Determine pause length based on punctuation
        if "." in text:
            pause_length = 0.6
        elif "!" in text or "?" in text:
            pause_length = 0.7
        else:
            pause_length = 0.4  # Default pause

        add_pause(pause_file, pause_length)
        return pause_file
    return None

def add_pause(filename, pause_length):
    """Create a pause audio file"""
    sample_rate = 24000
    pause_samples = int(sample_rate * pause_length)
    pause_audio = np.zeros(pause_samples)

    # Suppressing Xing warnings during write
    original_stderr = sys.stderr
    try:
        sys.stderr = open(os.devnull, 'w')
        sf.write(filename, pause_audio, sample_rate)
        return True
    finally:
        sys.stderr = original_stderr
    return False

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
