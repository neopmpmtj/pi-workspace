# Speech-to-Text with Hotkey Recording

A Python-based speech-to-text application that records audio via hotkey press, transcribes it using OpenAI's Whisper API, and automatically pastes the result at your cursor position.

## Features

- **Hotkey Recording**: Press and hold a configurable hotkey combination to record audio
- **Automatic Transcription**: Uses OpenAI Whisper API for accurate transcription
- **Auto-Paste**: Automatically pastes transcribed text at cursor position
- **Web Dashboard**: Beautiful web interface on port 3000 for changing settings on the fly
- **Real-Time Configuration**: Change language, model, and timestamp settings without restart
- **Memory-Only Recording**: Audio is processed in memory without saving to disk
- **Configurable**: Python-based configurations with dataclasses
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **Optional Validation**: Dependency checks can be enabled via `--apply-checks` flag

## Requirements

### System Dependencies

1. **FFmpeg** (for audio format conversion)
   - Windows: Download from [ffmpeg.org](https://ffmpeg.org/download.html)
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg` or equivalent

2. **Linux auto-paste under Wayland** (for the auto-paste feature on a GNOME/Wayland
   session — `pyautogui` is X11-only and cannot inject keys into native Wayland windows)
   - `sudo apt install -y ydotool ydotoold wl-clipboard`
   - Run `ydotoold` as a root service and chown its socket to your user (see
     `~/.pi/docs/speech-to-text-keyboard-shortcut-fix/speech-to-text-wayland-autopaste-fix.md`)
   - On X11, auto-paste uses `pyautogui` and needs `xclip` + `python3-tk` instead.

### Python Dependencies

See `requirements.txt`:
- keyboard==0.13.5
- sounddevice==0.4.6
- soundfile==0.12.1
- pydub==0.25.1
- numpy==1.26.4
- pyperclip==1.9.0
- pyautogui==0.9.54
- requests==2.32.3

### Environment Variables

- `OPENAI_API_KEY`: Your OpenAI API key (required)

```powershell
# Windows PowerShell
$env:OPENAI_API_KEY="your-api-key-here"

# Windows CMD
set OPENAI_API_KEY=your-api-key-here

# Linux/macOS
export OPENAI_API_KEY=your-api-key-here
```

## Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd L-speech-to-text
```

2. **Install Python dependencies**
```bash
pip install -r requirements.txt
```

3. **Install FFmpeg** (see System Dependencies above)

4. **Set environment variable**
```powershell
# Windows PowerShell
$env:OPENAI_API_KEY="your-api-key-here"
```

## Usage

### Quick Start

Run the application (dependency checks are skipped by default):

```bash
python main.py
```

The application will:
1. Start the Django web dashboard on http://localhost:8030
2. Initialize the hotkey detector
3. Begin listening for your hotkey combination (default: Ctrl+Alt)

### Web Dashboard

Access the settings dashboard at **http://localhost:8030** in your browser.

The dashboard allows you to change settings on the fly:
- **Language**: Select transcription language (en, pt, es, fr, de, it)
- **Model**: Choose OpenAI model (whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe)
- **Timestamp**: Toggle timestamp prefix on transcribed text

Changes take effect immediately on the next transcription!

See `web_dashboard/README.md` for detailed dashboard documentation.

### Run with Dependency Checks

Run the application with dependency validation:

```bash
python main.py --apply-checks
```

### Run Dependency Checker Only

Run the dependency checker standalone:

```bash
python src/check_dependencies.py
```

### Direct Entry Point

Run the hotkey detector module directly:

```bash
# From project root, with src/ in PYTHONPATH
```

## Configuration

All configurations use Python dataclasses for better IDE support and type safety.

### Application Configuration

Control which dependency checks run by editing `common/config/config_app.py`:

```python
@dataclass
class DependencyCheckFlags:
    check_ffmpeg: bool = True           # Enable FFmpeg check
    check_pydub: bool = True            # Enable pydub check
    check_openai_api_key: bool = True   # Enable OpenAI API key check
```

See `common/config/README.md` for detailed documentation.

### Hotkey Configuration


```python
@dataclass
class HotkeyCombination:
    name: str = "record_speech"
    keys: List[str] = field(default_factory=lambda: ["ctrl", "alt"])
    description: str = "Press and hold to record speech"
    enabled: bool = True
```

### Recorder Configuration

Edit `src/recorder/configs/recorder_config.py`:

```python
@dataclass
class AudioConfig:
    sample_rate: int = 16000
    channels: int = 1
    bit_depth: int = 16
    buffer_size: int = 1024
```

### Transcription Configuration

Edit `src/transcriber/configs/transcribe_config.py`:

```python
@dataclass
class TranscribeConfig:
    model: str = "whisper-1"
    timeout: int = 30
    max_retries: int = 3
    language: str = "en"
    temperature: float = 0.0
```

## Project Structure

```
L-speech-to-text/
├── main.py                      # Main entry point with dependency checks
├── requirements.txt             # Python dependencies
├── README.md                    # This file
├── .gitignore                  # Git ignore rules
│
├── common/                      # Shared utilities
│   ├── config/                  # Application configuration
│   │   ├── __init__.py
│   │   ├── config_app.py       # App config with dependency flags
│   │   └── README.md           # Configuration documentation
│   ├── logging_utils/          # Centralized logging
│   │   ├── __init__.py
│   │   └── logging_config.py   # Logger configuration
│   └── utils/                  # Common utilities
│       ├── __init__.py
│       ├── file_sys_utils.py   # Path handling for .exe support
│       └── paste_from_clipboard.py
│
└── src/                        # Application source code
    ├── check_dependencies.py   # Dependency checker
    ├── check_dependencies_README.md
    │
    │   ├── __init__.py
    │   └── configs/
    │       ├── __init__.py
    │       └── hotkey_config.py
    │
    ├── recorder/               # Audio recording
    │   ├── __init__.py
    │   ├── record.py           # Audio recording class
    │   ├── record_cli.py       # CLI for standalone recording
    │   ├── README.md
    │   └── configs/
    │       ├── __init__.py
    │       └── recorder_config.py
    │
    └── transcriber/            # Audio transcription
        ├── __init__.py
        ├── transcribe.py       # Transcription class
        ├── transcribe_cli.py   # CLI for standalone transcription
        ├── README.md
        └── configs/
            ├── __init__.py
            └── transcribe_config.py
```

## How It Works

1. **Hotkey Detection**: Application listens for configured hotkey combination (default: Ctrl+Alt)
2. **Recording**: While keys are held, records audio from microphone into memory
3. **Processing**: When keys are released, audio is sent to OpenAI Whisper API
4. **Transcription**: Receives transcribed text from API
5. **Auto-Paste**: Copies to clipboard and simulates paste at cursor position

## Logging

Logs are stored in platform-specific locations:

**Windows:**
- `%LOCALAPPDATA%\L-speech-to-text\logs\`
- Example: `C:\Users\<username>\AppData\Local\L-speech-to-text\logs\`

**Linux/Mac:**
- `logs/` directory in project root

Log files:
- `recorder.log` - Audio recording logs
- `transcriber.log` - Transcription logs
- `dependency_checker.log` - Dependency check logs
- `main.log` - Main entry point logs

## CLI Tools

### Standalone Recording

```bash
python src/recorder/record_cli.py start
```

### Standalone Transcription

```bash
python src/transcriber/transcribe_cli.py --input audio.wav --output transcript.txt
```

## Building for Distribution

The project is designed to be compiled into a standalone .exe using PyInstaller:

```bash
pyinstaller --onefile --windowed --name speech-to-text main.py
```

## Troubleshooting

### "OPENAI_API_KEY environment variable is not set"
Set the environment variable before running the application.

### "FFmpeg is NOT installed"
Install FFmpeg and ensure it's in your system PATH.

### "Recording too short"
The minimum recording duration is 2 seconds. Hold the hotkey longer.

### Import errors
Make sure you're running from the project root directory with src/ in PYTHONPATH.

## License

[Your License Here]

## Author

[Your Name]

