# repo-backbone

Draws a high-level backbone of a repository as an SVG: one vertebra per top-level entry,
sorted by weight, with a proportional bar for the files git tracks under it and a preview of
its children.

```
repo-backbone/
├── repo-backbone.py    # the generator, Python 3 stdlib only
├── repo-backbone.svg   # current output for ~/.pi (generated — do not hand-edit)
└── README.md
```

## Generate

```bash
cd ~/.pi/apps-scripts/svg-scripts/repo-backbone

python3 repo-backbone.py                       # cwd as root -> repo-backbone.svg here
python3 repo-backbone.py --root ~/.pi          # the pi-workspace repo
python3 repo-backbone.py --root ~/.pi --list   # print the table, write nothing
python3 repo-backbone.py --root . --depth 0    # names + bars only, no child previews
python3 repo-backbone.py --root . --sort name  # alphabetical instead of by weight
python3 repo-backbone.py --root . --exclude z.old,logs
python3 repo-backbone.py --root . --include-hidden   # keep dotfiles
python3 repo-backbone.py --root ~/.pi --out /tmp/backbone.svg
```

View it:

```bash
firefox ~/.pi/apps-scripts/svg-scripts/repo-backbone/repo-backbone.svg
```

## What it shows, and what it refuses to fake

| Mark | Meaning |
| --- | --- |
| Glowing filled dot | git tracks files under this entry |
| Hollow dot + dashed branch | git tracks **nothing** here |
| Bar | files tracked, scaled to the heaviest entry (the number is exact) |
| `ignored` | `git check-ignore` matches it — scratch, cache, archived |
| `untracked` | git tracks nothing and does not ignore it either |
| `own git repo` | the entry contains its own `.git` (nested repo / submodule) |

That last column matters: on `~/.pi` the repo is 95 GB on disk but git tracks 574 files, so a
size-based picture would be almost entirely cache, sessions, and archived work. The diagram
reports tracking, not disk usage — hollow dots are real, not missing data.

## How it works

1. `git ls-files` in the root, counting first path components — the tracked file count per entry.
2. `git check-ignore --stdin` on the top-level names — which entries are ignored.
3. `iterdir()` for the child preview, dirs first, hidden names skipped unless `--include-hidden`.
4. Rows sorted by tracked count (default) or name; geometry computed from row count, so the
   canvas height grows with the repo.
5. The SVG text is parsed with `xml.etree` **before** it is written, so a malformed file never
   lands on disk.

Output is deterministic — no timestamps, no randomness — so regenerating is diff-clean.

If the root is not a git repo, everything renders as not tracked and the run still succeeds
(verified against `/tmp/not-a-repo`).

## Output checks run

- Canvas `1180 × 1540` for `~/.pi` (20 entries at 66 px rows), 18 387 bytes.
- No element out of bounds: every `rect`, `circle`, and `text` anchor checked against the canvas.
- Element profile: 22 circles, 36 rects, 74 texts, 29 tspans, 21 lines, 3 gradients, 1 filter.
- Works on a subdirectory root (`apps-scripts` → 7 entries), on `--sort name` (`docs` → 17
  entries), and on a non-repo directory (2 entries, both untracked).

No rasteriser is installed on this laptop (`rsvg-convert`, `inkscape`, `cairosvg` all absent), so
the picture has been validated structurally, not visually — open it once in Firefox to eyeball.

## Ideas not built

- Group the `agent-*` family into one band with sub-lanes.
- Optional byte-size column (needs `du`, slow on 95 GB).
- Embed commit age per entry (`git log -1 --format=%cr`).
