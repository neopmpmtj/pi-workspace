# file-dedupe

Content-based duplicate finder for the drives that are about to become a backup.
Duplicates are decided by content only — never by name or date — so a copied file
carrying a fresh mtime is still caught.

Nothing is deleted. The default action is to **quarantine**: duplicates are moved to
`<root>/.dedupe/quarantine-<date>/`, same filesystem, instant, reversible, with a
`manifest.jsonl` recording where each file came from.

Stdlib only — Python 3.10+.

## Quick start (the intended first run)

```bash
cd ~/.pi/apps-scripts/file-dedupe

# 1. dry run: index + report, nothing touched
python3 dedupe.py scan --root /media/pmpmt/Elements

# 2. read the report
cat /media/pmpmt/Elements/.dedupe/reports/*/summary.md

# 3. act on exactly the worst N groups, once you are happy
python3 dedupe.py apply --db /media/pmpmt/Elements/.dedupe/index.sqlite \
        --limit 20 --apply

# 4. verify against the keepers by hand, then empty the quarantine
python3 dedupe.py verify --manifest /media/pmpmt/Elements/.dedupe/quarantine-*/manifest.jsonl
python3 dedupe.py purge --root /media/pmpmt/Elements --date <date> --yes
```

`apply` without `--apply` is a dry run: it prints and writes the plan, and changes nothing.

## Subcommands

| Command | What it does |
| --- | --- |
| `scan` | walk the root(s), hash, write `<root>/.dedupe/index.sqlite`, then write the report |
| `report` | regenerate `summary.md` + `duplicates.csv` from an existing index |
| `apply` | quarantine (default), `--delete`, or `--link` the duplicates |
| `verify` | re-hash a random sample of a quarantine against its keepers |
| `restore` | move a quarantine back to the paths in its manifest |
| `purge` | delete a quarantine folder after you have checked it |

Common flags: `--root` (repeatable, several roots share one index), `--db`, `--min-size`
(default `1MB`), `--keep <glob>` (repeatable; a matching path wins the group), `--top`.
`scan` also takes `--jobs`, `--exclude <dir-glob>`, `--fresh-window <seconds>`,
`--ignore-fresh`, `--allow-any-dir`.

## How a duplicate is decided

1. **Size bucket** — files of a size that appears once are dropped without reading them.
2. **Head+tail hash** — first and last 64 KiB plus the size. Cheap lookalike filter.
3. **Full SHA-256** — only for files still tied. Groups are `(size, sha256)`, so
   case-variant names and different directories still count as duplicates.

Skipped on purpose: symlinks (never followed), hard-linked files (`nlink > 1` — moving
them breaks the link and saves nothing), zero-byte files, anything below the size floor,
other filesystems mounted under the root, and noise directories (`.dedupe`, `.git`,
`node_modules`, `snap`, `__pycache__`, `.venv`, `lost+found`, `$RECYCLE.BIN`,
`System Volume Information`, `.thumbnails`, `.Trash*`).

The keeper of a group is chosen in this order: `--keep` glob match → shallowest path →
oldest mtime → shortest name → path. The reason is printed in the report and the CSV.

## Safety rules baked in

- The root must be a **mount point** (an unmounted drive looks like an empty folder);
  `/` is always refused. `--allow-any-dir` exists for deliberate sub-folder scans and tests.
- If any content file changed within `--fresh-window` (default 10 min), the scan aborts
  before hashing — something is still copying.
- `--delete` requires `--yes-i-have-a-backup`. `--apply` is required for any action.
- After quarantining, a random 5 % sample is re-hashed against its keeper; any mismatch
  restores the whole batch and exits non-zero.
- The index is resumable: an interrupted `scan` re-reads only files whose size or mtime
  changed. Re-running `scan` does not restart the hashing from zero.

## Recovery

Every quarantine folder holds `manifest.jsonl` (one JSON object per file) with
`original`, `quarantined_to`, `keeper`, `sha256`, `size`.

```bash
# put everything back where it came from (idempotent per file)
python3 dedupe.py restore --manifest /media/pmpmt/Elements/.dedupe/quarantine-2026-01-02/manifest.jsonl

# or manually, for one file
mkdir -p "$(dirname '/original/path')"
mv '/media/pmpmt/Elements/.dedupe/quarantine-2026-01-02/relative/path' '/original/path'
```

`restore` refuses when an original path already exists, unless `--overwrite` is given.
Deleting the quarantine folder by hand is also safe — it only holds duplicates whose
keeper is still in place (check `verify` first).

## Tests

```bash
cd ~/.pi/apps-scripts/file-dedupe
python3 -m unittest discover -s tests -v
```

The fixture builds exact duplicates, a one-byte-off near duplicate, hard links, a
symlink, a zero-byte file, case-variant names, an unreadable file, nested identical
names, and noise folders — then checks grouping, keeper choice, quarantine, restore,
verify, purge, and every refusal path.
