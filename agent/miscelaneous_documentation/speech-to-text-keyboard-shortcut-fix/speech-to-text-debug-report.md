# Speech-to-Text Keyboard Shortcut — Debug & Fix Report

**Date:** 2026-07-12
**System:** Ubuntu 24.04, GNOME, X11
**Script:** `/home/pmpmt/.pi/apps-scripts/on-demand-stt-rewrite/speech-to-text/toggle_speech.sh`

---

## Summary

The GNOME custom keyboard shortcut `Ctrl+Alt+minus` was configured to call `toggle_speech.sh` but nothing happened — no recording, no transcription, no paste. The root cause was a cascade of 9 separate issues: one wrong path, missing system libraries, missing Python dependencies, a typo in a command name, and the script lacking execute permissions.

---

## Issue 1 — Wrong `APP_DIR` path

**File:** `toggle_speech.sh` (line 15)
**Symptom:** Script silently exited — `cd` failed, `|| exit 1` kicked in, nothing ran.

```bash
# BEFORE (wrong):
APP_DIR="$HOME/apps/U-speech-to-text"

# AFTER (correct):
APP_DIR="$HOME/.pi/apps-scripts/on-demand-stt-rewrite/speech-to-text"
```

The directory `~/apps/U-speech-to-text/` never existed. The actual app lives under `~/.pi/apps-scripts/on-demand-stt-rewrite/speech-to-text/`.

---

## Issue 2 — Script not executable

**File:** `toggle_speech.sh`
**Symptom:** GNOME may fail to run a non-executable script via its shortcut mechanism.

```bash
# Fix:
chmod +x /home/pmpmt/.pi/apps-scripts/on-demand-stt-rewrite/speech-to-text/toggle_speech.sh
```

Permissions before: `-rw-r--r--` → after: `-rwxr-xr-x`.

---

## Issue 3 — Empty `.venv` (no Python dependencies)

**File:** `.venv/` (virtual environment)
**Symptom:** Daemon crashed on import with `ModuleNotFoundError: No module named 'numpy'`.

The `.venv` contained only `pip 24.0` — none of the 26 required packages were installed.

```bash
# Fix:
cd ~/.pi/apps-scripts/on-demand-stt-rewrite/speech-to-text
.venv/bin/pip install -r requirements.txt
```

**Side-fix:** `requirements.txt` listed `python3-tk` and `python3-dev`, which are system (apt) packages, not pip packages. These were commented out so `pip install` could complete.

---

## Issue 4 — PortAudio library missing

**Symptom:** `OSError: PortAudio library not found` when importing `sounddevice`.

`sounddevice` wraps the PortAudio C library. Only the Python wheel was installed — the underlying shared library was absent.

```bash
# Fix:
sudo apt install libportaudio2
```

---

## Issue 5 — ffmpeg binary missing

**Symptom:** `pydub` (used for audio format conversion) needs the `ffmpeg` executable. Libraries were present (`libavcodec60`, `libavformat60`, etc.) but the CLI tool was not.

```bash
# Fix:
sudo apt install ffmpeg
```

---

## Issue 6 — Desktop notifications broken

**File:** `toggle_speech.sh` (lines 27, 37)
**Symptom:** `notify: command not found` — desktop notifications failed silently.

Two problems:
1. The script called `notify`, but the actual command on Ubuntu is `notify-send`.
2. The `libnotify-bin` package (which provides `notify-send`) was not installed.

```bash
# Fixes:
sudo apt install libnotify-bin

# In toggle_speech.sh:
# notify "Stopping" "..."  →  notify-send "Stopping" "..."
# notify "Recording" "..."  →  notify-send "Recording" "..."
```

---

## Issue 7 — xclip missing (clipboard copy)

**Symptom:** `Pyperclip could not find a copy/paste mechanism for your system.`
Transcription succeeded but could not be copied to the system clipboard.

`pyperclip` needs either `xclip` or `xsel` as a backend on Linux X11.

```bash
# Fix:
sudo apt install xclip
```

---

## Issue 8 — python3-tk missing (auto-paste)

**Symptom:** Transcription landed in the clipboard but auto-paste (`Ctrl+Shift+v`) never fired. Manual paste worked.

`pyautogui` imports `mouseinfo`, which requires `tkinter`. When `python3-tk` is not installed, the entire `pyautogui` import fails silently (exit code 1 with only a warning note), so `pyautogui.hotkey('ctrl', 'shift', 'v')` never executes.

```bash
# Fix:
sudo apt install python3-tk
```

This was the final blocker. After this, `pyautogui.hotkey()` successfully simulates the paste keystroke at the cursor position.

---

## How the keyboard shortcut works (end-to-end)

```
User presses Ctrl+Alt+minus
        │
        ▼
GNOME custom shortcut launches:
  /home/pmpmt/.pi/apps-scripts/on-demand-stt-rewrite/speech-to-text/toggle_speech.sh
        │
        ├─ First press: starts record_daemon.py in background, writes PID to /tmp/u_speech_record.pid
        │     └─ record_daemon.py: opens mic → records audio in memory → waits for SIGTERM
        │
        └─ Second press: reads PID file → sends SIGTERM to daemon
              └─ record_daemon.py: stops recording → sends audio to OpenAI Whisper API
                    → pyperclip.copy(text) via xclip
                    → pyautogui.hotkey('ctrl', 'shift', 'v') via python3-tk/Xlib
                    → text appears at cursor
```

---

## All fixes at a glance

| # | Issue | Category | Fix |
|---|---|---|---|
| 1 | Wrong `APP_DIR` in toggle_speech.sh | Config | Corrected path in script |
| 2 | Script not executable | Permissions | `chmod +x` |
| 3 | `.venv` empty | Python deps | `pip install -r requirements.txt` |
| 4 | PortAudio missing | System lib | `apt install libportaudio2` |
| 5 | ffmpeg missing | System tool | `apt install ffmpeg` |
| 6 | `notify` → `notify-send` | Typo + missing pkg | Fixed script + `apt install libnotify-bin` |
| 7 | xclip missing | System tool | `apt install xclip` |
| 8 | python3-tk missing | System lib | `apt install python3-tk` |

**One-liner for all system packages:**
```bash
sudo apt install -y libportaudio2 ffmpeg libnotify-bin xclip python3-tk
```