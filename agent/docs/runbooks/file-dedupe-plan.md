# File dedupe — task brief (handoff)

Status: **BUILT 2026-11-21.** `apps-scripts/file-dedupe/` exists with 15 passing tests and a
row in `docs/SCRIPTS.md`. The first real dry run is **blocked**: no USB block device is
attached to the laptop (`/dev/sd*` absent, `lsblk` shows only `nvme0n1`), so
`/media/pmpmt/Elements` does not exist. The tool now fails that run cleanly with
`[FAIL] not a directory`. Resume with the commands in `apps-scripts/file-dedupe/README.md`
once the drive is unlocked and mounted. Written 2026-11-20 to hand the task to a fresh
session with a clean context; updated 2026-11-21 with the drive mounted and measured.

## The mission

Build a tool that finds and removes **duplicate files by content** across the user's storage,
so existing drives can be reused for a full backup without buying new hardware (budget is
tight). Deletion by date is explicitly rejected: copied files carry the copy date, not the
origin date. Content hash is the only criterion.

Targets, in the order the user wants to tackle them:

1. **1 TB external USB drive** — years of accumulated backups, believed to be full of copies.
2. **Two SATA disks on the home server**, both NTFS, both currently unmounted (`Dados` 931 G,
   `Novo volume` 298 G) — also believed to hold many duplicates.

## The external drive, as measured 2026-11-21

- **WD Elements Portable 2 TB** (`sdc`), BitLocker-encrypted, **unlocked by the user** and
  auto-mounted at **`/media/pmpmt/Elements`** (`ntfs3`, read-write, uid 1000).
- **1.9 T total, 1.7 T used, 186 G free (91 % full).**
- To re-open after a reboot: `sudo cryptsetup open --type bitlk /dev/sdc1 wd2tb` (user knows the
  password) — the volume is **not** in fstab.
- Top-level contents by size:

| Path | Size | Note |
| --- | --- | --- |
| `MULTIMEDIA/` | 991 G | `Filmes` 947 G, `PopcornTime` 32 G, `Videos Vários` 3.5 G |
| `Ante Maio2018/` | 286 G | pre-2018 archive |
| `Copied to server/` | 204 G | `musicas` 137 G, `Linux_python 64G SDCard` 26 G, `Electronics` 23 G, `Alan Watts` 8.1 G |
| `models/` | 61 G | model weights |
| `BCKUP190910/` | 36 G | one of nine `BCKUP*` folders (190314, 190524, 190629, 190910, 191021, 200614, 201026, 230423, 250420) — overlaps likely |
| `PC Casa - Pedro/` | 19 G | |
| `ATALHOS/` | 16 G | Windows shortcuts — expect many 0-byte/duplicate `.lnk` |
| `BCKUP201026/` | 15 G | |
| `BCKUP200614 NB_NB/` | 12 G | |
| `BCKUP190524/` | 11 G | |
| `Bckup230423/` | 8.3 G | |
| `$rECYCLE.BIN/` | 4.0 G | recycle bin — skip, but its 4 G is a free win |

Expect the duplicates mostly in the `BCKUP*` family, `Copied to server/musicas` vs `MULTIMEDIA`,
and `Ante Maio2018` vs later backups. Movies are unlikely to duplicate.

## Context: why this matters now

The user plans to wipe the home server's NVMe (Samsung 980 PRO 1 TB) — which today is split
between Ubuntu and an unused Windows install — and reinstall Ubuntu over the **whole** disk,
with both SATA disks physically disconnected during the install. Before that, everything
worth keeping has to fit on the 1 TB external drive. Deduping first is what makes that fit
comfortable.

Measured sizes (2026-11-20, do not re-derive unless asked):

| Filesystem | Size | Used | Free |
| --- | --- | --- | --- |
| server `/` (nvme0n1p5, ext4) | 73 G | 39 G | 31 G |
| server `/home` (nvme0n1p7, ext4) | 378 G | 101 G | 258 G |
| laptop `/` (ext4) | 468 G | 163 G | 282 G |

