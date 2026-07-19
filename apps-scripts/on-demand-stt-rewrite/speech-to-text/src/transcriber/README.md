# Audio Transcription Module

This module provides functionality to transcribe audio files using OpenAI's Whisper API. It supports both programmatic API usage and command-line interface.

## Prerequisites

1. Python 3.8 or higher
2. An OpenAI API key set as an environment variable (default: `OPENAI_API_KEY`)
3. Required Python packages (install via `pip install -r requirements.txt`):
   - requests
   - pydub (for audio format conversion)
   - (other project dependencies)
4. FFmpeg (required for audio format conversion)
   - The tool will automatically convert MP3, AAC, and M4A files to WAV format

## Configuration

The module uses a JSON configuration file located at `transcriber/configs/transcribe_config.json`. This file should contain:

```json
{
  "model": "whisper-1",
  "api_key_env_var": "OPENAI_API_KEY",
  "timeout": 30,
  "max_retries": 3,
  "language": "en",
  "prompt": "",
  "temperature": 0,
  "response_format": "text"
}
```

## Command Line Interface (CLI) Usage

The module provides a CLI interface for transcribing audio files directly from the command line.

### Basic Usage

Run the CLI script from the project root directory:

```bash
# From the project root directory
python transcriber/transcribe_CLI.py --input audio_file.wav
```

### CLI Options

- `--input`, `-i`: Path to the input audio file (supported formats: WAV, MP3, AAC, M4A) [required]
- `--output`, `-o`: Path to save the transcription output (default: input_filename.txt)
- `--language`: Language code for transcription (e.g., 'en', 'fr', 'es')
- `--model`: Whisper model to use (default from config)
- `--temperature`: Temperature for transcription (0.0 to 1.0)
- `--prompt`: Optional prompt to guide the transcription
- `--force`: Force processing even if file is not in a supported format (use with caution)
- `--no-convert`: Disable automatic conversion from non-WAV formats to WAV

### Examples

Transcribe a WAV file:
```bash
python transcriber/transcribe_CLI.py --input recordings/speech.wav
```

Transcribe an MP3 file (automatic conversion to WAV):
```bash
python transcriber/transcribe_CLI.py --input recordings/speech.mp3
```

Transcribe an AAC file with a specific language:
```bash
python transcriber/transcribe_CLI.py --input recordings/french_speech.aac --language fr
```

Specify an output file:
```bash
python transcriber/transcribe_CLI.py --input recordings/speech.m4a --output transcripts/result.txt
```

## Supported Audio Formats

The tool supports the following audio formats out of the box:

1. **WAV** - Native format supported by OpenAI's Whisper API
2. **MP3** - Automatically converted to WAV
3. **AAC** - Automatically converted to WAV
4. **M4A** - Automatically converted to WAV

Other formats may work with the `--force` flag, but are not officially supported.

The format conversion happens in-memory using pydub (which requires FFmpeg) and does not create temporary files on disk.

## Programmatic API Usage

To use the transcription functionality in your own Python code:

```python
from transcriber.transcribe import Transcriber
import io
from pydub import AudioSegment  # For non-WAV formats

# Initialize the transcriber
transcriber = Transcriber()

# Option 1: Read a WAV file
with open("path/to/audio.wav", "rb") as f:
    audio_bytes = io.BytesIO(f.read())

# Option 2: Convert MP3 to WAV in memory
mp3_audio = AudioSegment.from_mp3("path/to/audio.mp3")
wav_bytes = io.BytesIO()
mp3_audio.export(wav_bytes, format="wav")
wav_bytes.seek(0)  # Reset buffer position

# Perform the transcription
result = transcriber.transcribe(audio_bytes)  # or wav_bytes
print(f"Transcription: {result}")
```

### Customizing Transcription Parameters

You can modify transcription parameters after initialization:

```python
transcriber = Transcriber()
transcriber.language = "fr"  # Set language to French
transcriber.temperature = 0.3  # Adjust temperature
transcriber.prompt = "This is a technical discussion about Python programming."

result = transcriber.transcribe(audio_bytes)
```

## Error Handling

The module includes robust error handling and logging. If transcription fails, check:

1. The logs directory for detailed error information
2. Your API key and network connection
3. The audio file format (ensure it's supported)
4. FFmpeg installation (required for audio conversion)
5. Audio file size (OpenAI has limits on file size)

## Debugging

For debugging purposes, a copy of each audio file sent to the API is saved in the `tests` directory with a timestamp.

## License

[Your project license information here] 