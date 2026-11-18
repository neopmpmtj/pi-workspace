#!/usr/bin/env python3
"""
Render an SVG and prove how close it is to the source image.

Traced output can look right at a glance and still be wrong in ways that matter
(a face losing its eyes, a logo losing its edge). This script closes the loop:

  1. structural checks   - parses, no <image>, no external href, declares a size
  2. headless render     - firefox or chromium, at the SVG's own display size
  3. numeric comparison  - MAE / RMSE / p95 / % of pixels badly off, in 0-255
  4. two PNGs            - source next to render, plus a 2x zoom crop

    python3 verify_svg.py photo.jpg photo.svg
    python3 verify_svg.py photo.jpg photo.svg --zoom 60,280,220,520

Exit code is 0 when the render matches within the "good" band, 1 otherwise, so
it can gate a re-tune loop.
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

try:
    from PIL import Image, ImageChops, ImageStat
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: python3 -m pip install --user pillow")

SVG_NS = "{http://www.w3.org/2000/svg}"


def svg_size(path):
    """(pixel width, pixel height, viewBox w, viewBox h) from the root element."""
    root = ET.parse(path).getroot()

    def dims(root):
        w, h = root.get("width"), root.get("height")
        if w and h and not w.endswith("%") and not h.endswith("%"):
            return (float("".join(c for c in w if c.isdigit() or c == ".")),
                    float("".join(c for c in h if c.isdigit() or c == ".")))
        return None

    vb = root.get("viewBox")
    if vb:
        _, _, vw, vh = [float(v) for v in vb.replace(",", " ").split()]
    else:
        vw = vh = None
    if not vb:
        raise SystemExit(f"{path}: no viewBox, cannot determine intrinsic size")
    wh = dims(root)
    if not wh:
        wh = (vw, vh)
    return wh[0], wh[1], vw, vh


def structural_checks(path):
    """Facts about whether this is a self-contained vector file."""
    text = open(path, encoding="utf-8").read()
    try:
        root = ET.parse(path).getroot()
        parses = True
    except ET.ParseError as exc:
        return {"parses": False, "error": str(exc), "has_image": False,
                "external_refs": ["-"], "elements": 0, "paths": 0}
    images = [e for e in root.iter() if e.tag == SVG_NS + "image"]
    refs = []
    for el in root.iter():
        for attr in ("href", "{http://www.w3.org/1999/xlink}href"):
            v = el.get(attr)
            if v and not v.startswith("#"):
                refs.append(v[:60])
        for v in (el.get("style") or "").split(";"):
            if "url(http" in v:
                refs.append(v.strip()[:60])
    return {"parses": parses, "has_image": bool(images), "external_refs": refs,
            "elements": len(list(root.iter())), "paths": text.count("<path")}


def find_renderer():
    for exe, kind in (("firefox", "firefox"), ("chromium", "chromium"),
                      ("chromium-browser", "chromium"), ("google-chrome", "chromium")):
        path = shutil.which(exe)
        if path:
            return path, kind
    return None, None


def render_svg(svg_path, out_png, width, height, factor=1.0):
    """Render at the SVG's display size (times `factor`) using a throwaway browser profile."""
    exe, kind = find_renderer()
    if not exe:
        raise SystemExit("no headless browser found (need firefox or chromium)")
    tmpdir = tempfile.mkdtemp(prefix="svgverify-")
    # firefox silently writes nothing when --screenshot gets a relative path
    out_png = os.path.abspath(out_png)
    target = svg_path
    if factor != 1.0:
        # a bigger window does NOT scale the drawing, so rewrite the declared size
        root = ET.parse(svg_path).getroot()
        root.set("width", str(int(round(width * factor))))
        root.set("height", str(int(round(height * factor))))
        target = os.path.join(tmpdir, "scaled.svg")
        ET.ElementTree(root).write(target, encoding="utf-8", xml_declaration=True)
    win_w, win_h = int(round(width * factor)), int(round(height * factor))
    url = "file://" + os.path.abspath(target)

    # a browser that is already running for this user makes the CLI flaky; retry
    # with a fresh throwaway profile before giving up
    last = ""
    for attempt in range(3):
        profile = os.path.join(tmpdir, f"profile{attempt}")
        os.makedirs(profile, exist_ok=True)
        if kind == "firefox":
            cmd = [exe, "--headless", "--no-remote", "--new-instance", "--profile", profile,
                   "--window-size", f"{win_w},{win_h}", "--screenshot", out_png, url]
        else:
            cmd = [exe, "--headless", "--disable-gpu", "--hide-scrollbars",
                   f"--window-size={win_w},{win_h}", f"--screenshot={out_png}", url]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            last = (proc.stderr or "")[-500:]
        except subprocess.TimeoutExpired:
            last = "timed out after 180 s"
        if os.path.exists(out_png) and os.path.getsize(out_png) > 0:
            return out_png
        time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"render failed ({exe}) after 3 attempts:\n{last}")


