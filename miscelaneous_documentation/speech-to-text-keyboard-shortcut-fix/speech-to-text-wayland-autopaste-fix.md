# Speech-to-Text — Wayland Auto-Paste Fix

**Date:** 2026-08-17
**System:** Ubuntu 24.04, GNOME Shell 46, **Wayland** session
**App:** `/home/pmpmt/.pi/apps-scripts/on-demand-stt-rewrite/speech-to-text/`
**Status:** FIXED and VERIFIED WORKING

---

## Summary

After switching from an X11 to a **Wayland** session, the transcription app stopped
auto-pasting. Recording + transcription still worked, and the text landed in the
clipboard, but it only appeared at the cursor after the user manually pressed
**Ctrl+Shift+V**.

The app's auto-paste relied on `pyautogui`, which is X11-only. Under Wayland it not
only fails to inject keystrokes — `import pyautogui` itself throws at import time.
Fix: auto-paste now uses **`ydotool`** (kernel/`uinput` injection, works on Wayland)
plus **`wl-copy`** (Wayland-native clipboard).

---

## Root cause (two layers)

1. **`pyautogui` cannot even be imported on Wayland.**
   `pyautogui` → `mouseinfo` runs `Display(os.environ['DISPLAY'])` at import time.
   On Wayland, `DISPLAY=:0` points to XWayland, which requires an X auth cookie that
   python-xlib can't use here, so the import raises:
   ```
   Xlib.error.DisplayConnectionError: Can't connect to display ":0":
   b'Authorization required, but no authorization protocol specified\n'
   ```
   Because the old code had `import pyautogui` **outside** the `try` in
   `paste_clipboard()`, the exception escaped to `record_daemon.py`, producing the log
   line `Error while copying/pasting transcription: Can't connect to display ":0": ...`
   (and `paste_from_clipboard.log` got zero new entries — the import failed before the
   logger was even created).

2. **Even if it imported, X11 synthetic keys don't reach native Wayland windows.**
   `pyautogui.hotkey()`/`xdotool` inject XTest events that only X11/XWayland clients
   receive. Native Wayland apps (GNOME Terminal, Firefox, etc.) ignore them.

The old code also mis-detected Wayland: it only treated `wayland && no DISPLAY` as
Wayland, which never matched GNOME (GNOME always sets `DISPLAY=:0` via XWayland).

Evidence: `paste_from_clipboard.log` shows auto-paste worked on **2026-08-06** when
`session_type=x11` ("Clipboard content pasted successfully"), and failed every time
after the session became Wayland.

---

## The fix

### Code change — `common/utils/paste_from_clipboard.py`

1. **Lazy `pyautogui` import** — moved `import pyautogui` into the X11 branch only, so
   the Wayland path never touches it.
2. **New `_paste_on_wayland(content, paste_hotkey, logger)` helper** that:
   - writes text to the Wayland clipboard with `wl-copy` (reads text from stdin),
   - simulates the paste keystroke with `ydotool key ctrl+shift+v`
     (ydotool v0.1.8 uses case-insensitive **named** keys),
   - types a trailing space with `ydotool type ' '`
     (note: `space` is **not** a valid `ydotool key` name — `key space` would type `s`).
3. **Correct Wayland detection** — `is_wayland = (XDG_SESSION_TYPE == "wayland")`,
   independent of whether XWayland sets `DISPLAY`.

The X11 path (`pyautogui.hotkey` + `write(' ')`) is preserved unchanged, so the app
still works if the session is switched back to Xorg.

### System setup (needed for the Wayland path)

Three packages:
```bash
sudo apt install -y ydotool ydotoold wl-clipboard
```

`ydotoold` (v0.1.8) hardcodes its socket at `/tmp/.ydotool_socket` and `chmod 0600`
(root-only), so a root systemd service is used and the socket is chowned to the user:

`/etc/systemd/system/ydotoold.service`:
```ini
[Unit]
Description=ydotoold - uinput keyboard/mouse injection daemon
After=multi-user.target

[Service]
Type=simple
ExecStart=/usr/bin/ydotoold
ExecStartPost=/bin/sh -c 'for i in $(seq 1 10); do [ -S /tmp/.ydotool_socket ] && break; sleep 0.2; done; chown pmpmt:pmpmt /tmp/.ydotool_socket'
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Enable it:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ydotoold
```

---

## How auto-paste works now (end-to-end, Wayland)

```
Press Ctrl+Alt+minus (GNOME custom shortcut)  →  toggle_speech.sh
        │  first press: starts record_daemon.py (records mic → memory)
        └  second press: SIGTERM → stop → transcribe (OpenAI Whisper API)
                │
                ▼
record_daemon.py:
    pyperclip.copy(text)            # X11 clipboard (fallback for manual paste)
    paste_clipboard()
        │  is_wayland == True
        ▼
    _paste_on_wayland():
        wl-copy <<< text            # Wayland-native clipboard
        ydotool key ctrl+shift+v    # inject paste at cursor (uinput)
        ydotool type ' '            # trailing space
```

---

## Verification checklist

```bash
systemctl is-enabled ydotoold        # enabled
systemctl is-active ydotoold         # active
ls -l /tmp/.ydotool_socket           # srw------- 1 pmpmt pmpmt
command -v ydotool ydotoold wl-copy  # all on PATH

# Functional test (cursor in a text field):
printf 'auto-paste test' | wl-copy && ydotool key ctrl+shift+v && ydotool type ' '
```

Then the real test: press **Ctrl+Alt+minus** → speak → press again → text appears at
cursor automatically.

---

## If it breaks again

- **Symptom: `ydotool not found on PATH` in `paste_from_clipboard.log`** →
  package missing; `sudo apt install ydotool`.
- **Symptom: `ydotool key ... failed` / "permission denied"** →
  daemon down or socket perms wrong. Check `systemctl status ydotoold` and
  `ls -l /tmp/.ydotool_socket`; re-run the `systemctl enable --now ydotoold` + chown
  steps above.
- **Symptom: paste inserts nothing but no error** → `wl-copy` missing
  (`sudo apt install wl-clipboard`).
- If the whole machine is restored from a backup, re-run the package install + service
  steps — the `ydotoold` service file and the code edits must both be present.

## Related docs

- `speech-to-text-debug-report.md` — the earlier (X11) keyboard-shortcut fix, 9 issues
  (paths, permissions, PortAudio, ffmpeg, xclip, python3-tk, etc.). Still relevant for
  a fresh install; this Wayland fix is an additional layer on top.
