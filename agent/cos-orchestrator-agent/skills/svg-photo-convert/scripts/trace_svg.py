#!/usr/bin/env python3
"""
Trace a raster image into a real, self-contained SVG.

Every distinct colour region becomes a polygon path: quantise, find the boundary
edges of each colour on the pixel grid, chain them into closed loops, simplify,
smooth, emit one <path> per colour (fill-rule="evenodd", so holes are free).
No raster is embedded and no external binaries are needed -- just Pillow.

    python3 trace_svg.py photo.jpg -o photo.svg
    python3 trace_svg.py screenshot.png -o ui.svg --preset text
    python3 trace_svg.py logo.png -o logo.svg --preset graphic --colors 8

Presets (override any of them with the matching flag):
    photo    photographic detail, supersampled 2x          (default)
    graphic  flat art, logos, UI: fewer colours, crisp corners
    text     screenshots/diagrams: thin strokes survive, no corner smoothing

Output declares width/height at the source size and a viewBox at the traced
resolution, so it displays at natural size and stays sharp at 2x zoom.
"""
import argparse
import math
import os
import sys
import xml.etree.ElementTree as ET

try:
    from PIL import Image, ImageFilter
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: python3 -m pip install --user pillow")

PRESETS = {
    # `resample`: LANCZOS invents intermediate colours (good for photos, bad for flat
    # art); NEAREST keeps a logo's exact colours while still giving 2x trace geometry.
    "photo":   dict(colors=56, eps=0.85, scale=2, blur=0.45, merge=14, chaikin=1,
                    method="octree", resample="lanczos"),
    "graphic": dict(colors=32, eps=0.55, scale=2, blur=0.00, merge=6, chaikin=1,
                    method="octree", resample="nearest"),
    "text":    dict(colors=24, eps=0.35, scale=2, blur=0.00, merge=4, chaikin=0,
                    method="octree", resample="nearest"),
}


def rdp(pts, eps):
    """Douglas-Peucker for an open polyline."""
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
    """Simplify a closed loop by splitting it at its most distant point."""
    if len(loop) < 4:
        return loop
    if loop[0] == loop[-1]:
        loop = loop[:-1]
    x0, y0 = loop[0]
    far, fi = -1.0, 1
    for k in range(1, len(loop)):
        d = (loop[k][0] - x0) ** 2 + (loop[k][1] - y0) ** 2
        if d > far:
            far, fi = d, k
    a = rdp(loop[:fi + 1], eps)
    b = rdp(loop[fi:] + [loop[0]], eps)
    return a[:-1] + b


def chaikin(pts, iters=1):
    """Corner cutting: pixel staircases become clean vector edges."""
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


def num(v):
    return f"{v:.1f}".replace(".0", "")


def boundary_loops(idx, w, h, colour):
    """
    All closed loops bounding the pixels of `colour`.

    Each side of a boundary pixel that touches a different colour emits a
    segment oriented so the mask stays on the left; chaining those segments
    gives consistently wound loops (outer rings and holes alike).
    """
    out = {}
    for y in range(h):
        base = y * w
        for x in range(w):
            p = base + x
            if idx[p] != colour:
                continue
            if y == 0 or idx[p - w] != colour:
                out.setdefault((x, y), []).append((x + 1, y))
            if y == h - 1 or idx[p + w] != colour:
                out.setdefault((x + 1, y + 1), []).append((x, y + 1))
            if x == 0 or idx[p - 1] != colour:
                out.setdefault((x, y + 1), []).append((x, y))
            if x == w - 1 or idx[p + 1] != colour:
                out.setdefault((x + 1, y), []).append((x + 1, y + 1))

    loops = []
    for start in list(out.keys()):
        while out.get(start):
            loop = [start]
            cur = start
            guard = 0
            while True:
                nxts = out.get(cur)
                if not nxts:
                    break
                cur = nxts.pop()
                guard += 1
                if cur == start or guard > 5_000_000:
                    loop.append(cur)
                    break
                loop.append(cur)
            if len(loop) > 2:
                loops.append(loop)
    return loops


