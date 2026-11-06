# Eval set — svg-photo-convert

`evals.json` holds four realistic test prompts (three objectively gradeable, one qualitative).
`logo.png` is the transparent source used by eval 3.

## Status: self-tested, not yet run through a subagent harness

This agent runs with `read`, `bash`, `edit`, `write`, `grep`, `find` only — no subagent tool and
no `claude` CLI — so the skill-creator loop (parallel with-skill vs baseline runs, the HTML
review viewer, description optimisation) cannot execute here. What was done instead: the
workflow in `SKILL.md` was executed end to end exactly as written, and each objective assertion
was checked against real output on 2026-11-04.

| eval | source | command | measured | assertions |
| --- | --- | --- | --- | --- |
| 1 photo → poster | `~/.pi/01test_image-vision-model.jpeg` (423×635) | `trace_svg.py … -o poster.svg` | 2039 KB, 48 paths, MAE 10.7, 9.3 % off | 6/6 pass |
| 2 screenshot → docs | `<pi>/docs/images/tree-view.png` (1720×1116) | `--preset text` | 2599 KB, 23 layers, MAE 1.2, 0.9 % off | 4/4 pass |
| 3 transparent logo | `evals/logo.png` (128×128 RGBA) | `--preset graphic --transparent` | 16 KB, 3 fills, 0 `<rect>`, clip-path present, MAE 0.3 | 5/5 pass |
| 4 "draw it instead" | same portrait | manual run of the illustration guidance | geometry measured by colour masks, generator script, rendered and checked | qualitative — judged by hand |

Raw numbers from eval 1 and 2 are also the calibration data behind the verdict bands in
`verify_svg.py` and the table in `references/parameters.md`; they should be re-measured if the
tracer's defaults ever change.

## What a real harness run should add

1. Two runs per eval (with skill / without skill), same prompt, `iteration-1/eval-N/`.
2. Grade the assertions above programmatically where possible — they are all checkable from the
   SVG file plus the `verify_svg.py` output, so a script beats a judge here.
3. Pay attention to eval 4: the failure mode to watch for is producing a trace when the user
   asked for a drawing (route selection), which no file-level assertion catches.
