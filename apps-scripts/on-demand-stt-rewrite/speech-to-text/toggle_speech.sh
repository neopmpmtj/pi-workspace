#!/bin/bash

LOGFILE="/tmp/toggle_speech.log"
echo "[$(date)] toggle_speech called" >> "$LOGFILE"

# Load API keys into this non-interactive environment.
# The app's own .env is the PRIMARY source (sourced last so it wins);
# ~/.config/openai.env is only a fallback.
set -a
if [ -f "$HOME/.config/openai.env" ]; then
    # shellcheck source=/dev/null
    . "$HOME/.config/openai.env"
fi
if [ -f "$APP_DIR/.env" ]; then
    # shellcheck source=/dev/null
    . "$APP_DIR/.env"
else
    echo "[$(date)] WARNING: $APP_DIR/.env not found; using fallback only" >> "$LOGFILE"
fi
set +a

PIDFILE="/tmp/speech_record.pid"
APP_DIR="$HOME/.pi/apps-scripts/on-demand-stt-rewrite/speech-to-text"
PYTHON="$APP_DIR/.venv/bin/python3"
DAEMON="$APP_DIR/record_daemon.py"

# If PID file exists and process is alive -> send SIGTERM to stop & transcribe
if [ -f "$PIDFILE" ]; then
    PID="$(cat "$PIDFILE" 2>/dev/null)"

    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "[$(date)] recorder running with PID $PID -> sending SIGTERM" >> "$LOGFILE"
	notify-send "Stopping" "Recording stopped. Transcribing…"
        kill -TERM "$PID"
        exit 0
    else
        echo "[$(date)] stale PID file, removing" >> "$LOGFILE"
        rm -f "$PIDFILE"
    fi
fi

# No running recorder -> start a new one
cd "$APP_DIR" || exit 1

notify-send "Recording" "Microphone is ON. Press shortcut again to stop."
echo "[$(date)] starting daemon: $PYTHON $DAEMON" >> "$LOGFILE"
"$PYTHON" "$DAEMON" >> "$LOGFILE" 2>&1 &
PID=$!
echo "[$(date)] daemon started with PID $PID" >> "$LOGFILE"
echo "$PID" > "$PIDFILE"
disown