def loops_to_d(loops, eps, chaikin_iters):
    parts = []
    kept = 0
    for loop in loops:
        s = simplify_closed(loop, eps)
        if chaikin_iters and len(s) > 3:
            if s[0] == s[-1]:
                s = s[:-1]
            s = chaikin(s, chaikin_iters)
        if s and s[0] == s[-1]:
            s = s[:-1]
        if len(s) < 3:
            continue
        kept += 1
        parts.append("M" + "L".join(f"{num(x)} {num(y)}" for x, y in s) + "Z")
    return "".join(parts), kept


def main():
    ap = argparse.ArgumentParser(description="Trace a raster image into a detailed flat-colour SVG.")
    ap.add_argument("src", help="input image (jpeg/png/webp/bmp/gif)")
    ap.add_argument("-o", "--out", help="output svg (default: <src>.svg)")
    ap.add_argument("--preset", choices=sorted(PRESETS), default="photo")
    ap.add_argument("--colors", type=int, help="palette size before merging")
    ap.add_argument("--eps", type=float, help="Douglas-Peucker tolerance in traced px")
    ap.add_argument("--scale", type=float, help="supersample factor (1 = no supersampling)")
    ap.add_argument("--method", choices=["octree", "median"], help="quantiser")
    ap.add_argument("--resample", choices=["lanczos", "nearest"], help="upsampling filter")
    ap.add_argument("--chaikin", type=int, help="corner-cutting passes")
    ap.add_argument("--blur", type=float, help="Gaussian blur before quantising")
    ap.add_argument("--merge", type=float, help="merge palette entries closer than this RGB distance")
    ap.add_argument("--display-width", type=float, help="width attribute for the SVG (default: source width)")
    ap.add_argument("--transparent", action="store_true", help="keep alpha: skip the opaque background rect")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    cfg = dict(PRESETS[args.preset])
    for key in ("colors", "eps", "scale", "method", "chaikin", "blur", "merge", "resample"):
        if getattr(args, key) is not None:
            cfg[key] = getattr(args, key)

    out_path = args.out or os.path.splitext(args.src)[0] + ".svg"
    im = Image.open(args.src)
    has_alpha = (im.mode in ("RGBA", "LA") or
                 (im.mode == "P" and "transparency" in im.info))
    alpha = None
    if args.transparent and has_alpha:
        alpha = im.convert("RGBA").split()[3]
    im = im.convert("RGB")
    src_w, src_h = im.size

    # supersampling guard: keep the traced grid under ~2.2 Mpx
    scale = cfg["scale"]
    if src_w * src_h * scale * scale > 2_200_000:
        scale = max(1.0, round(math.sqrt(2_200_000 / (src_w * src_h)) * 2) / 2)
        if not args.quiet:
            print(f"note: {src_w}x{src_h} is large, supersampling reduced to {scale}x")

    if scale != 1.0:
        filt = Image.NEAREST if cfg["resample"] == "nearest" else Image.LANCZOS
        im = im.resize((int(src_w * scale), int(src_h * scale)), filt)
        if alpha is not None:
            alpha = alpha.resize((int(src_w * scale), int(src_h * scale)), Image.LANCZOS)
    if cfg["blur"] > 0:
        im = im.filter(ImageFilter.GaussianBlur(cfg["blur"]))
    im = im.filter(ImageFilter.MedianFilter(3))

    # flat art (logos, UI, diagrams) has few colours: keep its exact palette
    present = im.getcolors(maxcolors=256)
    ncol = min(cfg["colors"], len(present)) if present else cfg["colors"]

    q = im.quantize(colors=ncol, method=Image.FASTOCTREE if cfg["method"] == "octree" else Image.MEDIANCUT,
                    dither=Image.NONE)
    w, h = q.size
    pal = q.getpalette()
    idx = list(q.getdata())

    counts = {}
    for v in idx:
        counts[v] = counts.get(v, 0) + 1

    # merge near-identical palette entries (kills JPEG ringing halos)
    if cfg["merge"] > 0:
        rep = {c: c for c in counts}
        for c in sorted(counts, key=lambda c: -counts[c]):
            if rep[c] != c:
                continue
            r0, g0, b0 = pal[c * 3:c * 3 + 3]
            for d in sorted(counts, key=lambda c: -counts[c]):
                if d == c or rep[d] != d or counts[d] > counts[c]:
                    continue
                r1, g1, b1 = pal[d * 3:d * 3 + 3]
                if math.dist((r0, g0, b0), (r1, g1, b1)) < cfg["merge"]:
                    rep[d] = c
        remap = {c: rep[rep[c]] for c in counts}
        idx = [remap[v] for v in idx]
        counts = {}
        for v in idx:
            counts[v] = counts.get(v, 0) + 1

    layers, total_nodes = [], 0
    for colour in sorted(counts, key=lambda c: -counts[c]):
        loops = boundary_loops(idx, w, h, colour)
        d, kept = loops_to_d(loops, cfg["eps"], cfg["chaikin"])
        if not d:
            continue
        total_nodes += d.count("L") + d.count("M")
        r, g, b = pal[colour * 3: colour * 3 + 3]
        layers.append((counts[colour], kept,
                       f'<path fill="#{r:02x}{g:02x}{b:02x}" fill-rule="evenodd" d="{d}"/>'))
        if not args.quiet:
            print(f"  #{r:02x}{g:02x}{b:02x}  {counts[colour]:>7} px  {kept:>4} loops  {len(layers[-1][2])/1024:>7.1f} KB")

    dw = int(args.display_width or src_w)
    dh = int(round(h * dw / w))

    # optional alpha mask: keep transparency instead of painting a white box
    clip_defs, clip_open, clip_close = "", "", ""
    if alpha is not None:
        amask = list(alpha.convert("L").getdata())
        if len(amask) == w * h:
            aidx = [1 if a > 127 else 0 for a in amask]
            loops = boundary_loops(aidx, w, h, 1)
            ad, kept = loops_to_d(loops, cfg["eps"], 0)
            if ad:
                clip_defs = f'<clipPath id="alpha"><path fill-rule="evenodd" d="{ad}"/></clipPath>'
                clip_open, clip_close = '<g clip-path="url(#alpha)">', "</g>"
                if not args.quiet:
                    print(f"  alpha mask: {kept} loops")

    background = "" if args.transparent else f'<rect width="{w}" height="{h}" fill="#ffffff"/>\n'
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{dw}" height="{dh}">\n'
        f'<title>{os.path.basename(out_path)}</title>\n'
        f'<desc>Vector trace of {os.path.basename(args.src)}: {len(layers)} flat colour layers, '
        f'{total_nodes} polygon nodes, traced at {scale}x and simplified to {cfg["eps"]}px.</desc>\n'
        f'{clip_defs}\n{background}{clip_open}' + "\n".join(l[2] for l in layers) + f"{clip_close}\n</svg>\n"
    )
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(svg)
    ET.parse(out_path)  # an unbalanced file would render as an error page, not an image

    kb = len(svg) / 1024
    print(f"wrote {out_path}  {kb:.0f} KB  {len(layers)} layers  {total_nodes} nodes  "
          f"viewBox {w}x{h} displayed {dw}x{dh}")
    if kb > 8000:
        print("warning: file is too heavy to ship as-is; raise --eps (1.2-1.5), set --scale 1, "
              "or cut --colors, then re-verify")
    elif kb > 3000:
        print("note: large file; --eps 1.1 or --scale 1 will shrink it without much visible loss")
    if total_nodes > 800_000:
        print("note: very dense geometry; a higher --eps removes the detail nobody can see")


if __name__ == "__main__":
    main()