`/home` breakdown: `pmpmt` 65 G (Documents 19 G of which `.backup_PC_cache` 11 G; `.config`
9.3 G; `.vscode` 8.7 G; Downloads 6 G; `python` venvs 5.6 G; `.cache` 5.5 G), Ollama weights
37 G (`/home/models/ollama`).
Backup sizing conclusion from that measurement: **~140 G of live data**, **~13 G of truly
irreplaceable data** once caches, venvs, editors and model weights are excluded. Recommended
target drive: 500 GB (they may reuse the existing 1 TB).

## Hardware facts (home server, `192.168.1.60`)

- Host `pmpmt-B550-AORUS-ELITE-V2`, Ubuntu 24.04, kernel 7.0.0-42, Ryzen 5 5600X, 15 GB RAM,
  RTX 3060 12 GB, Ollama 0.40.14 (weights `/home/models/ollama`, 100% GPU).
- SSH from the laptop: `ssh lan-pmpmt` (user `pmpmt`); storage user `pistore` exists but
  `/home/pistore` is not readable by `pmpmt`.
- **No passwordless sudo on the server.** Mounting NTFS, installing packages, partitioning —
  all of that is the user's action, not the agent's. Never claim root.
- Disks: `nvme0n1` (Samsung 980 PRO 1 TB: p1 efi, p2 16M, p3 464 G NTFS old Windows, p4 786M
  NTFS, p5 `/` 73 G, p6 swap 7.5 G, p7 `/home` 378 G), `sda` WD3200AZDX 298 G NTFS
  "Novo volume", `sdb` WD10PURZ 931 G NTFS "Dados". No USB storage currently attached.
- `sda`/`sdb` are in no fstab entry and are not mounted. NTFS is case-insensitive, so
  case-variant duplicates cannot exist there.

## Design already agreed in principle

Content-based, staged, and reversible:

1. **Preflight** — target must be a real mount (never `/`), writable, no files younger than
   10 min (something still copying), report free space.
2. **Scan** — one filesystem only; skip symlinks, hard-linked files, zero-byte files, and
   noise (`.git/objects`, `node_modules`, `snap`, `lost+found`, `$RECYCLE.BIN`,
   `System Volume Information`, `.thumbnails`); size floor 1 MB.
3. **Group** — three-stage filter: size bucket → hash first+last 64 KB → full SHA-256 only
   for survivors. Groups of identical (size, hash).
4. **Keeper** — `--keep <glob>` first, then shallowest depth, then oldest mtime, then shortest
   name. Everything else in the group is a candidate.
5. **Report** — always produced (CSV + summary): groups, bytes recoverable, keeper and why.
6. **Apply** — only with `--apply`: quarantine (`<root>/.dedupe/quarantine-<date>/`, same
   filesystem, instant, reversible) by default; `--delete` and `--link` are alternatives.
7. **Verify** — re-hash a random 5% of quarantined files against the keeper; abort and restore
   on any mismatch.
8. **Purge** — separate later run (`--purge-quarantine`) after the user has looked at it.

Non-negotiables: dry-run by default, `--delete` requires `--yes-i-have-a-backup`, nothing is
ever removed without a report, resumable SQLite index (interrupted = resume, not restart),
and the tool never follows a path out of the target filesystem.

## Decisions to confirm before coding

**DECIDED by the user 2026-11-21 — take these as final, do not re-ask:**

- action = **quarantine** (move to `<root>/.dedupe/quarantine-<date>/`, never delete)
- name sensitivity = **any identical content** counts as a duplicate
- size floor = **1 MB**
- scope = **several roots, one SQLite index**
- nothing is wiped; the drive's contents are kept; the goal is reclaimed space
- first run = **dry-run** over `/media/pmpmt/Elements`

