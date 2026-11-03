# Inventory: `/home/pmpmt` on the LAN server (2025-11-03)

Read-only survey taken with `sudo` over SSH, before any file is moved. Server
`192.168.1.60`, `/home` = `/dev/nvme0n1p7` ext4 **378 GB, 318 GB free**.

## Headline

| Bucket | Size | Note |
| --- | --- | --- |
| `/home/pmpmt` total | **42 GB** | of which ~14 GB is genuinely user data, the rest dev caches and archives |
| `Documents` | 14 GB | `All Documents` 8.3 GB, `.backup_PC_cache` 4.9 GB, two tool backups 317 MB |
| `Downloads` | 6.4 GB | `#Arquive_Downloads` 6.1 GB (125 files, 33 Cursor installers), loose invoices/PDFs |
| dev caches | ~17 GB | `.config` 6.9 GB (Cursor 4.6, Code 1.8), `.cache` 2.6, `.vscode` 2.3, `.docker` 2.3, `snap` 3.5, `.local` 1.0, `.copilot` 616 M, `.nvm` 431 M, `.npm` 294 M |
| `apps` | 225 MB | `U-speech-to-text` 183 M, `text_rewrite` 42 M |
| `Desktop` | 18 MB | `backup_laptop_tool` 18 M |
| media | 1.49 GB | 18 videos, mostly `yt-downloader` outputs |

Largest single files: PC backup tarballs 4.7 GB and 1.8 GB, then a stack of Cursor
`*.deb`/`*.AppImage` at ~170–290 MB each (versions 2.1 → 3.7).

Installed today: `cursor 3.7.36`, `docker-desktop 4.61.0` — so every other Cursor installer in
`#Arquive_Downloads` is superseded.

## Batch A — reclaim by moving, nothing deleted (13.7 GB)

Manifests on the server in `/home/pistore/storage/.manifests/`:

| Manifest | Files | Size | Destination |
| --- | --- | --- | --- |
| `stale-installers.txt` | 33 | 5.61 GB | `/home/pistore/storage/installers/` |
| `backups.txt` | 4 | 6.64 GB | `/home/pistore/storage/backups/` |
| `media.txt` | 18 | 1.49 GB | `/home/pistore/storage/media/` |

Contents in one line each:

- **stale-installers** — every `cursor_*.deb` and `Cursor-*.AppImage` in
  `#Arquive_Downloads` except `cursor_3.7.36_amd64.deb` (the installed one), plus
  `docker-desktop-amd64.deb`.
- **backups** — the PC backup tarballs in `Documents/.backup_PC_cache/` (4.7 GB + 295 MB) and the
  older one inside `cursor_scripts_python/code_arquive/…/.backup_cache/` (1.8 GB).
- **media** — the 18 video files under the `yt-downloader` tree and elsewhere in the home.

Two caveats, both real:

1. The `yt-downloader` app may resolve its library relative to its own folder; moving `media/`
   breaks nothing on disk but the app's library view until its path is updated or symlinked.
2. A backup tool that writes into `Documents/.backup_PC_cache/` will recreate the directory on its
   next run; that is fine, it just stops being 4.9 GB of local disk.

## Batch B — structure (needs labels from the user)

Proposed shape under `/home/pistore/storage` (one tree, mountable as a share later):

```
home/            ← moved user data
  backups/         PC + VPS backups, db dumps
  installers/      current-only installers
  media/           videos, images
  archive/         #Arquive_Downloads remainder, code_arquive
  docs/            business documents: invoices, extractos, contracts, CVs
projects/        ← active code, symlinked or moved by hand
```

Open questions: what the `#` prefix means (in-progress vs archived), whether
`cursor_scripts_python` is one project or many, and whether business documents are organised by
year, by client, or both.

## Protocol for every batch

- Manifest generated first, totals reviewed, then `rsync -a` with the manifest as the file list.
- Verify per batch: file count and byte total compared before/after; nothing removed from the
  source until the destination matches.
- Every moved path appended to `/home/piadmin/moves.log` (source, destination, timestamp) so an
  undo is a loop over the log.
- Nothing deleted at all in batches A and B. Deletions, if ever, go to
  `/home/pistore/trash/<date>/<original-path>` and wait for explicit approval.

## How this inventory was taken

```bash
ssh lan-storage 'sudo -n du -h -d1 /home/pmpmt | sort -h | tail -25'
ssh lan-storage 'sudo -n ls -la /home/pmpmt'
ssh lan-storage 'sudo -n find /home/pmpmt -xdev -not -path "*/.*" -type f -printf "%s\t%p\n" | sort -rn | head -20'
ssh lan-storage 'sudo -n find <dir> -maxdepth 1 -type f -iname "cursor_*" -printf "%s\t%p\n"'
```
