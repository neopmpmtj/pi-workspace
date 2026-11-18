# Image → SVG rendering

**Canonical implementation is now the skill:** `skills/svg-photo-convert/`
(`SKILL.md`, `scripts/trace_svg.py`, `scripts/verify_svg.py`, `references/parameters.md`,
`evals/`). It adds presets, alpha preservation, an automatic headless render-and-measure
step, and calibrated quality bands. Reach for the skill first; the copies below are the
original artefacts of the 2026-11-04 session and still run as documented.

Two independent pipelines live in `scripts/`. Both are pure Python 3 + Pillow, no
external binaries (this laptop has no ImageMagick, potrace, rsvg-convert or cairosvg).

## 1. `scripts/photo_trace_svg.py` — faithful vector trace (default choice)

Quantises the photo and traces every colour region into polygon paths. Output is a
flat-colour vectorisation: reads like the photo, edits like a poster.

```bash
python3 scripts/photo_trace_svg.py <in.jpg> <out.svg> \
        [colors] [eps] [scale] [method] [chaikin] [blur] [displayW] [merge]

# the settings used for 01test_image-vision-model.svg (2.0 MB, 48 layers)
python3 scripts/photo_trace_svg.py ~/.pi/01test_image-vision-model.jpeg \
        /tmp/out.svg 56 0.85 2 octree 1 0.45 423 14
```

| arg | meaning | good values |
| --- | --- | --- |
| colors | palette size before merging | 24 (flat) … 64 (rich) |
| eps | Douglas-Peucker tolerance in source px | 0.6 crisp … 1.2 compact |
| scale | supersample factor before tracing | 2 (crisp edges, 4× bytes) |
| method | `octree` (punchier hues) or `median` (softer, washy) | octree |
| chaikin | corner-cutting passes, smooths pixel staircases | 1 |
| blur | Gaussian blur before quantising | 0.4–0.6 |
| displayW | `width`/`height` in the SVG header (viewBox keeps the trace res) | 423 |
| merge | RGB distance under which palette entries are merged (kills JPEG halos) | 12–18 |

Pipeline inside: median filter → optional blur → median-cut/octree quantise →
merge near-identical palette entries → per-colour boundary edges (mask on the left,
so loops are consistently oriented) → chain edges into closed loops → RDP simplify →
Chaikin → one `<path>` per colour with `fill-rule="evenodd"` (holes free) →
layers emitted largest-area first.

Useful knobs when the result misbehaves:
* pale halos around high-contrast edges → raise `merge`;
* blotchy skin / face loses shadow gradation → raise `colors`, lower `eps`;
* file too big → lower `scale` to 1, raise `eps`, or lower `colors`.

## 2. `scripts/fruit_portrait_svg.py` — hand-drawn illustration

Geometry is hand-measured from the photo (skin/purple masks + 2.5×–3× crops), then
drawn with gradients, filters, ~50 individual grapes, lashes, jewellery, embroidery
patterns and a grain overlay. ~79 KB, ~950 elements. Deliberately stylised — it is an
illustration, not a likeness.

```bash
python3 scripts/fruit_portrait_svg.py /tmp/portrait.svg
```

## Rendering a check image without a browser CLI

Firefox headless needs its own profile when another Firefox is running:

```bash
mkdir -p /tmp/ffprof
firefox --headless --new-instance --profile /tmp/ffprof \
        --screenshot /tmp/out.png --window-size=423,635 file:///abs/path/out.svg
```

Compare against the source with Pillow (no ImageMagick needed):

```python
from PIL import Image
a = Image.open(src).convert('RGB'); b = Image.open('/tmp/out.png').convert('RGB').resize(a.size)
c = Image.new('RGB', (a.width*2+10, a.height), 'white'); c.paste(a, (0, 0)); c.paste(b, (a.width+10, 0)); c.save('/tmp/cmp.png')
```

## Current outputs

| file | what |
| --- | --- |
| `~/.pi/01test_image-vision-model.svg` | trace, 423×635 display / 846×1270 viewBox, 48 layers, 2.0 MB |
| `~/.pi/01test_image-vision-model.illustrated.svg` | hand-drawn illustration, 423×635, 79 KB |
