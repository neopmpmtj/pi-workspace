#!/bin/bash
# ============================================================
# text-to-speech — install the daily audio-cleanup cron job.
#
# Deletes generated audio files (tts_*.mp3/wav/...) older than the
# configured retention (TTS_RETENTION_DAYS env or the dashboard's
# "Keep audio (days)" setting, default 14) from the output folder.
# Runs daily at 03:00. Log output: /tmp/tts_cleanup.log
#
# Usage: ./install_cleanup_cron.sh
# ============================================================

APP_DIR="$HOME/.pi/apps-scripts/text-to-speech"
PYTHON="$APP_DIR/.venv/bin/python3"
CRON_LINE="0 3 * * * cd $APP_DIR && $PYTHON -m text_to_speech --cleanup-audio >> /tmp/tts_cleanup.log 2>&1"

# Build the new crontab: keep existing entries, replace any old TTS cleanup line.
( crontab -l 2>/dev/null | grep -vF "text_to_speech --cleanup-audio" ; echo "$CRON_LINE" ) | crontab -

echo "Cleanup cron installed:"
crontab -l | grep "text_to_speech --cleanup-audio"
