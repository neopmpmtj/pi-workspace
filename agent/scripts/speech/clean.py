#!/usr/bin/env python3
"""
Markdown -> speakable plain text.

Reads markdown on stdin, writes text that sounds right when read aloud:
no asterisks, no backticks, no URLs read character by character, no tables
recited column by column, no emoji names.

Zones: speech, text normalization
Excludes: synthesis (speak.sh), delivery (Telegram bridge / audio device)
"""

from __future__ import annotations

import re
import sys

MAX_CHARS_DEFAULT = 1600

# Fenced code blocks: replaced by a short spoken note, never read aloud.
FENCE = re.compile(r"^(```|~~~).*?^\1[^\n]*$", re.S | re.M)
INLINE_CODE = re.compile(r"`([^`]*)`")
IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
LINK = re.compile(r"\[([^\]]+)\]\((?:[^)]+)\)")
BARE_URL = re.compile(r"(?:https?://|www\.)\S+", re.I)
TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$")
TABLE_SEP = re.compile(r"^\s*\|?[\s:|-]{3,}\|?\s*$")
HEADING = re.compile(r"^\s{0,3}#{1,6}\s*")
BULLET = re.compile(r"^\s{0,3}[-*+]\s+")
NUMBERED = re.compile(r"^\s{0,3}\d+[.)]\s+")
EMPHASIS = re.compile(r"(\*\*|__|\*|_|~~)")
HTML_TAG = re.compile(r"<[^>]{1,80}>")
EMOJI = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\uFE0F\u200D]"
)
MULTI_NL = re.compile(r"\n{3,}")
MULTI_SPACE = re.compile(r"[ \t]{2,}")


def spoken_plain(text: str, max_chars: int) -> str:
    text = FENCE.sub("\n\n(code shown in the text reply)\n\n", text)
    text = TABLE_ROW.sub("", text)
    text = TABLE_SEP.sub("", text)
    text = IMAGE.sub(r"\1", text)
    text = LINK.sub(r"\1", text)
    text = BARE_URL.sub("the link in the text", text)
    text = INLINE_CODE.sub(r"\1", text)
    text = HTML_TAG.sub("", text)

    out: list[str] = []
    for line in text.splitlines():
        if not line.strip():
            out.append("")
            continue
        is_item = bool(BULLET.match(line) or NUMBERED.match(line))
        line = HEADING.sub("", line)
        line = BULLET.sub("", line)
        line = NUMBERED.sub("", line)
        line = EMPHASIS.sub("", line)
        line = EMOJI.sub("", line)
        line = MULTI_SPACE.sub(" ", line).strip()
        if not line:
            continue
        # A spoken list item needs a full stop, not comma soup.
        if is_item and line[-1] not in ".!?:;":
            line += "."
        if line[-1] not in ".!?:;,":
            line += "."
        out.append(line)

    spoken = "\n".join(out)
    spoken = MULTI_NL.sub("\n\n", spoken).strip()

    if max_chars > 0 and len(spoken) > max_chars:
        cut = spoken[:max_chars]
        boundary = max(cut.rfind(". "), cut.rfind(".\n"))
        if boundary > max_chars // 2:
            cut = cut[: boundary + 1]
        spoken = cut.rstrip() + "\nThe rest is in the text reply."
    return spoken


def main(argv: list[str]) -> int:
    max_chars = MAX_CHARS_DEFAULT
    for i, arg in enumerate(argv):
        if arg in ("--limit", "-n") and i + 1 < len(argv):
            max_chars = int(argv[i + 1])
        elif arg.startswith("--limit="):
            max_chars = int(arg.split("=", 1)[1])
    raw = sys.stdin.read()
    spoken = spoken_plain(raw, max_chars)
    if not spoken:
        return 1
    sys.stdout.write(spoken + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
