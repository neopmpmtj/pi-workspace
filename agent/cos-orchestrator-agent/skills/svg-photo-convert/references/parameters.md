# Trace parameters, tuning, and limits

## What `trace_svg.py` actually does

1. **Supersample** by `--scale` (LANCZOS). Tracing at 2× gives four times the
   geometric detail for the same display size; the SVG then declares
   `width/height` at the source size and `viewBox` at the traced size.
2. **Blur, then median 3.** JPEG ringing and speckle go, boundaries stay put.
3. **Quantise** to N colours. Octree preserves hue (a violet turban stays violet);
   median cut spends palette slots on background and greys everything out.
4. **Merge** palette entries closer than `--merge` RGB units. This is the step
   that removes the pale halo that otherwise appears around every high-contrast
   edge: JPEG ringing manufactures near-white colours that are not the background.
5. **Trace** the boundary of each colour on the pixel grid, chain segments into
   closed loops, simplify (Douglas-Peucker), smooth (Chaikin), and emit one
   `<path fill-rule="evenodd">` per colour — holes need no special handling.
   Layers are written largest-area-first so small features land on top.

## Presets

| preset | for | colors | eps | scale | blur | merge | chaikin | resample |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `photo` | photographs, artwork with gradients | 56 | 0.85 | 2 | 0.45 | 14 | 1 | lanczos |
| `graphic` | logos, flat illustration, icons | 32 | 0.55 | 2 | 0 | 6 | 1 | nearest |
| `text` | screenshots, diagrams, UI, anything with type | 24 | 0.35 | 2 | 0 | 4 | 0 | nearest |

`chaikin 0` in `text` matters: corner cutting rounds letters until they blur.
`resample nearest` in the flat presets matters too: LANCZOS at 2× invents intermediate
colours along every edge, so a two-colour logo comes back as seventeen near-red layers.
NEAREST keeps the exact colours and still gives 2× trace geometry.

## Every knob

| flag | default | effect | raise it when | lower it when |
| --- | --- | --- | --- | --- |
| `--colors` | preset | palette size | skin/faces look blotchy, gradients band badly | the file is too big, or the source is flat art |
| `--eps` | preset | simplification tolerance in traced px | the file is huge, curves are noisy | small text or thin strokes are getting eaten |
| `--scale` | preset | supersample factor | edges look stepped at 100 % | the source is already ≥ 1000 px on a side |
| `--blur` | preset | pre-quantise blur | the source is a noisy JPEG | the source is clean, or detail is thin |
| `--merge` | preset | palette-merge distance | pale halos around edges | two genuinely different colours collapse into one |
| `--chaikin` | preset | corner-cutting passes | staircases on curved edges | letters or sharp corners must stay sharp |
| `--method` | octree | quantiser | — | use `median` only if octree over-saturates a muddy source |
| `--resample` | preset | upsampling filter | `lanczos` for gradients | `nearest` for flat art, logos, UI |
| `--display-width` | source width | the SVG `width` attribute | the file is for a page at a given width | — |
| `--transparent` | off | keep alpha via a clip path | the source is a PNG logo/icon with transparency | — |

The tracer refuses to supersample past ~2.2 Mpx: above that it silently reduces
`--scale` and prints a note, because tracing cost grows with the traced pixel grid.

## Measured calibration (this laptop, 2026-11-04)

Same 423×635 portrait, `photo` preset, varying `--colors`; distance measured by
`verify_svg.py` at display size:

| colors | MAE /255 | RMSE | p95 | pixels off by >40 | file |
| --- | --- | --- | --- | --- | --- |
| 8 | 37.3 | 68.1 | 199 | 26.2 % | 1.0 MB |
| 16 | 17.0 | 33.5 | 81 | 13.4 % | 1.4 MB |
| 24 | 12.9 | 20.8 | 52 | 10.0 % | 1.4 MB |
| **48** | **10.5** | **18.0** | **53** | **8.8 %** | **1.8 MB** |
| 96 | 11.7 | 21.2 | 60 | 12.2 % | 2.8 MB |

Two things to read out of that:

- **A photographic trace plateaus near MAE 10.** That is not a bug, it is what
  flat-colour posterisation costs. Chasing MAE 3 on a photo means hundreds of
  colours and a file nobody wants.
- **More colours is not monotonically better.** Past ~48 the extra colours land
  in tiny speckle regions whose boundaries are noise, so error creeps back up.
  If a source needs more than ~64 colours, it is probably not a good trace
  candidate — say so instead of shipping a 10 MB file.

Flat art behaves completely differently: a 1720×1116 UI screenshot traced with
`--preset text` measured **MAE 1.2, 0.9 % off, text perfectly legible** — so the
"excellent" band is reachable, just not for photographs. A 32×32 icon with alpha
(`--preset graphic --transparent`) came out as 3 layers, 4 KB, **MAE 0.9**.

One trap on the flat-art path, measured: tracing that same icon with LANCZOS
upsampling produced 17 layers and MAE 8.2, because 2× LANCZOS invents a gradient of
near-reds along every edge. Flat sources want `--resample nearest`.

## Symptom → knob

| What you see | Cause | Knob |
| --- | --- | --- |
| pale outline around every object | near-white palette entries from JPEG ringing | `--merge 18-24` |
| face is blotchy, shadows become patches | too few colours for skin gradients | `--colors 64-80` |
| visible pixel staircase on curves | simplification keeps the steps, no smoothing | `--chaikin 1`, `--scale 2` |
| letterforms are mush | corner cutting + aggressive simplification | `--preset text`, `--chaikin 0`, `--eps 0.3` |
| stray one-pixel specks everywhere | noise in the source | `--blur 0.6`, `--merge 16` |
| file is 10 MB | too many loops | `--scale 1`, `--eps 1.2`, fewer colours |
| colours are washed out and grey | median-cut quantiser | `--method octree` |
| transparent PNG came out on white | alpha flattened | `--transparent` |

## Limits worth telling the user about

- **Gradients become bands.** A smooth sky or skin gradient can only be as smooth
  as the palette. Expect visible steps, or accept more colours.
- **Texture is lost or explodes.** Film grain and fine noise either disappear or
  become thousands of tiny paths. Blur first.
- **A face is the hardest thing to fake.** Photographic detail survives a trace
  because it *is* the detail; a hand-drawn vector version of a face needs
  near-photographic eyelash and lid geometry and will read as a mask until then.
  If the ask is "a drawing of this person", say plainly that a trace gets closer.
- **Text below ~10 px** will not survive; trace at scale 2 and use `text`.

## Verification is part of the job

`verify_svg.py` renders the SVG with a headless browser at the SVG's own declared
size, then reports MAE/RMSE/p95/%bad against the source, writes a side-by-side
PNG, and optionally a 2× zoom crop. Look at the PNG, not just the numbers: the
numbers catch gross losses, the picture catches the rest.

Known renderer quirks that cost real time:

- Firefox writes **nothing** if `--screenshot` is given a relative path. Always
  pass an absolute path (the script does).
- A running desktop Firefox breaks the headless CLI: use `--new-instance
  --no-remote --profile <throwaway>`. The script retries three times with fresh
  profiles.
- A window larger than the SVG does **not** scale the drawing up — it paints at
  the declared size in the corner. To render at 2× the script rewrites
  `width`/`height` in a temporary copy.
- Chromium works as a fallback with `--headless --screenshot=abs.png
  --window-size=W,H`.