| Decision | Options | Proposed default |
| --- | --- | --- |
| Duplicate action | quarantine / delete / hard-link | **quarantine** |
| Name sensitivity | any identical content vs identical name+content | **any** |
| Minimum file size | 1 MB / 10 MB / 100 MB | **1 MB** |
| Scope | one root per run vs several roots in one index | **several roots, one index** (catches dupes across drives) |

Also ask: filesystem of the 1 TB USB drive (exFAT has no hard links; NTFS is
case-insensitive), and which root paths the first run should cover — proposed: **the USB
drive only, `--dry-run`**, read the report, then decide about the SATA disks.

## Deliverable

`apps-scripts/file-dedupe/` (standalone project, not an agent job):

- `dedupe.py` — subcommands: `scan`, `report`, `apply`, `verify`, `purge`
- `test/` — fixture tree: exact duplicates, near-duplicates (1 byte different), hard links,
  symlinks, zero-byte, case variants, unreadable file, nested identical names
- `README.md` — exact commands, recovery steps
- a row in `docs/SCRIPTS.md` (section 3) — required by `scripts/check-registers.sh`

## Repo conventions the new session must respect

- Register anything new: `docs/SCRIPTS.md` for scripts, `agent/docs/runbooks/INDEX.md` for
  runbooks; `bash scripts/check-registers.sh` fails otherwise.
- Instruction docs under `agent/docs/**` and `docs/**` are protected from `/archive`
  (`~/.pi/scripts/protected-paths.txt`) — never rely on archiving them.
- Two hosts (laptop + VPS `neopmpmtj`) run the same repo. Persistence rules are in
  `agent/AGENTS.md`; verify with `bash scripts/check-host-parity.sh` and
  `bash scripts/sync-hosts.sh check|pull|push`. Commit and push when done.
- What may never be deleted: `agent/docs/runbooks/what-must-remain.md`.
- Style: short answers, files over chat for anything reusable, no claims of work not done.

## Next steps for the new session

### Done 2026-11-21

1. Read this file, `agent/docs/runbooks/what-must-remain.md`, `docs/SCRIPTS.md`.
2. Built `apps-scripts/file-dedupe/`: `dedupe.py` with `scan`, `report`, `apply`, `verify`,
   `restore`, `purge`; `tests/test_dedupe.py` (15 tests, `python3 -m unittest discover -s tests`);
   README with exact commands and recovery; `.gitignore`; row in `docs/SCRIPTS.md` section 3.
   Decisions taken as final (quarantine, name-insensitive, 1 MB floor, several roots / one
   index). `--min-size` defaults to 1 MiB; the index and quarantine live in `<root>/.dedupe/`.
   `bash scripts/check-registers.sh` passes.
3. Attempted the first real dry run — **blocked, the drive is not attached**:
   `ls /dev/sd*` → no such file, `lsblk` → only `nvme0n1`, `/media/pmpmt/Elements` absent.
   Nothing was read or written on the drive.

### Still to do

1. Plug in and unlock the WD Elements (`sudo cryptsetup open --type bitlk /dev/sdc1 wd2tb`,
   then mount; the user's action), confirm `mount | grep Elements` and `df -h`.
2. `cd ~/.pi/apps-scripts/file-dedupe && python3 dedupe.py scan --root /media/pmpmt/Elements`
   (the 10-minute freshness guard will abort if a copy is still running — that is intended).
3. Present `summary.md` + `duplicates.csv`, then wait for approval before any `--apply`.

## Original next steps (superseded by the section above, kept for reference)

1. Read this file, `agent/docs/runbooks/what-must-remain.md` (scope of "never delete")
   and `docs/SCRIPTS.md` (where scripts live).
2. Confirm the four decisions above and the two open questions.
3. Write `apps-scripts/file-dedupe/` with tests; run `npm test`-independent tests
   (`python3 -m pytest` or plain `unittest`) plus `bash scripts/check-registers.sh`.
4. First real action: `--dry-run` against the USB drive, present the report, wait for approval
   before any `--apply`.
