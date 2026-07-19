"""
save_youtube_transcript: fetch and save a timestamped YouTube transcript locally.

This is the public entry-point script. The implementation currently lives in
youtube_transcript_browser.py so existing imports and tests keep working while
the tool gets a clearer name.
"""

from __future__ import annotations

from youtube_transcript_browser import *  # noqa: F401,F403
from youtube_transcript_browser import main


if __name__ == "__main__":
    main()