def _flatten(im):
    """Composite onto white so a transparent source and an opaque render compare fairly."""
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        bg.alpha_composite(im.convert("RGBA"))
        return bg.convert("RGB")
    return im.convert("RGB")


def compare(src_path, png_path):
    """Numeric distance between the source and the render, in 0-255 units."""
    src = _flatten(Image.open(src_path))
    ren = _flatten(Image.open(png_path))
    if ren.size != src.size:
        ren = ren.resize(src.size, Image.LANCZOS)
    diff = ImageChops.difference(src, ren)
    st = ImageStat.Stat(diff)
    mae = sum(st.mean) / 3.0
    rmse = (sum(r * r for r in st.rms) / 3.0) ** 0.5
    maxdiff = ImageChops.lighter(ImageChops.lighter(*diff.split()[:2]), diff.split()[2])
    hist = maxdiff.histogram()
    total = sum(hist) or 1
    acc, p95 = 0, 255
    for value, count in enumerate(hist):
        acc += count
        if acc / total >= 0.95:
            p95 = value
            break
    bad = sum(hist[41:]) / total
    return dict(mae=mae, rmse=rmse, p95=p95, bad=bad, src=src, ren=ren)


def verdict(c):
    """Bands calibrated on real traces; a photographic trace plateau sits near MAE 10."""
    if c["mae"] < 8 and c["bad"] < 0.05:
        return "excellent - flat art / few-colour sources live here", 0
    if c["mae"] < 13 and c["bad"] < 0.12:
        return "good - reads as the same picture", 0
    if c["mae"] < 20 and c["bad"] < 0.18:
        return "acceptable - detail is visibly lost; raise --colors or lower --eps", 1
    return "poor - re-tune before shipping (more colours, lower --eps, higher --merge)", 1


def main():
    ap = argparse.ArgumentParser(description="Render an SVG and measure it against the source image.")
    ap.add_argument("src", help="source raster image")
    ap.add_argument("svg", help="svg to verify")
    ap.add_argument("--prefix", default=None, help="prefix for output PNGs (default: <svg> without .svg)")
    ap.add_argument("--zoom", default=None, help="crop for a 2x detail view, as x0,y0,x1,y1 in source px")
    ap.add_argument("--factor", type=float, default=2.0, help="render scale used for the zoom crop (default 2)")
    args = ap.parse_args()

    prefix = args.prefix or os.path.splitext(args.svg)[0]
    info = structural_checks(args.svg)
    if not info["parses"]:
        print(f"FAIL  {args.svg} does not parse: {info['error']}")
        return 1
    print(f"structure: {info['elements']} elements, {info['paths']} paths, "
          f"<image>: {'YES (not a vector!)' if info['has_image'] else 'no'}, "
          f"external refs: {info['external_refs'] or 'none'}")

    dw, dh, vw, vh = svg_size(args.svg)
    print(f"size: viewBox {vw:g}x{vh:g} displayed {dw:g}x{dh:g} "
          f"({vw / dw:.1f}x detail), file {os.path.getsize(args.svg) / 1024:.0f} KB")

    png = f"{prefix}-render.png"
    render_svg(args.svg, png, dw, dh, 1.0)
    c = compare(args.src, png)

    side = Image.new("RGB", (c["src"].width * 2 + 10, c["src"].height), "white")
    side.paste(c["src"], (0, 0))
    side.paste(c["ren"], (c["src"].width + 10, 0))
    side_path = f"{prefix}-compare.png"
    side.save(side_path)

    label, code = verdict(c)
    print(f"match: MAE {c['mae']:.1f}/255, RMSE {c['rmse']:.1f}, p95 {c['p95']}, "
          f"{c['bad'] * 100:.1f}% of pixels off by >40  ->  {label}")

    if args.zoom:
        x0, y0, x1, y1 = [int(v) for v in args.zoom.split(",")]
        z = f"{prefix}-zoom.png"
        render_svg(args.svg, f"{prefix}-render2x.png", dw, dh, args.factor)
        big = Image.open(f"{prefix}-render2x.png").convert("RGB")
        sx, sy = big.width / c["src"].width, big.height / c["src"].height
        left = c["src"].crop((x0, y0, x1, y1)).resize((int((x1 - x0) * 2), int((y1 - y0) * 2)), Image.LANCZOS)
        right = big.crop((int(x0 * sx), int(y0 * sy), int(x1 * sx), int(y1 * sy))).resize(left.size, Image.LANCZOS)
        out = Image.new("RGB", (left.width * 2 + 10, left.height), "white")
        out.paste(left, (0, 0))
        out.paste(right, (left.width + 10, 0))
        out.save(z)
        print(f"zoom: {z}")

    print(f"figures: {side_path}  (source | render)")
    return code


if __name__ == "__main__":
    sys.exit(main())
