# Text Rewrite Keyboard Shortcut — Debug & Fix Report

**Date:** 2026-07-12
**System:** Ubuntu 24.04, GNOME, X11
**Script:** `/home/pmpmt/.pi/apps-scripts/on-demand-stt-rewrite/text_rewrite/text_rewrite.sh`
**GNOME Shortcut:** `Ctrl+Alt+r` → `custom1`

---

## Summary

The GNOME custom keyboard shortcut `Ctrl+Alt+r` was configured to call `text_rewrite.sh`, which reads clipboard text, sends it to the OpenAI API for rewriting (using a configured prompt template), and pastes the result at the cursor position. Nothing happened when the shortcut was pressed — no rewrite, no paste, no notification. The root cause was a cascade of 6 issues: the wrapper script lacked execute permissions, the paste mechanism relied on a missing system tool (`xdotool`), there were no desktop notifications for user feedback, the paste approach was X11-only with no Wayland fallback, a required Python package (`pyautogui`) wasn't installed, and clipboard-to-paste timing was too tight.

---

## Issue 1 — Wrapper script not executable

**File:** `text_rewrite.sh`
**Symptom:** GNOME shortcut `Ctrl+Alt+r` did nothing — the script silently failed to launch because GNOME tries to `exec()` shortcut commands directly and cannot run non-executable files.

```bash
# Before:
-rw-r--r--  pmpmt pmpmt  624 Dec 20  2025 text_rewrite.sh

# After:
-rwxr-xr-x  pmpmt pmpmt  624 Dec 20  2025 text_rewrite.sh
```

**Fix:**
```bash
chmod +x /home/pmpmt/.pi/apps-scripts/on-demand-stt-rewrite/text_rewrite/text_rewrite.sh
```

This is identical to **Issue #2** from the speech-to-text debug report. GNOME custom shortcuts require the target script to have execute permission.

---

## Issue 2 — `xdotool` not installed (paste mechanism broken)

**File:** `src/text_rewrite/core/clipboard.py` (original `write_and_paste()` function)
**Symptom:** Text was successfully rewritten and copied to clipboard, but `xdotool key ctrl+v` failed because `xdotool` was not on the system. The rewritten text sat in the clipboard requiring manual `Ctrl+V`.

```python
# Original code used xdotool:
result = subprocess.run(
    ['xdotool', 'key', 'ctrl+v'],
    capture_output=True, text=True, timeout=5
)
```

**Fix:** Replaced `xdotool` with `pyautogui.hotkey()` — the same proven approach used in the speech-to-text script, which was already confirmed working on this system (python3-tk and xclip were installed during that fix session).

```python
# New code uses pyautogui (consistent with speech-to-text):
import pyautogui
pyautogui.hotkey('ctrl', 'shift', 'v')
```

**Note:** `xdotool` also has a fundamental limitation — it's X11-only and will never work under Wayland. `pyautogui` has the same X11 requirement but at least provides clear error detection rather than silent failure.

---

## Issue 3 — `pyautogui` not installed in `.venv`

**File:** `.venv/` (virtual environment)
**Symptom:** After switching from `xdotool` to `pyautogui`, the import would fail at runtime because `pyautogui` was not in the virtual environment.

```
ModuleNotFoundError: No module named 'pyautogui'
```

**Fix:**
```bash
cd ~/.pi/apps-scripts/on-demand-stt-rewrite/text_rewrite
.venv/bin/pip install pyautogui==0.9.54
```

**Dependencies installed:** `pyautogui`, `mouseinfo`, `pygetwindow`, `pymsgbox`, `pyrect`, `pyscreeze`, `python3-Xlib`, `pytweening`.

---

## Issue 4 — No desktop notifications (zero user feedback)

**Files:** `src/text_rewrite/main.py`, `src/text_rewrite/core/clipboard.py`
**Symptom:** When triggered via keyboard shortcut, the user received no feedback — no indication that the rewrite was in progress, whether it succeeded, or whether it failed. The user pressed `Ctrl+Alt+r` and just had to guess.

**Fix:** Added `notify-send` calls at three key points in the workflow:

| Trigger | Notification | Urgency |
|---------|-------------|---------|
| Rewrite starts | `"Rewriting with 'grammar' prompt…"` | `low` |
| Paste succeeds | `"Rewritten text pasted successfully!"` | `normal` |
| Rewrite fails | `"Rewrite failed. Check logs for details."` | `critical` |
| Auto-paste blocked (Wayland) | `"Done! Text is in clipboard. Press Ctrl+V to paste."` | `normal` |
| Auto-paste error | `"Done! Text is in clipboard but auto-paste failed. Press Ctrl+V."` | `critical` |

