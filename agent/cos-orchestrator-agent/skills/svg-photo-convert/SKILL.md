---
name: svg-photo-convert
description: Convert a raster image (JPEG, PNG, WebP, screenshot, photo, logo, icon, diagram) into a real, self-contained SVG that still carries the picture's detail, then render and measure it to prove it worked. Use this whenever someone asks to turn an image into SVG, "vectorize" an image, make an "SVG version/rendering of this photo/screenshot/logo", complains that an SVG conversion looks too simple or cartoonish, needs a scalable image for print, web or icon work, or hands over an image plus the word svg. Covers both routes, the faithful trace (default) and the hand-drawn illustration, and warns you when a source is a bad vectorisation candidate.
compatibility: Python 3 with Pillow (python3 -m pip install --user pillow) and a headless browser (firefox or chromium) for the verification render. No potrace, ImageMagick, cairosvg or numpy needed.
---

# SVG from a raster image

The job is not "produce a file with an .svg extension". It is "produce a file that still
contains what made the image worth converting". Two rules follow: never embed the raster as
the answer, and never assume a conversion is good without rendering it and measuring it.

Scripts are bundled next to this file; run them as `python3 <skill-dir>/scripts/…`.

## 1. Decide which route the request wants

| The ask | Route | Keeps |
| --- | --- | --- |
| "make this an SVG", "vectorize this", "SVG version/rendering of the image", "scale it for print" | **trace** (default) | the picture |
| "draw this", "an illustration/poster/flat-art version", "an icon that captures it" | **illustration** | the idea, not the pixels |

If the user has already seen a hand-drawn attempt and asked for more detail, they want the
trace. Drawing again is the slower answer.

## 2. Trace

```bash
python3 scripts/trace_svg.py photo.jpg -o photo.svg                  # photographs
python3 scripts/trace_svg.py shot.png  -o shot.svg --preset text      # screenshots, UI, diagrams
python3 scripts/trace_svg.py logo.png  -o logo.svg --preset graphic   # logos, flat art, icons
```

Read the printed summary: layer count, polygon nodes, file size, and the split between
`viewBox` and declared `width`/`height`. That split is what makes a 2× trace display at the
source size and stay sharp when zoomed — keep it.

Output is genuine SVG: one `<path fill-rule="evenodd">` per colour, largest area first, no
`<image>`, no external references.

## 3. Prove it — always, before saying it is done

```bash
python3 scripts/verify_svg.py photo.jpg photo.svg --zoom 60,280,220,520
```

This reports structure (parses? any `<image>`? external refs?), renders the SVG headless at
its own declared size, and prints MAE / RMSE / p95 / percentage of pixels off by more than 40
(0-255 scale). It writes `<name>-compare.png` (source | render) and, with `--zoom`, a 2× crop
of the region that matters. Its exit code is non-zero when the match is only "acceptable" or
worse, so it can gate a tuning loop.

Open the PNG. The numbers catch gross loss; the picture catches everything else.

How to read the numbers, calibrated on real output: flat art lands at MAE 1-3; a good
photographic trace (48-colour posterisation) sits near **10.5**, and that is the plateau for
this technique, not a failure. Above ~20, or a zoom crop that loses eyes, text or edges, means
re-tune before shipping.

## 4. Re-tune with intent

| Symptom | Change |
| --- | --- |
| pale halo around every edge | `--merge 18` |
| blotchy skin, banded gradients | `--colors 64` |
| pixel staircases on curves | `--chaikin 1 --scale 2` |
| text is mush | `--preset text` (ε 0.3, no corner cutting) |
| 10 MB file | `--scale 1 --eps 1.2` |
| washed-out, greyish colours | `--method octree` |
| a two-colour logo comes back with dozens of near-identical layers | anti-aliasing invented by upsampling: `--resample nearest` |
| transparent PNG came out on white | `--transparent` |
| stray specks everywhere | `--blur 0.6 --merge 16` |

Full flag reference, the algorithm, the measured calibration table and the limits are in
`references/parameters.md`. Read it when tuning beyond the table above, or when explaining to
a user why a source cannot be traced well.

## 5. Report what was delivered

State the path, layer count, file size, display size versus traced resolution, and the
measured match. If the source is a poor vectorisation candidate (heavy texture, fine
gradients, a photo that would need 100+ colours), say so and offer alternatives instead of
silently shipping something heavy or mushy — a 10 MB trace nobody can open is worse than an
honest "this needs a different approach".

## Illustrations, when that is the ask

A drawn SVG is legitimate output. What makes it work, learned the hard way:

- **Measure the source before drawing.** Crop at 2-3× and scan colour masks per row and
  column to find real edges. Eyeballing puts silhouettes in the wrong place, and that reads
  as "wrong" instantly even when every individual shape is fine.
- **Build from a small generator script, not hand-edited SVG**, and validate the result
  (`ET.parse`) so unbalanced markup fails at build time instead of rendering to an error page.
- **Render after every structural change and look at it.** Two of three structural bugs in a
  recent session were invisible in the markup and obvious in the render.
- **A face reads as a mask** until the eye socket, lid line and lashes are near photographic.
  Promise a stylised illustration, not a likeness, and let the user choose.

## Pitfalls that cost real time

- Never `<image>`-embed the source: that is not a vector.
- Headless Firefox writes **nothing** when `--screenshot` gets a relative path — always absolute.
- A desktop Firefox running for the same user breaks the headless CLI: use
  `--new-instance --no-remote --profile <throwaway>`. The verify script retries with fresh profiles.
- A browser window bigger than the SVG does **not** upscale the drawing; rewrite `width`/`height`
  to render at 2×.
- Beyond ~48-64 colour layers, more colours stops helping: extra colours land in speckle and
  measured error creeps back up.
- Corner cutting (`--chaikin`) rounds everything, including letters. Zero it for text.
