---
description: Convert a raster image (photo, screenshot, logo, icon) into a detailed, verified, self-contained SVG
argument-hint: "<image path> [what it is for]"
---
Load the `svg-photo-convert` skill and follow it end to end.

Image: `${1:-ask me for the image path}`
Purpose: `${2:-unspecified}`

Pick the route from the purpose (trace by default, illustration only if a drawing was asked
for), run the bundled `trace_svg.py` with the preset that fits the source, then run
`verify_svg.py`, open the comparison PNG, and re-tune if the measured match is only
"acceptable" or worse. Report the path, layer count, file size, display size versus traced
resolution, and the measured MAE — and say plainly if the source is a poor vectorisation
candidate.
