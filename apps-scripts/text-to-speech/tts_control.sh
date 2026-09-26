#!/bin/bash
# ============================================================
# text-to-speech — playback controls (pause / stop)
#
# Bound dynamically during playback:
#   Space  -> "tts_control.sh pause"   (custom9)
#   Escape -> "tts_control.sh stop"    (custom10)
#
# The bindings are enabled/disabled by play_daemon.py, so these keys
# behave completely normally whenever nothing is playing.
# ============================================================

PIDFILE="/tmp/tts_playback.pid"
SCHEMA="org.gnome.settings-daemon.plugins.media-keys.custom-keybinding"
PAUSE_SLOT="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom9/"
STOP_SLOT="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom10/"

case "$1" in
    pause) SIGNAL=USR1 ;;
    stop)  SIGNAL=TERM ;;
    *)
        echo "usage: $0 pause|stop"
        exit 1
        ;;
esac

if [ -f "$PIDFILE" ]; then
    PID="$(cat "$PIDFILE" 2>/dev/null)"
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        kill -"$SIGNAL" "$PID"
        exit 0
    fi
    rm -f "$PIDFILE"
fi

# No live daemon: make sure the global Space/Escape bindings are released.
gsettings set "$SCHEMA:$PAUSE_SLOT" binding '' 2>/dev/null
gsettings set "$SCHEMA:$STOP_SLOT" binding '' 2>/dev/null
exit 0
