#!/usr/bin/env python3
"""
Detailed vector rendition of ~/.pi/01test_image-vision-model.jpeg
(portrait with a fruit headdress).

Geometry was taken from pixel analysis of the source (skin/purple masks plus
2.5x-3x crops), not by eye:

  fruit crown    x 0-412   y 0-320
  turban crown   y 176-250 across x 58-248; right lobe reaches x 290 at y 350
  turban edge    (158,258) (185,292) (205,318) (226,342) (245,358)   <- crosses the face
  forehead       skin from y 248 down, x 60-160
  hair wedge     between fabric edge and cheek, (165,258)-(250,395)
  eyes           (74,347) (146,342)   nose tip (98,405)   mouth x 84-150 y 436-462
  chin           (112,502)  jaw to (245,420)  face left edge x 50-56
  ear/earring    (250,400) / (258,425)
  neck           x 128-282  y 470-600      dress y 545+
  hand           pale skin, nails (8,520) (52,552) (112,570) (158,562)

Usage: python3 fruit_portrait_svg.py [out.svg]
"""
import math
import random
import sys
import xml.etree.ElementTree as ET

W, H = 423, 635
rng = random.Random(20251104)
OUT = []
A = OUT.append


def n(v):
    return f"{v:.1f}".replace(".0", "")


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def berry(cx, cy, r, grad):
    return (
        f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" fill="url(#{grad})"/>'
        f'<path d="M {n(cx - r * .72)} {n(cy + r * .52)} A {n(r)} {n(r)} 0 0 0 '
        f'{n(cx + r * .72)} {n(cy + r * .52)}" fill="none" stroke="#1d0817" '
        f'stroke-width="{n(r * .40)}" opacity=".28"/>'
        f'<ellipse cx="{n(cx - r * .33)}" cy="{n(cy - r * .36)}" rx="{n(r * .30)}" '
        f'ry="{n(r * .21)}" fill="#ffe6ee" opacity=".42" '
        f'transform="rotate(-28 {n(cx - r * .33)} {n(cy - r * .36)})"/>'
    )


def cluster(cx, cy, rx, ry, count, rmin, rmax, grad):
    pts, tries = [], 0
    while len(pts) < count and tries < 9000:
        tries += 1
        a = rng.random() * math.tau
        d = math.sqrt(rng.random())
        x, y = cx + math.cos(a) * rx * d, cy + math.sin(a) * ry * d
        r = rng.uniform(rmin, rmax)
        if all((x - px) ** 2 + (y - py) ** 2 > (r + pr - 2.4) ** 2 for px, py, pr in pts):
            pts.append((x, y, r))
    pts.sort(key=lambda p: p[1])
    return "".join(berry(x, y, r, grad) for x, y, r in pts)


def leaf(x0, y0, x1, y1, width, fill, vein="#c9d48a", veins=5, opacity=1.0):
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    nx, ny = -uy, ux
    c1 = (x0 + ux * L * .26 + nx * width, y0 + uy * L * .26 + ny * width)
    c2 = (x0 + ux * L * .86 + nx * width * .40, y0 + uy * L * .86 + ny * width * .40)
    c3 = (x0 + ux * L * .26 - nx * width, y0 + uy * L * .26 - ny * width)
    c4 = (x0 + ux * L * .86 - nx * width * .40, y0 + uy * L * .86 - ny * width * .40)
    d = (f"M {n(x0)} {n(y0)} C {n(c1[0])} {n(c1[1])} {n(c2[0])} {n(c2[1])} {n(x1)} {n(y1)} "
         f"C {n(c4[0])} {n(c4[1])} {n(c3[0])} {n(c3[1])} {n(x0)} {n(y0)} Z")
    s = [f'<path d="{d}" fill="{fill}" opacity="{opacity}"/>',
         f'<path d="M {n(x0)} {n(y0)} L {n(x1)} {n(y1)}" stroke="{vein}" '
         f'stroke-width="{n(max(0.7, width * .10))}" opacity=".5" fill="none"/>']
    for i in range(1, veins + 1):
        t = i / (veins + 1)
        bx, by = x0 + ux * L * t, y0 + uy * L * t
        span = width * (1 - abs(t - .42) * 1.3) * .92
        for sgn in (1, -1):
            s.append(
                f'<path d="M {n(bx)} {n(by)} Q {n(bx + ux * L * .09 + nx * span * sgn * .85)} '
                f'{n(by + uy * L * .09 + ny * span * sgn * .85)} '
                f'{n(bx + ux * L * .19 + nx * span * sgn)} {n(by + uy * L * .19 + ny * span * sgn)}" '
                f'stroke="{vein}" stroke-width="{n(max(0.45, width * .05))}" opacity=".34" fill="none"/>')
    return "".join(s)


def stem(x0, y0, x1, y1, w=3.4, color="#5b4222"):
    mx, my = (x0 + x1) / 2 + 3, (y0 + y1) / 2 - 2
    return (f'<path d="M {n(x0)} {n(y0)} Q {n(mx)} {n(my)} {n(x1)} {n(y1)}" '
            f'stroke="{color}" stroke-width="{n(w)}" fill="none" stroke-linecap="round"/>')


def speckle(cx, cy, rx, ry, count, color="#f0f8c0", clip_id=None, lo=.10, hi=.34):
    s = []
    for _ in range(count):
        a = rng.random() * math.tau
        d = math.sqrt(rng.random())
        x, y = cx + math.cos(a) * rx * d, cy + math.sin(a) * ry * d
        r = rng.uniform(.5, 1.5)
        s.append(f'<circle cx="{n(x)}" cy="{n(y)}" r="{n(r)}" fill="{color}" '
                 f'opacity="{rng.uniform(lo, hi):.2f}"/>')
    inner = "".join(s)
    return f'<g clip-path="url(#{clip_id})">{inner}</g>' if clip_id else inner


# ==========================================================================
# defs
# ==========================================================================
DEFS = """
<defs>
  <radialGradient id="gBg" cx=".5" cy=".28" r=".82">
    <stop offset="0" stop-color="#fffffe"/>
    <stop offset=".55" stop-color="#f9f6f3"/>
    <stop offset="1" stop-color="#e7e2db"/>
  </radialGradient>

  <radialGradient id="gSkin" cx=".38" cy=".26" r=".85">
    <stop offset="0" stop-color="#fae0c6"/>
    <stop offset=".38" stop-color="#efc8a4"/>
    <stop offset=".74" stop-color="#d9a87f"/>
    <stop offset="1" stop-color="#b8835a"/>
  </radialGradient>
  <linearGradient id="gNeck" x1=".05" y1="0" x2="1" y2=".35">
    <stop offset="0" stop-color="#f3cda9"/>
    <stop offset=".40" stop-color="#e2b189"/>
    <stop offset="1" stop-color="#ad7a53"/>
  </linearGradient>
  <linearGradient id="gHand" x1=".1" y1="0" x2=".9" y2=".6">
    <stop offset="0" stop-color="#fdf1e2"/>
    <stop offset=".45" stop-color="#f3dfc8"/>
    <stop offset="1" stop-color="#d8b595"/>
  </linearGradient>

  <linearGradient id="gTurbanBack" x1=".15" y1="0" x2=".95" y2="1">
    <stop offset="0" stop-color="#8669bf"/>
    <stop offset=".32" stop-color="#61459f"/>
    <stop offset=".70" stop-color="#422b78"/>
    <stop offset="1" stop-color="#241640"/>
  </linearGradient>
  <linearGradient id="gTurbanBand" x1=".05" y1=".05" x2=".5" y2="1">
    <stop offset="0" stop-color="#ab91dc"/>
    <stop offset=".28" stop-color="#8368c0"/>
    <stop offset=".62" stop-color="#573d92"/>
    <stop offset="1" stop-color="#2f1e55"/>
  </linearGradient>
  <linearGradient id="gTurbanRight" x1=".1" y1="0" x2=".9" y2="1">
    <stop offset="0" stop-color="#6f53ab"/>
    <stop offset=".45" stop-color="#4a3081"/>
    <stop offset="1" stop-color="#251741"/>
  </linearGradient>

  <radialGradient id="gAppleRed" cx=".34" cy=".26" r=".82">
    <stop offset="0" stop-color="#de5163"/>
    <stop offset=".33" stop-color="#a81f34"/>
    <stop offset=".70" stop-color="#7c1125"/>
    <stop offset="1" stop-color="#460714"/>
  </radialGradient>
  <radialGradient id="gAppleGreen" cx=".33" cy=".25" r=".80">
    <stop offset="0" stop-color="#f6f9b6"/>
    <stop offset=".28" stop-color="#d3df5c"/>
    <stop offset=".64" stop-color="#9db52f"/>
    <stop offset="1" stop-color="#556618"/>
  </radialGradient>
  <radialGradient id="gApplePale" cx=".34" cy=".26" r=".80">
    <stop offset="0" stop-color="#fcfcd6"/>
    <stop offset=".32" stop-color="#e7eb92"/>
    <stop offset=".68" stop-color="#b8c254"/>
    <stop offset="1" stop-color="#6f7a1d"/>
  </radialGradient>
  <radialGradient id="gLime" cx=".32" cy=".24" r=".85">
    <stop offset="0" stop-color="#bcd873"/>
    <stop offset=".30" stop-color="#82a93c"/>
    <stop offset=".68" stop-color="#4a6a20"/>
    <stop offset="1" stop-color="#1e320c"/>
  </radialGradient>
  <radialGradient id="gLemon" cx=".33" cy=".22" r=".85">
    <stop offset="0" stop-color="#feffd8"/>
    <stop offset=".24" stop-color="#f8ee74"/>
    <stop offset=".60" stop-color="#e2c92b"/>
    <stop offset="1" stop-color="#99780d"/>
  </radialGradient>
  <radialGradient id="gPear" cx=".34" cy=".24" r=".82">
    <stop offset="0" stop-color="#fcfcda"/>
    <stop offset=".28" stop-color="#ebec8c"/>
    <stop offset=".66" stop-color="#c3cb4e"/>
    <stop offset="1" stop-color="#76821e"/>
  </radialGradient>
  <radialGradient id="gCherry" cx=".33" cy=".24" r=".82">
    <stop offset="0" stop-color="#f2636c"/>
    <stop offset=".28" stop-color="#d32c35"/>
    <stop offset=".64" stop-color="#9d1220"/>
    <stop offset="1" stop-color="#56060f"/>
  </radialGradient>
  <radialGradient id="gPeach" cx=".35" cy=".26" r=".82">
    <stop offset="0" stop-color="#fdeac0"/>
    <stop offset=".26" stop-color="#f5b862"/>
    <stop offset=".60" stop-color="#dd7735"/>
    <stop offset="1" stop-color="#8d3519"/>
  </radialGradient>
  <radialGradient id="gGrapeDark" cx=".33" cy=".26" r=".85">
    <stop offset="0" stop-color="#ad6a8c"/>
    <stop offset=".28" stop-color="#753252"/>
    <stop offset=".63" stop-color="#4a1a37"/>
    <stop offset="1" stop-color="#1f0918"/>
  </radialGradient>
  <radialGradient id="gGrapePale" cx=".34" cy=".26" r=".85">
    <stop offset="0" stop-color="#fdfbdd"/>
    <stop offset=".30" stop-color="#e9e5a4"/>
    <stop offset=".68" stop-color="#aeac5e"/>
    <stop offset="1" stop-color="#656931"/>
  </radialGradient>
  <radialGradient id="gMaroon" cx=".34" cy=".26" r=".85">
    <stop offset="0" stop-color="#83404b"/>
    <stop offset=".42" stop-color="#4e1e2c"/>
    <stop offset="1" stop-color="#1a060d"/>
  </radialGradient>

  <linearGradient id="gHair" x1=".2" y1="0" x2=".8" y2="1">
    <stop offset="0" stop-color="#54402f"/>
    <stop offset=".40" stop-color="#2e1d14"/>
    <stop offset="1" stop-color="#100906"/>
  </linearGradient>
  <linearGradient id="gDress" x1=".1" y1="0" x2=".4" y2="1">
    <stop offset="0" stop-color="#fffef6"/>
    <stop offset=".5" stop-color="#f6efdc"/>
    <stop offset="1" stop-color="#d7ccb2"/>
  </linearGradient>
  <linearGradient id="gGold" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fdf6da"/>
    <stop offset=".40" stop-color="#e6d09a"/>
    <stop offset=".74" stop-color="#b89a5a"/>
    <stop offset="1" stop-color="#84672f"/>
  </linearGradient>
  <linearGradient id="gNail" x1=".15" y1="0" x2=".9" y2="1">
    <stop offset="0" stop-color="#f4707f"/>
    <stop offset=".28" stop-color="#d9203e"/>
    <stop offset=".70" stop-color="#a60d24"/>
    <stop offset="1" stop-color="#6b0412"/>
  </linearGradient>
  <linearGradient id="gLips" x1=".2" y1="0" x2=".8" y2="1">
    <stop offset="0" stop-color="#d84a63"/>
    <stop offset=".42" stop-color="#b32645"/>
    <stop offset="1" stop-color="#6d0c28"/>
  </linearGradient>
  <radialGradient id="gIris" cx=".42" cy=".38" r=".62">
    <stop offset="0" stop-color="#c9b07a"/>
    <stop offset=".42" stop-color="#87733f"/>
    <stop offset=".78" stop-color="#4a3c1f"/>
    <stop offset="1" stop-color="#20160a"/>
  </radialGradient>
  <radialGradient id="gPearl" cx=".35" cy=".30" r=".75">
    <stop offset="0" stop-color="#fffdf4"/>
    <stop offset=".5" stop-color="#f0e7d0"/>
    <stop offset="1" stop-color="#b3a180"/>
  </radialGradient>
  <linearGradient id="gVignette" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#000" stop-opacity=".05"/>
    <stop offset=".45" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity=".08"/>
  </linearGradient>

  <filter id="fSoft" x="-35%" y="-35%" width="170%" height="170%"><feGaussianBlur stdDeviation="4.5"/></filter>
  <filter id="fSoft2" x="-35%" y="-35%" width="170%" height="170%"><feGaussianBlur stdDeviation="2.2"/></filter>
  <filter id="fSoft1" x="-35%" y="-35%" width="170%" height="170%"><feGaussianBlur stdDeviation="1.1"/></filter>
  <filter id="fSoft8" x="-45%" y="-45%" width="190%" height="190%"><feGaussianBlur stdDeviation="8"/></filter>
  <filter id="fGrain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
  </filter>
  <filter id="fWeave" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency=".62 .95" numOctaves="2" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
  </filter>

  <pattern id="pRosette" width="34" height="34" patternUnits="userSpaceOnUse">
    <g stroke="#b9a163" fill="none" stroke-width="1" opacity=".8">
      <circle cx="10" cy="10" r="2.1" fill="#c4ad6c" stroke="none"/>
      <ellipse cx="10" cy="4.9" rx="1.9" ry="1.3"/>
      <ellipse cx="14.6" cy="7.6" rx="1.9" ry="1.3" transform="rotate(60 14.6 7.6)"/>
      <ellipse cx="14.6" cy="12.4" rx="1.9" ry="1.3" transform="rotate(120 14.6 12.4)"/>
      <ellipse cx="10" cy="15.1" rx="1.9" ry="1.3"/>
      <ellipse cx="5.4" cy="12.4" rx="1.9" ry="1.3" transform="rotate(120 5.4 12.4)"/>
      <ellipse cx="5.4" cy="7.6" rx="1.9" ry="1.3" transform="rotate(60 5.4 7.6)"/>
      <circle cx="25" cy="24" r="2.9" stroke="#a8957c" opacity=".65"/>
      <circle cx="25" cy="24" r=".9" fill="#e9dcc0" stroke="none"/>
      <circle cx="28" cy="5" r="1.3" fill="#c9b98f" stroke="none" opacity=".75"/>
      <circle cx="5" cy="28" r="1.2" fill="#b8c98f" stroke="none" opacity=".7"/>
      <circle cx="17" cy="30" r="1" fill="#d3a7b0" stroke="none" opacity=".6"/>
    </g>
  </pattern>
  <pattern id="pDaisy" width="72" height="72" patternUnits="userSpaceOnUse">
    <g stroke="#a9926a" fill="none" stroke-width="1.3" opacity=".75">
      <g transform="translate(19 19)">
        <circle r="2.4" fill="#cbb27a" stroke="none"/>
        <ellipse cx="0" cy="-6.5" rx="2.2" ry="3.4"/>
        <ellipse cx="6.5" cy="0" rx="3.4" ry="2.2"/>
        <ellipse cx="0" cy="6.5" rx="2.2" ry="3.4"/>
        <ellipse cx="-6.5" cy="0" rx="3.4" ry="2.2"/>
        <ellipse cx="4.6" cy="-4.6" rx="2" ry="2"/>
        <ellipse cx="-4.6" cy="4.6" rx="2" ry="2"/>
      </g>
      <circle cx="53" cy="49" r="4.2" stroke-dasharray="1.4 2"/>
      <circle cx="42" cy="13" r="1.5" fill="#c0ac84" stroke="none"/>
      <circle cx="11" cy="55" r="1.3" fill="#aebd85" stroke="none"/>
      <circle cx="61" cy="23" r="1.2" fill="#d3a1ab" stroke="none"/>
    </g>
  </pattern>

  <clipPath id="clipFace"><path d="__FACE__"/></clipPath>
  <clipPath id="clipLime"><ellipse cx="383" cy="213" rx="40" ry="40"/></clipPath>
  <clipPath id="clipPear"><ellipse cx="367" cy="275" rx="27" ry="24"/></clipPath>
  <clipPath id="clipTurban"><path d="__TURBAN__"/></clipPath>
  <clipPath id="clipDress"><path d="__DRESS__"/></clipPath>
  <clipPath id="clipNeck"><path d="__NECK__"/></clipPath>
</defs>
"""

# ==========================================================================
# key paths
# ==========================================================================
# visible skin: left cheek edge, chin, jaw up to the far cheek, then the
# diagonal hair/fabric edge back across the forehead
FACE_PATH = (
    "M 58 252 C 52 274 50 302 50 330 C 50 360 52 388 57 414 "
    "C 62 440 70 464 82 482 C 90 494 100 502 112 503 "
    "C 126 505 142 500 156 491 C 176 479 198 460 216 438 "
    "C 230 421 240 404 244 388 C 248 370 246 356 240 344 "
    "C 226 330 208 314 190 296 C 176 282 164 268 158 258 "
    "C 132 250 100 246 80 247 C 70 248 62 250 58 252 Z"
)

TURBAN_PATH = (
    "M 58 252 C 56 214 68 188 92 176 C 128 158 186 158 222 176 "
    "C 258 194 284 226 292 268 C 298 304 296 340 286 368 "
    "C 278 392 264 408 248 418 C 240 422 232 418 229 410 "
    "C 244 396 252 376 254 352 C 254 328 248 308 236 292 "
    "C 224 276 206 264 186 256 C 156 246 118 246 90 254 "
    "C 76 258 66 262 60 268 C 56 262 56 256 58 252 Z"
)

DRESS_PATH = (
    "M 0 588 C 42 562 90 554 126 564 C 154 572 176 588 200 597 "
    "C 220 605 244 600 262 588 C 292 568 332 560 374 566 "
    "C 394 569 410 574 423 580 L 423 635 L 0 635 Z"
)

NECK_PATH = (
    "M 116 470 C 140 490 172 496 202 488 C 224 482 240 468 248 448 "
    "C 258 460 268 484 271 512 C 274 542 270 568 260 588 "
    "C 220 606 172 604 132 588 C 122 552 116 512 116 470 Z"
)

DEFS = (DEFS.replace("__FACE__", FACE_PATH)
            .replace("__TURBAN__", TURBAN_PATH)
            .replace("__DRESS__", DRESS_PATH)
            .replace("__NECK__", NECK_PATH))

# ==========================================================================
# 1 - canvas
# ==========================================================================
A(f'<rect width="{W}" height="{H}" fill="url(#gBg)"/>')

# ==========================================================================
# 2 - depth behind the crown
# ==========================================================================
A('<g filter="url(#fSoft8)" opacity=".40">'
  '<path d="M 60 210 C 74 130 128 56 200 32 C 278 6 352 46 384 112 '
  'C 408 164 402 226 368 264 C 320 316 232 322 164 294 C 106 270 66 248 60 210 Z" '
  'fill="#2c1322"/></g>')

# ==========================================================================
# 3 - back layer of fruit
# ==========================================================================
A('<g id="fruit-back">')

# broad dark leaves at the far left
A(leaf(56, 104, -10, 44, 16, "#3c471a", veins=6))
A(leaf(60, 118, -8, 92, 14, "#54621f", veins=5))
A(leaf(70, 122, 26, 96, 10, "#6d7b2b", veins=4))

# red apple, cropped by the top edge
A('<ellipse cx="163" cy="38" rx="47" ry="46" fill="url(#gAppleRed)"/>')
A('<path d="M 130 62 C 148 44 178 36 200 44" stroke="#f08a96" stroke-width="7" '
  'fill="none" opacity=".18" filter="url(#fSoft1)"/>')
A('<ellipse cx="146" cy="16" rx="17" ry="11" fill="#ffb0ba" opacity=".3" filter="url(#fSoft2)"/>')
A('<ellipse cx="196" cy="70" rx="16" ry="12" fill="#4a0714" opacity=".35" filter="url(#fSoft)"/>')
A(stem(160, 6, 169, -8, 4.4))

# yellow plantain rising out of frame
A('<path d="M 206 100 C 202 62 210 26 224 0 L 262 0 C 248 30 242 66 246 102 '
  'C 236 108 216 108 206 100 Z" fill="url(#gLemon)"/>')
A('<path d="M 216 92 C 214 60 220 28 232 4 L 241 4 C 231 30 227 62 229 94 Z" '
  'fill="#feffdd" opacity=".55"/>')
A('<path d="M 238 96 C 236 66 240 34 250 4" stroke="#b99a12" stroke-width="1.6" '
  'fill="none" opacity=".4"/>')
A('<path d="M 244 98 C 250 64 256 32 268 6" stroke="#c2a417" stroke-width="2.4" '
  'fill="none" opacity=".45"/>')

# dark foliage behind the grapes, upper right
A(leaf(240, 112, 306, 60, 17, "#4b5120", veins=6))
A(leaf(262, 120, 326, 86, 14, "#686a2b", veins=5))
A(leaf(214, 122, 268, 80, 12, "#3b4118", veins=5))

# maroon mass and yellow pear, top right
A('<ellipse cx="358" cy="112" rx="46" ry="34" fill="url(#gMaroon)"/>')
A('<path d="M 330 128 C 336 96 356 68 382 56 C 404 46 414 60 408 82 '
  'C 400 110 378 132 352 140 C 336 144 328 138 330 128 Z" fill="url(#gPear)"/>')
A('<ellipse cx="366" cy="80" rx="19" ry="10" fill="#fdfbd6" opacity=".5" '
  'transform="rotate(-28 366 80)" filter="url(#fSoft1)"/>')
A('<path d="M 344 132 C 360 126 376 112 388 96" stroke="#9aa432" stroke-width="1.6" '
  'fill="none" opacity=".45"/>')
A(stem(392, 52, 401, 38, 3.4, "#6a5a24"))

# pale green grapes (right)
A(cluster(316, 102, 34, 26, 8, 10, 14, "gGrapePale"))
A('</g>')

# ==========================================================================
# 4 - middle layer
# ==========================================================================
A('<g id="fruit-mid">')

# green-gold apple, upper left
A('<ellipse cx="100" cy="78" rx="43" ry="42" fill="url(#gAppleGreen)"/>')
A('<ellipse cx="82" cy="55" rx="18" ry="12" fill="#fdffd6" opacity=".6" filter="url(#fSoft2)"/>')
A('<ellipse cx="122" cy="108" rx="19" ry="12" fill="#40540f" opacity=".3" filter="url(#fSoft)"/>')
A(speckle(100, 78, 41, 39, 46, "#f6fbc0"))
A(stem(100, 37, 107, 20, 4))

# red-purple cluster tucked behind the main grapes
A(cluster(276, 112, 42, 26, 16, 8, 12, "gMaroon"))

# dark red apple, lower left, with pale leaves
A('<ellipse cx="73" cy="146" rx="37" ry="35" fill="url(#gAppleRed)"/>')
A('<ellipse cx="57" cy="129" rx="14" ry="9" fill="#ffb2ba" opacity=".32" filter="url(#fSoft2)"/>')
A('<ellipse cx="88" cy="166" rx="16" ry="10" fill="#4a0714" opacity=".35" filter="url(#fSoft)"/>')
A(leaf(46, 172, 102, 154, 11, "#bcc77e", veins=5, opacity=.95))
A(leaf(34, 160, 8, 186, 10, "#d0da9e", veins=4, opacity=.92))

# small peach with a red blush
A('<ellipse cx="143" cy="127" rx="18" ry="17" fill="url(#gPeach)"/>')
A('<ellipse cx="136" cy="119" rx="6.5" ry="4.5" fill="#fff6d8" opacity=".65" filter="url(#fSoft1)"/>')
A(stem(146, 111, 150, 102, 2.4))

# small lime-green fruit and two small yellow fruits
A('<ellipse cx="187" cy="133" rx="13" ry="12.5" fill="url(#gPear)"/>')
A('<ellipse cx="183" cy="128" rx="4.6" ry="3.4" fill="#fffff2" opacity=".7" filter="url(#fSoft1)"/>')
A('<ellipse cx="123" cy="163" rx="15" ry="14" fill="url(#gApplePale)"/>')
A('<ellipse cx="118" cy="157" rx="5.6" ry="4" fill="#fffff2" opacity=".65" filter="url(#fSoft1)"/>')
A('<ellipse cx="137" cy="190" rx="14" ry="13.5" fill="url(#gPeach)"/>')
A('<ellipse cx="132" cy="184" rx="5" ry="3.6" fill="#fff3d0" opacity=".65" filter="url(#fSoft1)"/>')

# big green lime at the right
A('<ellipse cx="383" cy="213" rx="40" ry="40" fill="url(#gLime)"/>')
A(speckle(383, 213, 38, 38, 90, "#e9f3ac", "clipLime"))
A('<ellipse cx="366" cy="191" rx="16" ry="10" fill="#f0fcb6" opacity=".45" '
  'transform="rotate(-30 366 191)" filter="url(#fSoft2)"/>')
A('<ellipse cx="399" cy="239" rx="17" ry="12" fill="#0f1e08" opacity=".38" filter="url(#fSoft)"/>')

# bright yellow quince
A('<path d="M 296 168 C 302 150 318 142 336 144 C 356 146 364 162 360 180 '
  'C 356 198 342 210 324 210 C 306 210 292 198 292 184 C 292 176 293 172 296 168 Z" '
  'fill="url(#gLemon)"/>')
A('<ellipse cx="310" cy="162" rx="13" ry="8" fill="#ffffe8" opacity=".65" '
  'transform="rotate(-22 310 162)" filter="url(#fSoft1)"/>')
A('<ellipse cx="340" cy="196" rx="12" ry="8" fill="#a8860f" opacity=".22" filter="url(#fSoft)"/>')

# yellow round fruit in front of the quince
A('<ellipse cx="272" cy="208" rx="29" ry="28" fill="url(#gLemon)"/>')
A('<ellipse cx="261" cy="195" rx="12" ry="8" fill="#ffffec" opacity=".65" filter="url(#fSoft1)"/>')
A('<ellipse cx="287" cy="224" rx="13" ry="9" fill="#a8860f" opacity=".25" filter="url(#fSoft)"/>')
A('</g>')

# ==========================================================================
# 5 - main grape cluster
# ==========================================================================
A('<g id="grapes">')
A(cluster(212, 166, 86, 46, 48, 8.5, 11.5, "gGrapeDark"))
A('</g>')

# ==========================================================================
# 6 - front fruits
# ==========================================================================
A('<g id="fruit-front">')

# red apple with a bright ring reflection
A('<ellipse cx="322" cy="225" rx="25" ry="24" fill="url(#gCherry)"/>')
A('<ellipse cx="320" cy="223" rx="9" ry="8" fill="none" stroke="#f8ef7e" stroke-width="2.6" opacity=".85"/>')
A('<ellipse cx="320" cy="222" rx="4" ry="3.6" fill="#fffcd6" opacity=".9"/>')
A('<ellipse cx="311" cy="212" rx="6" ry="4" fill="#ffe0e3" opacity=".5" filter="url(#fSoft1)"/>')

# pale green apple
A('<ellipse cx="308" cy="268" rx="28" ry="26" fill="url(#gApplePale)"/>')
A('<ellipse cx="295" cy="254" rx="12" ry="8" fill="#fffffa" opacity=".72" '
  'transform="rotate(-25 295 254)" filter="url(#fSoft1)"/>')
A('<ellipse cx="309" cy="278" rx="7" ry="5" fill="#7d8722" opacity=".45" filter="url(#fSoft1)"/>')
A(speckle(308, 268, 26, 24, 30, "#fcfcd8"))
A(stem(306, 244, 303, 236, 2.6, "#6f6a22"))

# pale pear, lower right
A('<path d="M 350 254 C 366 252 380 262 382 274 C 384 288 372 297 358 297 '
  'C 344 297 334 290 334 278 C 334 264 340 255 350 254 Z" fill="url(#gPear)"/>')
A('<ellipse cx="351" cy="265" rx="10" ry="6" fill="#fffff8" opacity=".7" filter="url(#fSoft1)"/>')
A(speckle(362, 276, 21, 18, 24, "#fdfddc", "clipPear"))
A(stem(379, 269, 388, 264, 2.4, "#6f6a22"))

# small yellow fruit
A('<ellipse cx="339" cy="292" rx="19" ry="18" fill="url(#gLemon)"/>')
A('<ellipse cx="331" cy="283" rx="7" ry="5" fill="#fffdea" opacity=".65" filter="url(#fSoft1)"/>')

# dark red-brown fruit cropped at the right edge
A('<ellipse cx="405" cy="302" rx="26" ry="25" fill="url(#gMaroon)"/>')
A('<ellipse cx="395" cy="289" rx="9" ry="6" fill="#ad5f6c" opacity=".45" filter="url(#fSoft2)"/>')
A('</g>')

# shadow the crown casts on the fabric
A('<g filter="url(#fSoft8)" opacity=".55">'
  '<path d="M 80 250 C 140 228 214 224 268 244 C 286 252 280 276 256 280 '
  'C 206 288 128 282 92 264 C 76 256 70 254 80 250 Z" fill="#180d20"/></g>')

# ==========================================================================
# 7 - turban behind the head
# ==========================================================================
A(f'<path d="{TURBAN_PATH}" fill="url(#gTurbanBack)"/>')

# ==========================================================================
# 8 - face
# ==========================================================================
A(f'<path d="{FACE_PATH}" fill="url(#gSkin)"/>')
A('<g clip-path="url(#clipFace)">')
A('<g filter="url(#fSoft)">'
  '<ellipse cx="232" cy="380" rx="30" ry="62" fill="#b98459" opacity=".45"/>'
  '<ellipse cx="62" cy="380" rx="16" ry="58" fill="#c49167" opacity=".35"/>'
  '<ellipse cx="196" cy="462" rx="34" ry="24" fill="#b07d52" opacity=".38"/>'
  '<ellipse cx="92" cy="470" rx="24" ry="20" fill="#b07d52" opacity=".28"/>'
  '<ellipse cx="120" cy="330" rx="50" ry="14" fill="#c69064" opacity=".26"/>'
  '<ellipse cx="176" cy="350" rx="26" ry="14" fill="#c69064" opacity=".24"/>'
  '<ellipse cx="150" cy="472" rx="16" ry="10" fill="#b68155" opacity=".32"/>'
  '</g>')
A('<g filter="url(#fSoft)">'
  '<ellipse cx="120" cy="324" rx="44" ry="16" fill="#fbe3c6" opacity=".55"/>'
  '<ellipse cx="80" cy="398" rx="22" ry="15" fill="#fbe3c6" opacity=".5" '
  'transform="rotate(-12 80 398)"/>'
  '<ellipse cx="188" cy="386" rx="30" ry="30" fill="#fae0c2" opacity=".62"/>'
  '<ellipse cx="120" cy="486" rx="20" ry="9" fill="#fbe0c2" opacity=".5"/>'
  '<ellipse cx="104" cy="348" rx="7" ry="20" fill="#fce6cc" opacity=".45"/>'
  '</g>')
A('<rect x="40" y="270" width="220" height="245" filter="url(#fGrain)" opacity=".05"/>')
A('</g>')

# ==========================================================================
# 9 - hair wedge between the fabric and the cheek
# ==========================================================================
A('<g id="hair">')
A('<path d="M 158 258 C 176 268 196 284 210 302 C 226 322 240 346 246 372 '
  'C 250 392 248 410 244 424 C 230 414 220 400 212 386 '
  'C 200 366 186 344 172 326 C 163 314 156 300 154 286 C 152 274 152 264 158 258 Z" '
  'fill="url(#gHair)"/>')
A('<path d="M 240 344 C 246 362 246 382 242 400 C 250 386 252 366 248 348 Z" fill="#0e0805"/>')
A('<g stroke="#6b4a33" stroke-width=".7" opacity=".35" fill="none">'
  '<path d="M 170 274 C 184 288 196 304 206 322"/>'
  '<path d="M 180 282 C 194 296 206 314 216 334"/>'
  '<path d="M 196 296 C 210 312 222 332 230 352"/>'
  '</g>')
# small wisp at the left temple
A('<path d="M 56 254 C 62 250 70 250 76 252 C 68 256 62 264 58 274 C 55 266 55 258 56 254 Z" '
  'fill="#2a1a12" opacity=".9"/>')
A('</g>')

# ==========================================================================
# 10 - turban front edge, drawn over the hair
# ==========================================================================
A('<g id="turban-edge">')
# crown band
A('<path d="M 58 252 C 56 214 68 188 92 176 C 128 158 186 158 222 176 '
  'C 244 187 262 204 274 226 C 244 208 206 196 168 198 C 128 200 94 212 72 232 '
  'C 64 238 60 244 58 252 Z" fill="url(#gTurbanBand)"/>')
A('<path d="M 62 246 C 62 210 74 188 96 178 C 130 162 184 162 218 180 '
  'C 238 190 254 205 266 224" stroke="#c8b6ee" stroke-width="2.2" fill="none" opacity=".5"/>')
A('<path d="M 70 236 C 96 214 132 202 170 200 C 208 198 244 208 272 226" '
  'stroke="#2a1a4c" stroke-width="3" fill="none" opacity=".45"/>')

# knot at the top left
A('<path d="M 74 222 C 84 202 106 188 130 182 C 142 179 148 188 138 196 '
  'C 120 208 102 222 90 240 C 80 252 68 238 74 222 Z" fill="#6b4fa6"/>')
A('<path d="M 78 220 C 90 202 110 190 130 184" stroke="#cdbcf2" stroke-width="1.8" '
  'fill="none" opacity=".6"/>')

# right lobe of the wrap, over the temple/hair
A('<path d="M 238 186 C 268 202 288 228 293 264 C 298 302 294 338 282 366 '
  'C 274 386 262 402 248 412 C 240 416 234 412 231 405 '
  'C 246 392 254 372 256 348 C 258 322 250 300 236 284 '
  'C 228 268 228 224 232 198 Z" fill="url(#gTurbanRight)"/>')

# folds on the right lobe
A('<g stroke="#1d0f36" fill="none" opacity=".45" stroke-linecap="round">'
  '<path d="M 240 200 C 258 218 268 240 270 264" stroke-width="2.4"/>'
  '<path d="M 244 224 C 262 242 274 264 276 288" stroke-width="2"/>'
  '<path d="M 246 250 C 266 268 278 292 278 316" stroke-width="2.2"/>'
  '<path d="M 240 282 C 260 300 272 324 272 348" stroke-width="2"/>'
  '<path d="M 234 316 C 252 332 264 354 264 376" stroke-width="1.8"/>'
  '<path d="M 96 210 C 122 196 152 190 182 192" stroke-width="2"/>'
  '<path d="M 78 228 C 104 210 138 200 172 200" stroke-width="1.8"/>'
  '</g>')
A('<g stroke="#c6b3ec" fill="none" opacity=".3" stroke-linecap="round">'
  '<path d="M 242 206 C 258 224 266 244 268 266" stroke-width="1.2"/>'
  '<path d="M 244 232 C 260 250 270 270 272 292" stroke-width="1.1"/>'
  '<path d="M 100 206 C 124 194 152 188 180 190" stroke-width="1.1"/>'
  '</g>')
A('<path d="M 240 192 C 266 208 284 232 289 262 C 277 232 260 212 234 200 Z" '
  'fill="#b7a2e2" opacity=".22" filter="url(#fSoft)"/>')

# hem highlight where the fabric meets the forehead
A('<path d="M 60 252 C 66 260 76 264 92 266 C 120 268 150 262 176 260" fill="none" '
  'stroke="#2a1a4c" stroke-width="3.4" opacity=".30" filter="url(#fSoft1)"/>')
A('<path d="M 62 248 C 74 254 90 256 108 254" fill="none" stroke="#b49ce0" '
  'stroke-width="1.6" opacity=".5"/>')
A('<rect x="50" y="170" width="250" height="120" filter="url(#fWeave)" opacity=".09"/>')
A('</g>')

# ==========================================================================
# 11 - features
# ==========================================================================
A('<g stroke="#2b1a11" fill="none" stroke-linecap="round">'
  '<path d="M 50 336 C 60 324 76 318 90 321 C 94 322 97 324 99 326" stroke-width="3" opacity=".9"/>'
  '<path d="M 124 322 C 136 313 152 309 166 313 C 170 314 173 316 175 319" stroke-width="3" opacity=".9"/>'
  '</g>')
A('<g stroke="#573a26" stroke-width=".75" opacity=".45" fill="none">'
  '<path d="M 52 334 C 62 325 76 319 88 320"/>'
  '<path d="M 56 331 C 66 323 78 318 90 319"/>'
  '<path d="M 127 319 C 138 312 150 308 163 311"/>'
  '<path d="M 130 316 C 141 310 153 307 165 309"/>'
  '</g>')


def eye(cx, cy, w, h, tilt, lash_len, lash_n, open_amt=1.0):
    s = [f'<g transform="rotate({tilt} {n(cx)} {n(cy)})">']
    s.append(f'<ellipse cx="{n(cx)}" cy="{n(cy)}" rx="{n(w*.70)}" ry="{n(h*1.30)}" '
             f'fill="#a5703f" opacity=".30" filter="url(#fSoft2)"/>')
    s.append(f'<path d="M {n(cx-w*.56)} {n(cy-1)} Q {n(cx-w*.08)} {n(cy-h*1.95)} {n(cx+w*.54)} {n(cy-4)} '
             f'Q {n(cx+w*.08)} {n(cy-h*.55)} {n(cx-w*.56)} {n(cy-1)} Z" fill="#a5734e" opacity=".40" '
             f'filter="url(#fSoft1)"/>')
    s.append(f'<path d="M {n(cx-w*.5)} {n(cy)} Q {n(cx)} {n(cy-h*1.02*open_amt)} {n(cx+w*.5)} {n(cy-h*.12)} '
             f'Q {n(cx)} {n(cy+h*.88)} {n(cx-w*.5)} {n(cy)} Z" fill="#fdf8f2"/>')
    irx = h * .72
    s.append(f'<circle cx="{n(cx)}" cy="{n(cy-h*.05)}" r="{n(irx)}" fill="url(#gIris)"/>')
    for i in range(10):
        a = math.tau * i / 10 + .25
        s.append(f'<line x1="{n(cx+math.cos(a)*irx*.42)}" y1="{n(cy-h*.05+math.sin(a)*irx*.42)}" '
                 f'x2="{n(cx+math.cos(a)*irx*.88)}" y2="{n(cy-h*.05+math.sin(a)*irx*.88)}" '
                 f'stroke="#cdb489" stroke-width=".6" opacity=".35"/>')
    s.append(f'<circle cx="{n(cx)}" cy="{n(cy-h*.05)}" r="{n(irx)}" fill="none" '
             f'stroke="#251a0d" stroke-width="{n(h*.10)}" opacity=".5"/>')
    s.append(f'<circle cx="{n(cx)}" cy="{n(cy-h*.05)}" r="{n(irx*.42)}" fill="#160e05"/>')
    s.append(f'<circle cx="{n(cx-irx*.34)}" cy="{n(cy-h*.05-irx*.36)}" r="{n(irx*.23)}" '
             f'fill="#ffffff" opacity=".95"/>')
    s.append(f'<circle cx="{n(cx+irx*.30)}" cy="{n(cy-h*.05+irx*.28)}" r="{n(irx*.10)}" '
             f'fill="#ffffff" opacity=".5"/>')
    s.append(f'<path d="M {n(cx-w*.52)} {n(cy+1)} Q {n(cx)} {n(cy-h*1.10*open_amt)} '
             f'{n(cx+w*.52)} {n(cy-h*.10)}" fill="none" stroke="#170c07" '
             f'stroke-width="{n(2.2+open_amt)}" stroke-linecap="round"/>')
    s.append(f'<path d="M {n(cx-w*.46)} {n(cy+1.6)} Q {n(cx)} {n(cy+h*.80)} '
             f'{n(cx+w*.46)} {n(cy-h*.04)}" fill="none" stroke="#331d11" '
             f'stroke-width="1.2" opacity=".7"/>')
    s.append(f'<path d="M {n(cx-w*.3)} {n(cy+h*.30)} Q {n(cx)} {n(cy+h*.52)} '
             f'{n(cx+w*.26)} {n(cy+h*.22)}" fill="none" stroke="#fff6ea" '
             f'stroke-width="1.5" opacity=".55"/>')
    s.append(f'<path d="M {n(cx-w*.5)} {n(cy-h*.62)} Q {n(cx)} {n(cy-h*1.55)} '
             f'{n(cx+w*.5)} {n(cy-h*.60)}" fill="none" stroke="#a2734c" '
             f'stroke-width="1.4" opacity=".45"/>')
    for i in range(lash_n):
        t = i / (lash_n - 1)
        bx = cx - w * .46 + w * .90 * t
        by = cy - h * .90 * math.sin(math.pi * (.1 + .78 * t)) - 1
        L = lash_len * (.45 + .85 * math.sin(math.pi * (.2 + .66 * t)))
        ex = bx + L * (.8 + .45 * t)
        ey = by - L * (.85 - .3 * t)
        s.append(f'<path d="M {n(bx)} {n(by)} Q {n(bx + L*.45)} {n(by - L*.7)} '
                 f'{n(ex)} {n(ey)}" fill="none" stroke="#140a05" '
                 f'stroke-width="{n(1.25 - .40*t)}" stroke-linecap="round" opacity=".85"/>')
    for i in range(4):
        t = i / 3
        bx = cx - w * .24 + w * .62 * t
        by = cy + h * .52 * math.sin(math.pi * (.3 + .5 * t))
        s.append(f'<path d="M {n(bx)} {n(by)} Q {n(bx + 1.6)} {n(by + 2.6)} '
                 f'{n(bx + 2.8)} {n(by + 4.4)}" fill="none" stroke="#20120a" '
                 f'stroke-width=".8" stroke-linecap="round" opacity=".6"/>')
    s.append('</g>')
    return "".join(s)


A(eye(74, 347, 32, 12, -3, 8, 11, .92))
A(eye(146, 342, 38, 14, -4, 9, 13, 1.0))

# nose
A('<path d="M 106 348 C 102 368 98 386 94 399" stroke="#c08a5c" stroke-width="1.7" '
  'fill="none" opacity=".38"/>')
A('<path d="M 88 401 C 88 408 92 413 99 414 C 106 415 112 411 114 405" '
  'fill="none" stroke="#b07a4e" stroke-width="2.1" opacity=".48"/>')
A('<ellipse cx="96" cy="400" rx="9" ry="6" fill="#fde5c9" opacity=".7" filter="url(#fSoft1)"/>')
A('<ellipse cx="86" cy="409" rx="4" ry="2.9" fill="#7d4f2c" opacity=".75" transform="rotate(-18 86 409)"/>')
A('<ellipse cx="108" cy="408" rx="3.8" ry="2.7" fill="#8d5c35" opacity=".7" transform="rotate(12 108 408)"/>')
A('<path d="M 78 411 C 82 417 90 421 98 420" stroke="#a3703f" stroke-width="1.4" fill="none" opacity=".35"/>')
A('<path d="M 104 401 C 108 398 112 397 116 398" stroke="#b9825a" stroke-width="1.2" fill="none" opacity=".35"/>')

# mouth
A('<ellipse cx="116" cy="450" rx="34" ry="18" fill="#b57a58" opacity=".18" filter="url(#fSoft2)"/>')
A('<path d="M 110 428 C 108 432 106 434 104 436" stroke="#c08a5c" stroke-width="1.4" fill="none" opacity=".35"/>')
A('<path d="M 124 428 C 126 432 128 434 130 436" stroke="#c08a5c" stroke-width="1.4" fill="none" opacity=".35"/>')
A('<path d="M 86 442 C 98 435 130 432 146 438 C 138 451 106 455 86 442 Z" fill="#4a0a18"/>')
A('<path d="M 84 442 C 92 431 100 428 108 432 C 114 435 118 432 124 431 '
  'C 134 430 144 433 150 438 C 138 436 96 436 84 442 Z" fill="url(#gLips)"/>')
A('<path d="M 86 443 C 98 439 140 437 150 439 C 146 454 128 462 112 461 '
  'C 98 460 88 452 86 443 Z" fill="url(#gLips)"/>')
A('<path d="M 88 443 C 104 440 136 439 148 440" stroke="#6d0c25" stroke-width="1.2" '
  'fill="none" opacity=".65"/>')
A('<ellipse cx="112" cy="450" rx="12" ry="3.2" fill="#ff9fb2" opacity=".45" filter="url(#fSoft1)"/>')
A('<ellipse cx="104" cy="448" rx="5" ry="1.6" fill="#ffe6ea" opacity=".65"/>')
A('<ellipse cx="130" cy="434" rx="6.5" ry="1.6" fill="#f8a9b7" opacity=".35" filter="url(#fSoft1)"/>')
A('<ellipse cx="84" cy="441" rx="3.4" ry="2.4" fill="#6d0c25" opacity=".45" filter="url(#fSoft1)"/>')
A('<ellipse cx="150" cy="439" rx="3.4" ry="2.4" fill="#6d0c25" opacity=".4" filter="url(#fSoft1)"/>')

# ear
A('<path d="M 236 396 C 246 392 254 400 254 412 C 254 424 248 434 238 436 '
  'C 230 438 226 430 228 420 C 230 408 230 400 236 396 Z" fill="#e3b48e"/>')
A('<path d="M 238 402 C 244 402 248 408 247 414 C 246 420 242 424 237 424" '
  'stroke="#b98a60" stroke-width="1.6" fill="none" opacity=".6"/>')

# ==========================================================================
# 12 - neck
# ==========================================================================
A(f'<path d="{NECK_PATH}" fill="url(#gNeck)"/>')
A('<g clip-path="url(#clipNeck)">')
A('<path d="M 112 464 C 140 490 178 498 208 486 C 228 478 242 464 248 446 '
  'C 246 472 238 492 220 504 C 196 520 156 518 124 502 Z" '
  'fill="#95603a" opacity=".5" filter="url(#fSoft2)"/>')
A('<path d="M 198 500 C 216 524 230 552 238 582" stroke="#a06c44" stroke-width="7" '
  'fill="none" opacity=".3" filter="url(#fSoft2)"/>')
A('<path d="M 150 512 C 158 538 160 564 156 590" stroke="#b07d51" stroke-width="4" '
  'fill="none" opacity=".2" filter="url(#fSoft2)"/>')
A('<ellipse cx="176" cy="536" rx="26" ry="34" fill="#f8d2ab" opacity=".35" filter="url(#fSoft)"/>')
A('<ellipse cx="128" cy="540" rx="11" ry="40" fill="#95633d" opacity=".28" filter="url(#fSoft)"/>')
A('<path d="M 146 588 C 186 600 230 600 260 588" stroke="#c48f63" stroke-width="3" '
  'fill="none" opacity=".3" filter="url(#fSoft1)"/>')
A('</g>')

# ==========================================================================
# 13 - earring
# ==========================================================================
A('<g id="earring">')
A('<ellipse cx="242" cy="418" rx="4" ry="5" fill="url(#gGold)"/>')
A('<circle cx="254" cy="434" r="13" fill="none" stroke="url(#gGold)" stroke-width="4.6"/>')
A('<circle cx="242" cy="448" r="9" fill="none" stroke="url(#gGold)" stroke-width="4"/>')
A('<circle cx="254" cy="434" r="13" fill="none" stroke="#fffbe4" stroke-width="1" opacity=".6"/>')
A('<circle cx="257" cy="429" r="4.2" fill="url(#gPearl)"/>')
A('<circle cx="245" cy="443" r="2.9" fill="url(#gPearl)"/>')
A('<circle cx="236" cy="455" r="2.1" fill="url(#gPearl)"/>')
A('<circle cx="251" cy="428" r="1.6" fill="#fffdf4" opacity=".95"/>')
A('</g>')

# ==========================================================================
# 14 - dress
# ==========================================================================
A(f'<path d="{DRESS_PATH}" fill="url(#gDress)"/>')
A('<g clip-path="url(#clipDress)">')
A('<rect x="0" y="540" width="423" height="95" fill="url(#pRosette)" opacity=".9"/>')
A('<rect x="0" y="540" width="423" height="95" fill="url(#pDaisy)" opacity=".85"/>')
A('<g filter="url(#fSoft)" opacity=".5">'
  '<path d="M 0 614 C 60 600 122 608 178 624 L 178 635 L 0 635 Z" fill="#b6a98e"/>'
  '<ellipse cx="332" cy="622" rx="72" ry="24" fill="#cdc0a4" opacity=".55"/>'
  '</g>')
A('<path d="M 250 592 C 292 570 342 564 392 574" stroke="#fffdf0" stroke-width="3.5" '
  'fill="none" opacity=".8" filter="url(#fSoft1)"/>')
A('<rect x="0" y="540" width="423" height="95" filter="url(#fWeave)" opacity=".08"/>')
A('</g>')

# ==========================================================================
# 15 - necklace
# ==========================================================================
A('<g id="necklace">')
strand = [(140, 556), (152, 570), (166, 582), (182, 592), (200, 600), (218, 606),
          (238, 610), (258, 610), (278, 606), (296, 600), (312, 592), (326, 582)]
d = "M " + " L ".join(f"{x} {y}" for x, y in strand)
A(f'<path d="{d}" fill="none" stroke="#3b2f22" stroke-width="2" opacity=".5"/>')
beads = ["#1b2c4a", "#dcd6c8", "#8d1b2a", "#1b1b22", "#c8a558", "#2c4a6e",
         "#e8e2d2", "#6d1b2a"]
for i, (x, y) in enumerate(strand):
    r = 4.6 - (i % 3) * .55
    A(f'<circle cx="{x}" cy="{y}" r="{n(r)}" fill="{beads[i % len(beads)]}"/>')
    A(f'<circle cx="{n(x-r*.35)}" cy="{n(y-r*.35)}" r="{n(r*.33)}" fill="#ffffff" opacity=".55"/>')
    if i % 2 == 0:
        A(f'<circle cx="{x+2}" cy="{y+7}" r="2" fill="#d9d2c0" opacity=".75"/>')
A('<path d="M 150 574 C 186 606 250 620 316 600" fill="none" stroke="#b9a875" '
  'stroke-width=".9" opacity=".5" stroke-dasharray="2 3"/>')
A('</g>')

# ==========================================================================
# 16 - hand
# ==========================================================================
def nail(cx, cy, w, h, rot):
    return (
        f'<g transform="rotate({rot} {cx} {cy})">'
        f'<path d="M {n(cx-w/2)} {n(cy+h*0.30)} C {n(cx-w/2)} {n(cy-h*0.62)} '
        f'{n(cx+w/2)} {n(cy-h*0.62)} {n(cx+w/2)} {n(cy+h*0.30)} '
        f'C {n(cx+w/2)} {n(cy+h*0.70)} {n(cx-w/2)} {n(cy+h*0.70)} '
        f'{n(cx-w/2)} {n(cy+h*0.30)} Z" fill="url(#gNail)"/>'
        f'<path d="M {n(cx-w*0.26)} {n(cy-h*0.30)} C {n(cx-w*0.32)} {n(cy+h*0.02)} '
        f'{n(cx-w*0.10)} {n(cy+h*0.34)} {n(cx+w*0.04)} {n(cy+h*0.38)}" '
        f'stroke="#ffdde1" stroke-width="{n(w*0.14)}" fill="none" opacity=".6"/>'
        f'<path d="M {n(cx-w/2)} {n(cy+h*0.14)} C {n(cx-w*0.2)} {n(cy-h*0.48)} '
        f'{n(cx+w*0.3)} {n(cy-h*0.48)} {n(cx+w/2)} {n(cy+h*0.10)}" '
        f'stroke="#6d0512" stroke-width=".9" fill="none" opacity=".45"/>'
        f'</g>'
    )


def finger(kx, ky, tx, ty, w0, w1, fill="url(#gHand)", shade="#d3a483"):
    """Long tapered finger, knuckle (kx,ky) -> tip (tx,ty), with edge shading."""
    dx, dy = tx - kx, ty - ky
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    nx, ny = -uy, ux
    body = (f'<path d="M {n(kx+nx*w0)} {n(ky+ny*w0)} '
            f'Q {n(kx+ux*L*.55+nx*w0*.92)} {n(ky+uy*L*.55+ny*w0*.92)} {n(tx+nx*w1)} {n(ty+ny*w1)} '
            f'Q {n(tx+ux*w1*1.1)} {n(ty+uy*w1*1.1)} {n(tx-nx*w1)} {n(ty-ny*w1)} '
            f'Q {n(tx+ux*w1*.4)} {n(ty+uy*w1*.4)} {n(tx-nx*w1*1.0)} {n(ty-ny*w1*1.0)} '
            f'L {n(kx-nx*w0)} {n(ky-ny*w0)} Z" fill="{fill}"/>')
    edge = (f'<path d="M {n(kx+nx*w0*.92)} {n(ky+ny*w0*.92)} '
            f'Q {n(kx+ux*L*.55+nx*w0*.85)} {n(ky+uy*L*.55+ny*w0*.85)} '
            f'{n(tx+nx*w1*.85)} {n(ty+ny*w1*.85)}" stroke="{shade}" '
            f'stroke-width="1.3" fill="none" opacity=".5"/>')
    return body + edge


A('<g id="hand">')
A('<g filter="url(#fSoft)" opacity=".25">'
  '<path d="M 0 566 C 28 540 62 526 96 532 C 130 538 156 560 172 592 '
  'C 182 614 180 628 172 635 L 0 635 Z" fill="#7d6a4e"/></g>')
# hand mass first, then the fingers over it so they read separately
A('<path d="M 4 596 C 34 570 78 558 114 572 C 142 584 160 608 162 635 '
  'L 4 635 C -2 620 -2 608 4 596 Z" fill="url(#gHand)"/>')
A(finger(8, 610, 12, 524, 9, 7.6))       # thumb
A(finger(150, 636, 160, 574, 9.5, 7))    # little finger
A(finger(122, 636, 118, 574, 9.5, 7.2))  # ring
A(finger(94, 634, 88, 562, 10, 7.6))     # middle
A(finger(66, 630, 56, 548, 10, 7.6))     # index
# gap shadows between the fingers
A('<g stroke="#c9a07e" stroke-width="2.2" fill="none" opacity=".45" stroke-linecap="round">'
  '<path d="M 76 618 L 74 592"/>'
  '<path d="M 106 622 L 104 596"/>'
  '<path d="M 132 626 L 136 600"/>'
  '</g>')
# back-of-hand shading
A('<path d="M 12 604 C 44 584 84 576 112 590" stroke="#c69b78" stroke-width="3.4" '
  'fill="none" opacity=".35" filter="url(#fSoft1)"/>')
A('<path d="M 96 600 C 118 608 134 620 142 632" stroke="#c69b78" stroke-width="2.4" '
  'fill="none" opacity=".3" filter="url(#fSoft1)"/>')
# knuckle creases
A('<g stroke="#c99f7c" stroke-width="1.2" fill="none" opacity=".45">'
  '<path d="M 84 578 C 90 576 96 578 99 581"/>'
  '<path d="M 114 580 C 120 578 126 580 129 583"/>'
  '<path d="M 142 584 C 147 583 151 585 153 588"/>'
  '<path d="M 56 574 C 61 572 66 574 68 577"/>'
  '</g>')
A(nail(12, 520, 11, 19, -14))
A(nail(56, 544, 12, 21, -10))
A(nail(88, 558, 12.5, 22, -3))
A(nail(118, 570, 12.5, 22, 4))
A(nail(160, 570, 11.5, 20, 9))
A('</g>')

# ==========================================================================
# 17 - finish
# ==========================================================================
A('<rect width="423" height="635" filter="url(#fGrain)" opacity=".05"/>')
A(f'<rect width="423" height="635" fill="url(#gVignette)"/>')

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
       f'width="{W}" height="{H}">\n'
       '<title>Portrait with a fruit headdress — detailed vector rendering</title>\n'
       '<desc>Detailed stylised vector rendition of 01test_image-vision-model.jpeg: a woman in a '
       'violet wrapped turban crowned with apples, grapes, a pear, a lime and a lemon, in '
       'three-quarter view, with gold filigree earrings, a beaded necklace, an embroidered ivory '
       'top and a raised hand with scarlet nails, against a bright studio background.</desc>\n'
       + DEFS + "\n" + "\n".join(OUT) + "\n</svg>\n")

out_path = sys.argv[1] if len(sys.argv) > 1 else "/home/pmpmt/.pi/01test_image-vision-model.svg"
with open(out_path, "w", encoding="utf-8") as fh:
    fh.write(svg)
ET.parse(out_path)
print(f"wrote {out_path}  ({len(svg)/1024:.1f} KB, XML OK)")
