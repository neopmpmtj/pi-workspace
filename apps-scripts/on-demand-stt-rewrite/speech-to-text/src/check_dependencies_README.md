# Dependency Checker

## Purpose

This script checks for required dependencies before running the speech-to-text application. It verifies:

1. **FFmpeg** - Required for audio format conversion (MP3, AAC, M4A to WAV)
2. **pydub** - Python library for audio processing
3. **OPENAI_API_KEY** - Environment variable for OpenAI Whisper API (validated by making an actual API call)

## Usage

Run the dependency checker from the project root:

```bash
python src/check_dependencies.py
```

Or from Windows:

```powershell
python src\check_dependencies.py
```

## Output

The script provides clear status messages:

```
======================================================================
DEPENDENCY CHECK RESULTS
======================================================================
Enabled checks: ffmpeg, pydub, openai_api_key
======================================================================
[OK] FFmpeg is installed: ffmpeg version 6.0
[OK] pydub is installed
[OK] OPENAI_API_KEY is valid (sk-1...abc2)
======================================================================
[OK] All checked dependencies are satisfied!
You can run the application normally.
======================================================================
```

Or if there are issues:

```
======================================================================
DEPENDENCY CHECK RESULTS
======================================================================
Enabled checks: ffmpeg, pydub, openai_api_key
======================================================================
[FAIL] FFmpeg is NOT installed
[FAIL] pydub is NOT installed - required for audio conversion
[FAIL] OPENAI_API_KEY environment variable is NOT set in environment variables
======================================================================
[FAIL] Some dependencies are missing or incorrect.

Required for audio format conversion:
  - FFmpeg: https://ffmpeg.org/download.html
  - pydub: pip install pydub

Required for transcription:
  - OPENAI_API_KEY: Set this environment variable
    Windows: set OPENAI_API_KEY=your_key_here
    Linux/Mac: export OPENAI_API_KEY=your_key_here
======================================================================
```

### API Key Validation Errors

The checker validates API keys by making an actual API call. You may see these specific errors:

**Not Set:**
```
[FAIL] OPENAI_API_KEY environment variable is NOT set in environment variables
```

**Invalid/Expired:**
```
[FAIL] OPENAI_API_KEY is invalid, expired, or not properly created - verify your API key at https://platform.openai.com/api-keys
```

**Network Issues (Key is set but can't validate):**
```
[FAIL] OPENAI_API_KEY is set but validation failed: Network timeout (check internet connection)
```

## Why This Matters

### FFmpeg

The application needs FFmpeg for converting audio files from MP3, AAC, or M4A formats to WAV format before sending to OpenAI's Whisper API. If FFmpeg is not installed, users will get cryptic errors when trying to transcribe non-WAV audio files.

### OpenAI API Key Validation

The dependency checker validates your OpenAI API key by making an actual API call to OpenAI's `/models` endpoint. This ensures:

- **The key exists** - Environment variable is set
- **The key is valid** - API accepts the key
- **The key is active** - Not expired or revoked

This prevents runtime errors when trying to transcribe audio. The checker clearly distinguishes between:
- Key not set in environment variables
- Key set but invalid, expired, or not properly created
- Key valid but network issues prevent validation

### Configuration

You can control which checks run by editing `common/config/config_app.py`:

```python
@dataclass
class DependencyCheckFlags:
    check_ffmpeg: bool = True
    check_pydub: bool = True
    check_openai_api_key: bool = True
```

### Early Detection

By checking dependencies upfront, users get immediate feedback about what needs to be installed or configured before running the application, preventing runtime errors.

## When to Run

- Before first use of the application
- When troubleshooting audio conversion errors
- After system updates or reinstalls
- As part of automated testing/deployment

## Notes

- Only the CLI transcription tool (transcribe_cli.py) requires FFmpeg for file format conversion
- The check verifies both FFmpeg availability and proper functionality
- API key validation requires an internet connection - if validation fails due to network issues, check your connection and try again
- The API key validation uses a lightweight GET request with a 5-second timeout to minimize impact
