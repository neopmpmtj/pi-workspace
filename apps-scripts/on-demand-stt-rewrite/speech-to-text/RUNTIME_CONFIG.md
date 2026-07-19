# Runtime Configuration

## Overview

The application now supports dynamic configuration changes **without restarting**!

Changes to configuration (via `runtime_config.json`, environment variables, or code) take effect immediately on the next transcription or paste operation.

## Quick Start

### Method 1: Use the Helper Script (Recommended)

Run this script to change settings with a simple menu:

```bash
python change_settings.py
```

The menu lets you:
- Change transcription language (en, pt, es, fr, etc.)
- Change transcription model
- Toggle timestamp prefix on/off
- Set paste hotkey (auto / ctrl_v / ctrl_shift_v / command_v)

**Changes take effect immediately!**

### Method 2: Edit the JSON File Directly

Edit `runtime_config.json` directly in the project root:

```json
{
  "transcription": {
    "language": "en",
    "model": "whisper-1"
  },
  "paste": {
    "add_timestamp": true,
    "hotkey": "auto"
  }
}
```

Save the file, and changes apply on the next operation!

## Configuration Options

### Transcription Settings

**`language`** - Language code for transcription
- `en` - English
- `pt` - Portuguese
- `es` - Spanish
- `fr` - French
- `de` - German
- `it` - Italian
- `ja` - Japanese
- `zh` - Chinese

**`model`** - OpenAI Whisper model
- `whisper-1` - Standard model (recommended)

### Paste Settings

**`add_timestamp`** - Add timestamp prefix to pasted text
- `true` - Adds timestamp like "24 11 01 14:30:45" before text
- `false` - Pastes text without timestamp

**`hotkey`** - Paste shortcut used by auto-paste
- `auto` - Platform default (Windows: `ctrl_v`, Linux: `ctrl_shift_v`, macOS: `command_v`)
- `ctrl_v` - Force Ctrl+V
- `ctrl_shift_v` - Force Ctrl+Shift+V
- `command_v` - Force Command+V

## How It Works

1. **Start the app**
2. **Leave it running**
3. **Change settings** using `change_settings.py` or by editing `runtime_config.json`
4. **Settings apply immediately** on the next transcription/paste

No restart needed!

## Example Workflow

```bash
# Terminal 1: Start the main program
python main.py

# Terminal 2: Change language to English
python change_settings.py
# Select option 1, enter "en"


# Change back to Portuguese
python change_settings.py  
# Select option 1, enter "pt"

# Next transcription will be in Portuguese!
```

## Fallback Behavior

If configuration is not set via environment variables, defaults from the Python config classes are used.
- Falls back to defaults in `src/transcriber/configs/transcribe_config.py`
- Falls back to defaults in `common/config/config_app.py`

## Notes

- The JSON file is checked on **every transcription and paste operation**
- Changes are instant - no restart needed
- The file is in `.gitignore` so your personal settings won't be committed
- You can edit the JSON file with any text editor while the program runs

