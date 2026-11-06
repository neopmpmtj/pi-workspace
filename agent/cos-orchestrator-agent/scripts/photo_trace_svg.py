#!/usr/bin/env python3
"""
Photo -> detailed SVG tracer (no external tools, pure Python + Pillow).

Pipeline:
  1. median-filter to kill JPEG speckle,
  2. median-cut colour quantisation to N colours (no dithering),
  3. per-colour boundary tracing on the pixel grid (edge segments with a
     consistent orientation, chained into closed loops),
  4. Douglas-Peucker simplification, holes kept as extra subpaths with
     fill-rule="evenodd",
  5. colours emitted largest-area-first so small details land on top.

Usage: python3 photo_trace_svg.py in.jpg out.svg [n_colors] [eps] [scale] [method] [chaikin]
"""
import math
import sys
from PIL import Image, ImageFilter

src = sys.argv[1]
dst = sys.argv[2]
NCOL = int(sys.argv[3]) if len(sys.argv) > 3 else 22
EPS = float(sys.argv[4]) if len(sys.argv) > 4 else 0.55
SCALE = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
METHOD = (sys.argv[6] if len(sys.argv) > 6 else "octree").lower()
CHAIKIN = int(sys.argv[7]) if len(sys.argv) > 7 else 1
BLUR = float(sys.argv[8]) if len(sys.argv) > 8 else 0.0
DISPW = int(sys.argv[9]) if len(sys.argv) > 9 else 0
MERGE = float(sys.argv[10]) if len(sys.argv) > 10 else 0.0

im = Image.open(src).convert("RGB")
if SCALE != 1.0:
    im = im.resize((int(im.width * SCALE), int(im.height * SCALE)), Image.LANCZOS)
if BLUR > 0:
    im = im.filter(ImageFilter.GaussianBlur(BLUR))
im = im.filter(ImageFilter.MedianFilter(3))
qmethod = Image.FASTOCTREE if METHOD.startswith("oct") else Image.MEDIANCUT
q = im.quantize(colors=NCOL, method=qmethod, dither=Image.NONE)
W, H = q.size
pal = q.getpalette()
idx = list(q.getdata())
print(f"{W}x{H}, {NCOL} colours requested ({METHOD})")

# --- merge near-identical palette entries (kills JPEG halo colours) ---------
if MERGE > 0:
    used = sorted(set(idx))
    cnt = {c: 0 for c in used}
    for v in idx:
        cnt[v] += 1
    rep = {c: c for c in used}
    by_count = sorted(used, key=lambda c: -cnt[c])
    for c in by_count:
        if rep[c] != c:
            continue
        r0, g0, b0 = pal[c * 3], pal[c * 3 + 1], pal[c * 3 + 2]
        for d in by_count:
            if d == c or rep[d] != d or cnt[d] > cnt[c]:
                continue
            r1, g1, b1 = pal[d * 3], pal[d * 3 + 1], pal[d * 3 + 2]
            if math.dist((r0, g0, b0), (r1, g1, b1)) < MERGE:
                rep[d] = c
    remap = {c: rep[rep[c]] for c in used}
    idx = [remap[v] for v in idx]
    print(f"  merged palette to {len(set(idx))} colours (threshold {MERGE})")


