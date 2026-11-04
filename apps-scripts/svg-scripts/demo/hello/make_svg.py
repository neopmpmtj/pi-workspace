#!/usr/bin/env python3
"""Generate hello.svg — a small, self-contained animation demo.

Stdlib only. The SVG is a pure function of the constants below, so running this
twice produces byte-identical output (no timestamps, no randomness).

Usage:
    python3 make_svg.py                # writes hello.svg next to this script
    python3 make_svg.py --out /tmp/x.svg
    python3 make_svg.py --title "Hi"   # override the headline text
"""

from __future__ import annotations

import argparse
import xml.etree.ElementTree as ET
from pathlib import Path

WIDTH = 640
HEIGHT = 320
CARD_X, CARD_Y, CARD_W, CARD_H = 300, 62, 300, 196

# dotted grid corners
GRID_EDGE = 40
GRID_STEP = 80
GRID_ROWS = (40, 280)
DOT_R = 1.6

# tiny bar chart: (x, y, w, h, fill)
BARS = (
    (0, 0, 10, 18, "#4cc9f0"),
    (18, -6, 10, 24, "#b5179e"),
    (36, -12, 10, 30, "#f72585"),
    (54, -3, 10, 21, "#7209b7"),
)

FONT = "Inter, Helvetica, Arial, sans-serif"


def _grid_dots() -> str:
    circles = []
    for y in GRID_ROWS:
        for x in range(GRID_EDGE, WIDTH, GRID_STEP):
            circles.append(f'<circle cx="{x}" cy="{y}" r="{DOT_R}"/>')
    return "\n    ".join(circles)


def _bars() -> str:
    rects = []
    for x, y, w, h, fill in BARS:
        rects.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" fill="{fill}"/>'
        )
    return "\n      ".join(rects)


def build_svg(title: str = "Hello, SVG") -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" width="{WIDTH}" height="{HEIGHT}" role="img" aria-label="SVG demo: gradient background, shapes, text and an animation">
  <title>SVG demo</title>

  <defs>
    <!-- background gradient -->
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1020"/>
      <stop offset="55%" stop-color="#15204a"/>
      <stop offset="100%" stop-color="#2b1b4d"/>
    </linearGradient>

    <!-- gradient for the rotating ring -->
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4cc9f0"/>
      <stop offset="50%" stop-color="#b5179e"/>
      <stop offset="100%" stop-color="#f72585"/>
    </linearGradient>

    <!-- soft glow -->
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- canvas -->
  <rect width="{WIDTH}" height="{HEIGHT}" fill="url(#bg)"/>

  <!-- dotted grid -->
  <g fill="#ffffff" opacity="0.10">
    {_grid_dots()}
  </g>

  <!-- rotating dashed ring -->
  <g transform="translate(150 160)">
    <circle r="84" fill="none" stroke="url(#ring)" stroke-width="3"
            stroke-dasharray="18 12" opacity="0.9">
      <animateTransform attributeName="transform" type="rotate"
                        from="0" to="360" dur="12s" repeatCount="indefinite"/>
    </circle>
    <!-- pulsing core -->
    <circle r="34" fill="#4cc9f0" opacity="0.85" filter="url(#glow)">
      <animate attributeName="r" values="30;38;30" dur="3s" repeatCount="indefinite"/>
    </circle>
    <circle r="12" fill="#ffffff" opacity="0.95"/>
  </g>

  <!-- rounded card on the right -->
  <g transform="translate({CARD_X} {CARD_Y})">
    <rect width="{CARD_W}" height="{CARD_H}" rx="16" fill="#ffffff" opacity="0.07"
          stroke="#ffffff" stroke-opacity="0.18"/>
    <text x="24" y="52" font-family="{FONT}"
          font-size="26" font-weight="700" fill="#ffffff">{title}</text>
    <text x="24" y="82" font-family="{FONT}"
          font-size="13" fill="#9fb3d9">vector · scalable · animatable</text>

    <g font-family="{FONT}" font-size="12.5" fill="#dbe6ff">
      <text x="24" y="118">• shapes, paths, gradients</text>
      <text x="24" y="140">• text as real text (selectable)</text>
      <text x="24" y="162">• declarative animation via SMIL</text>
    </g>

    <!-- tiny bar chart to show geometry -->
    <g transform="translate(24 176)">
      {_bars()}
    </g>
  </g>

  <!-- footer -->
  <text x="600" y="300" text-anchor="end"
        font-family="{FONT}" font-size="11"
        fill="#ffffff" opacity="0.45">hello.svg</text>
</svg>
"""


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate the demo SVG.")
    ap.add_argument("--out", default=str(Path(__file__).with_name("hello.svg")),
                    help="output path (default: hello.svg beside this script)")
    ap.add_argument("--title", default="Hello, SVG", help="headline text")
    args = ap.parse_args()

    svg = build_svg(args.title)

    # fail loudly rather than writing a file no renderer will accept
    ET.fromstring(svg)

    out = Path(args.out).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg, encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
