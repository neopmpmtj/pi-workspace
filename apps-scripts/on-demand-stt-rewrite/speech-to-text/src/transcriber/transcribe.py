import os
import time
import requests
from pathlib import Path

# Import from package
from common.logging_utils import get_logger
from transcriber.configs.transcribe_config import config

# Get script directory for reliable absolute paths
SCRIPT_DIR = Path(__file__).resolve().parent

class Transcriber:
    """
    Handles transcription using OpenAI Whisper API and pastes the result at the cursor.
    """
    def __init__(self):
        # Set up logger for the transcribe module
        self.logger = get_logger("transcriber")
        self.logger.debug("Initializing transcriber")
        
        # Load static configuration values (timeout and max_retries)
        # These are set once at initialization and don't need to be dynamic
        cfg = config
        self.timeout = cfg.timeout
        self.max_retries = cfg.max_retries
        
        # Load API key from environment - FAIL FAST if missing
        self.api_key = os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            error_msg = "OPENAI_API_KEY environment variable is not set. Please set it before running the application."
            self.logger.error(error_msg)
            raise EnvironmentError(error_msg)
        
        # Dynamic config values (model, language, temperature, prompt, response_format)
        # will be read fresh from config on each transcribe() call
        self.logger.debug("Transcriber initialized (dynamic config values will be read on each transcription)")

    def transcribe(self, audio_bytes):
        """
        Send audio (WAV bytes) to OpenAI Whisper and return the transcription.
        Handles both text and json response formats.
        """
        url = "https://api.openai.com/v1/audio/transcriptions"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        
        # Verify audio bytes
        if not audio_bytes:
            self.logger.error("No audio data received for transcription")
            return ""
            
        # Log audio data details
        buffer_size = audio_bytes.getbuffer().nbytes
        self.logger.debug(f"Audio data size: {buffer_size} bytes ({buffer_size/1024:.2f} KB)")
        
        # Reset the buffer position for the request
        audio_bytes.seek(0)
        
        # Save a copy of the audio being sent to API for debugging (only if enabled)
        if os.getenv('SAVE_DEBUG_AUDIO') or os.getenv('DEBUG_MODE'):
            try:
                timestamp = time.strftime("%Y%m%d-%H%M%S")
                output_dir = Path(SCRIPT_DIR).parent / "tests"
                output_dir.mkdir(exist_ok=True)
                debug_file = output_dir / f"openai_request_{timestamp}.wav"
                with open(debug_file, 'wb') as f:
                    audio_bytes.seek(0)
                    f.write(audio_bytes.read())
                    audio_bytes.seek(0)
                self.logger.debug(f"Saved API request audio to {debug_file}")
            except Exception as e:
                self.logger.warning(f"Failed to save debug audio: {e}")
        
        # Read dynamic config values fresh from config on each call
        # This allows runtime configuration changes without restarting the application
        cfg = config
        
        # Try to read from runtime config file if it exists
        runtime_config_path = Path(__file__).resolve().parent.parent.parent / "runtime_config.json"
        print(f"\n[CONFIG] Looking for runtime config at: {runtime_config_path}")
        self.logger.debug(f"Looking for runtime config at: {runtime_config_path}")
        
        if runtime_config_path.exists():
            try:
                import json
                with open(runtime_config_path, 'r', encoding='utf-8') as f:
                    runtime_cfg = json.load(f)
                model = runtime_cfg.get("transcription", {}).get("model", cfg.model)
                language = runtime_cfg.get("transcription", {}).get("language", cfg.language)
                print(f"[CONFIG] Runtime config loaded successfully")
                print(f"[CONFIG] Language: {language}")
                print(f"[CONFIG] Model: {model}")
                self.logger.debug(f"Loaded runtime config from {runtime_config_path}")
                self.logger.debug(f"Runtime config values - language: {language}, model: {model}")
            except Exception as e:
                print(f"[CONFIG] ERROR: Failed to read runtime config: {e}")
                print(f"[CONFIG] Using default values - language: {cfg.language}, model: {cfg.model}")
                self.logger.warning(f"Failed to read runtime config, using defaults: {e}")
                model = cfg.model
                language = cfg.language
        else:
            print(f"[CONFIG] Runtime config file not found")
            print(f"[CONFIG] Using default values - language: {cfg.language}, model: {cfg.model}")
            model = cfg.model
            language = cfg.language
        
        # Other config values from dataclass
        prompt = cfg.prompt
        temperature = cfg.temperature
        response_format = cfg.response_format
        
        self.logger.debug(f"Reading config dynamically - model: {model}, language: {language}")
        
        data = {
            "model": model,
            "language": language,
            "prompt": prompt,
            "temperature": temperature,
            "response_format": response_format,
        }
        
        print(f"[API] Preparing request to OpenAI Whisper API")
        print(f"[API] Language parameter: '{language}'")
        print(f"[API] Model parameter: '{model}'")
        
        self.logger.debug(f"API request details:")
        self.logger.debug(f"URL: {url}")
        self.logger.debug(f"Headers: Authorization: Bearer ****{self.api_key[-4:] if self.api_key else ''}")
        self.logger.debug(f"Files: audio.wav (audio/wav)")
        self.logger.debug(f"Data parameters: {data}")
        
        for attempt in range(1, self.max_retries + 1):
            try:
                self.logger.debug(f"Sending audio to OpenAI (attempt {attempt})...")
                print(f"Sending audio to OpenAI (attempt {attempt}/{self.max_retries})...")
                
                # Create a fresh file object for each attempt to prevent file position issues
                audio_bytes.seek(0)
                files = {
                    "file": ("audio.wav", audio_bytes, "audio/wav"),
                }
                
                response = requests.post(url, headers=headers, files=files, data=data, timeout=self.timeout)
                
                self.logger.debug(f"Response status code: {response.status_code}")
                self.logger.debug(f"Response headers: {dict(response.headers)}")
                
                # Check for HTTP errors
                if response.status_code != 200:
                    self.logger.error(f"API error - Status code: {response.status_code}")
                    self.logger.error(f"API response: {response.text}")
                    print(f"Error from OpenAI API: {response.status_code} - {response.text}")
                    if attempt == self.max_retries:
                        return ""
                    continue
                
                # Log the full raw response for debugging
                self.logger.debug(f"Raw API response: {response.text}")
                
                if response_format == "json":
                    result = response.json()
                    text = result.get("text", "")
                    self.logger.debug(f"Parsed JSON response: {result}")
                    self.logger.info(f"Transcription result: {text}")
                else:
                    text = response.text
                    self.logger.info(f"Transcription result: {text}")
                
                return text.strip()
            except Exception as e:
                self.logger.error(f"Transcription attempt {attempt} failed: {e}")
                import traceback
                self.logger.error(traceback.format_exc())
                if attempt == self.max_retries:
                    print(f"Failed to transcribe after {self.max_retries} attempts: {e}")
                    raise
        return ""