def rdp(pts, eps):
    """Douglas-Peucker on an open polyline."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        x1, y1 = pts[i]
        x2, y2 = pts[j]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy) or 1.0
        dmax, kbest = -1.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            d = abs(dy * (px - x1) - dx * (py - y1)) / norm
            if d > dmax:
                dmax, kbest = d, k
        if dmax > eps:
            keep[kbest] = True
            stack.append((i, kbest))
            stack.append((kbest, j))
    return [p for p, k in zip(pts, keep) if k]


def simplify_closed(loop, eps):
    """Split a closed loop in half and simplify each half."""
    if len(loop) < 4:
        return loop
    loop = loop[:-1] if loop[0] == loop[-1] else loop
    # anchor at the two most distant-ish points (first point + farthest)
    x0, y0 = loop[0]
    far, fi = -1, 1
    for k in range(1, len(loop)):
        d = (loop[k][0] - x0) ** 2 + (loop[k][1] - y0) ** 2
        if d > far:
            far, fi = d, k
    a = rdp(loop[:fi + 1], eps)
    b = rdp(loop[fi:] + [loop[0]], eps)
    return a[:-1] + b


def trace_colour(ci):
    """All closed loops bounding the pixels of colour index ci."""
    # boundary edges with the mask kept on the left (consistent orientation)
    out = {}
    for y in range(H):
        base = y * W
        for x in range(W):
            p = base + x
            if idx[p] != ci:
                continue
            # above
            if y == 0 or idx[p - W] != ci:
                out.setdefault((x, y), []).append((x + 1, y))
            # below
            if y == H - 1 or idx[p + W] != ci:
                out.setdefault((x + 1, y + 1), []).append((x, y + 1))
            # left
            if x == 0 or idx[p - 1] != ci:
                out.setdefault((x, y + 1), []).append((x, y))
            # right
            if x == W - 1 or idx[p + 1] != ci:
                out.setdefault((x + 1, y), []).append((x + 1, y + 1))
    loops = []
    for start in list(out.keys()):
        while out.get(start):
            loop = [start]
            cur = start
            guard = 0
            while True:
                nxt_list = out.get(cur)
                if not nxt_list:
                    break
                nxt = nxt_list.pop()
                cur = nxt
                guard += 1
                if cur == start or guard > 400000:
                    loop.append(cur)
                    break
                loop.append(cur)
            if len(loop) > 2:
                loops.append(loop)
    return loops


def chaikin(pts, iters=1):
    """Corner cutting: turns pixel staircases into smooth closed polylines."""
    for _ in range(iters):
        out = []
        m = len(pts)
        for i in range(m):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % m]
            out.append((0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1))
            out.append((0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1))
        pts = out
    return pts


def path_d(loops, eps):
    parts = []
    for loop in loops:
        s = simplify_closed(loop, eps)
        if 0 < CHAIKIN and len(s) > 3:
            if s[0] == s[-1]:
                s = s[:-1]
            s = chaikin(s, CHAIKIN)
        if len(s) < 3:
            continue
        if s[0] == s[-1]:
            s = s[:-1]
        if len(s) < 3:
            continue
        seg = [f"M{n(s[0][0])} {n(s[0][1])}"]
        for x, y in s[1:]:
            seg.append(f"L{n(x)} {n(y)}")
        seg.append("Z")
        parts.append("".join(seg))
    return "".join(parts)


def n(v):
    return f"{v:.1f}".replace(".0", "")


# colour population, used to order the layers
counts = [0] * NCOL
for v in idx:
    counts[v] += 1
order = sorted([c for c in range(NCOL) if counts[c]], key=lambda c: -counts[c])

layers = []
for c in order:
    loops = trace_colour(c)
    d = path_d(loops, EPS)
    if not d:
        continue
    r, g, b = pal[c * 3], pal[c * 3 + 1], pal[c * 3 + 2]
    layers.append((counts[c], f'<path fill="#{r:02x}{g:02x}{b:02x}" fill-rule="evenodd" d="{d}"/>'))
    print(f"  colour #{r:02x}{g:02x}{b:02x}: {len(loops)} loops, {counts[c]} px, {len(layers[-1][1])} B")

body = "\n".join(l[1] for l in layers)
dw = DISPW or W
dh = int(round(H * dw / W))
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{dw}" height="{dh}">\n'
       f'<title>{dst.split("/")[-1]}</title>\n'
       f'<desc>Vector trace of {src.split("/")[-1]}: {len(layers)} flat colour layers traced to '
       f'polygon paths, largest first, simplified to {EPS}px.</desc>\n'
       f'<rect width="{W}" height="{H}" fill="#ffffff"/>\n{body}\n</svg>\n')
open(dst, "w", encoding="utf-8").write(svg)
print(f"wrote {dst} ({len(svg)/1024:.0f} KB, {len(layers)} layers)")