**Note:** `libnotify-bin` (provides `notify-send`) was already installed during the speech-to-text fix session (Issue #6 in that report).

---

## Issue 5 — No Wayland detection (would silently fail)

**File:** `src/text_rewrite/core/clipboard.py`
**Symptom:** If the user ever switches from X11 to Wayland (Ubuntu 24.04's default), `pyautogui.hotkey()` would fail silently because Wayland blocks synthetic key events from Xlib-based tools. The rewritten text would be in the clipboard but the user wouldn't know why paste didn't happen.

**Fix:** Added display environment detection at the start of `write_and_paste()`:

```python
session_type = os.environ.get("XDG_SESSION_TYPE", "unknown").lower()
display = os.environ.get("DISPLAY")
wayland_display = os.environ.get("WAYLAND_DISPLAY")

if not display and not wayland_display:
    logger.error("No graphical display detected; cannot auto-paste.")
    _send_notification("Text Rewrite", "Done! Text is in clipboard. Press Ctrl+V to paste.")
    return False

if session_type == "wayland" and not display:
    logger.error("Wayland without X11 DISPLAY — auto-paste not supported.")
    _send_notification("Text Rewrite", "Done! Text is in clipboard (Wayland). Press Ctrl+V to paste.")
    return False
```

When auto-paste is impossible, the text remains in the clipboard and the user is notified to paste manually — graceful degradation instead of silent failure.

---

## Issue 6 — Fragile paste timing

**File:** `src/text_rewrite/core/clipboard.py` (original `write_and_paste()`)
**Symptom:** The original code had a `time.sleep(0.1)` between copying to clipboard and simulating `Ctrl+V`. On some systems, 100ms isn't enough for the clipboard to synchronize, causing empty or stale content to be pasted.

**Fix:** Increased delay to `0.15s` (150ms) and wrapped the entire paste operation in proper exception handling with fallback notifications:

```python
# Copy text to clipboard
pyperclip.copy(text)

# Small delay to ensure clipboard is ready
time.sleep(0.15)

# Simulate paste
pyautogui.hotkey('ctrl', 'shift', 'v')
```

If `pyautogui.hotkey()` still fails, the exception is caught and the user is notified that the text is in the clipboard and can be pasted manually.

---

## Side note — API key exposure

**File:** `.env`
**Risk:** The OpenAI API key (`sk-proj-MU5...`) is stored in plain text inside the project's `.env` file. If the repository is ever shared or backed up, the key is exposed. This was not functionally blocking but is a security concern.

**Recommendation:** Move the key to a more secure location (e.g., `~/.config/text_rewrite/.env` or use `secret-tool` from `libsecret`).

---

## How the keyboard shortcut works (end-to-end)

```
User presses Ctrl+Alt+r
        │
        ▼
GNOME custom shortcut launches:
  /home/pmpmt/.pi/apps-scripts/on-demand-stt-rewrite/text_rewrite/text_rewrite.sh
        │
        ├─ cd to script directory
        ├─ source .venv/bin/activate
        ├─ export PYTHONPATH
        │
        ▼
  python3 -m src.text_rewrite  (with saved prompt "grammar")
        │
        ├─ notify-send: "Rewriting with 'grammar' prompt…"
        │
        ├─ pyperclip.paste()          ← reads clipboard via xclip
        │
        ├─ OpenAI API call            ← grammar-polish prompt + clipboard text
        │     └─ 3 retries with exponential backoff (1s, 2s, 4s)
        │
        ├─ pyperclip.copy(result)     ← writes rewritten text to clipboard via xclip
        │
        ├─ Detect display (X11/Wayland)
        │
        ├─ pyautogui.hotkey('ctrl', 'shift', 'v')   ← simulates paste via Xlib
        │
        └─ notify-send: "Rewritten text pasted successfully!"
              │
              ▼
        Rewritten text appears at cursor position
```

---

## All fixes at a glance

| # | Issue | Category | Fix |
|---|---|---|---|
| 1 | `text_rewrite.sh` not executable | Permissions | `chmod +x` |
| 2 | `xdotool` not installed + X11-only | Paste mechanism | Replaced with `pyautogui.hotkey()` |
| 3 | `pyautogui` not in `.venv` | Python dep | `pip install pyautogui==0.9.54` |
| 4 | No desktop notifications | UX | Added `notify-send` at start/success/failure |
| 5 | No Wayland detection | Compatibility | Added `XDG_SESSION_TYPE`/`DISPLAY` checks |
| 6 | Clipboard-paste timing too tight | Reliability | Increased delay 0.1s → 0.15s + error handling |

**System dependencies already satisfied (from speech-to-text fix session):**
```bash
# These were already installed — required by pyperclip + pyautogui:
sudo apt install -y libnotify-bin xclip python3-tk
```

**One-liner for the text_rewrite-specific fix (Python dep):**
```bash
cd ~/.pi/apps-scripts/on-demand-stt-rewrite/text_rewrite
chmod +x text_rewrite.sh
.venv/bin/pip install pyautogui==0.9.54
```

---

## Verification

Tested end-to-end from `/tmp` (simulating GNOME shortcut execution environment):

```
$ cd /tmp && /home/pmpmt/.pi/apps-scripts/on-demand-stt-rewrite/text_rewrite/text_rewrite.sh

2026-07-12 16:24:47 - text_rewrite - INFO - Configuration loaded successfully
2026-07-12 16:24:47 - text_rewrite - INFO - Starting text rewrite with prompt: grammar
2026-07-12 16:24:47 - text_rewrite - INFO - Starting clipboard text rewriting
2026-07-12 16:24:48 - text_rewrite - INFO - Rewriting successful (105→60 tokens)
2026-07-12 16:24:49 - text_rewrite - INFO - Successfully pasted rewritten text at cursor position ✓
```

**Timing:** ~2 seconds total (clipboard read → OpenAI API → paste).

---

## Files modified

| File | Change |
|------|--------|
| `text_rewrite.sh` | `chmod +x` (permissions only) |
| `src/text_rewrite/core/clipboard.py` | Complete rewrite: xdotool → pyautogui, +Wayland detection, +notify-send, improved timing |
| `src/text_rewrite/main.py` | Added `notify-send` calls for workflow lifecycle |
| `requirements.txt` | Replaced `xdotool` note with `pyautogui>=0.9.54` + updated system dep notes |
| `.venv/` | Installed `pyautogui==0.9.54` and transitive deps |