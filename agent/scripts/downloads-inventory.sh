#!/usr/bin/env bash
# downloads-inventory.sh — inventory a remote download folder and group its files by type.
#
#   ./downloads-inventory.sh [host] [remote-dir]
#   ./downloads-inventory.sh                            # lan-pmpmt:/home/pmpmt/Downloads
#   ./downloads-inventory.sh lan-storage /home/pistore/storage
#
# Read-only: one `find` over ssh; classification and formatting are local awk. Prints markdown.
# Deterministic output (groups in a fixed order, subfolders and paths sorted).
set -euo pipefail

HOST="${1:-lan-pmpmt}"
SRC="${2:-/home/pmpmt/Downloads}"

ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST" \
  "find '$SRC' -type f -printf '%s\t%p\n'" |
awk -F'\t' -v SRC="$SRC" -v HOST="$HOST" '
BEGIN {
  n = split("Cursor update files|Other installers|Archives|Spreadsheets|Documents (PDF)|Word documents|Markdown & notes|Config, data & scripts|Images|Audio|Video|Stickers|Other / unclassified", ORDER, "|")
  for (i = 1; i <= n; i++) GRP[i] = ORDER[i]
  MAXLIST = 40                                    # max individual paths per (group, folder)
  nb = split("openclaw-docs-main|Telegram Desktop", BL, "|")
  for (i = 1; i <= nb; i++) BULKY[BL[i]] = 1       # bulk trees: always summarised
  MAXDUP = 20
}

function human(b,   u, i) {
  split("B KB MB GB TB", u, " ")
  i = 1
  while (b >= 1024 && i < 5) { b /= 1024; i++ }
  return (i == 1) ? sprintf("%d %s", b, u[i]) : sprintf("%.1f %s", b, u[i])
}

function classify(name,   l) {
  l = tolower(name)
  if (l ~ /^cursor[-_].*\.(deb|appimage)$/)            return "Cursor update files"
  if (l ~ /\.(deb|appimage|rpm)$/)                     return "Other installers"
  if (l ~ /\.(zip|tar\.gz|tgz|tar\.xz|7z|rar)$/)       return "Archives"
  if (l ~ /\.(xlsx|xls|csv|ods)$/)                     return "Spreadsheets"
  if (l ~ /\.pdf$/)                                    return "Documents (PDF)"
  if (l ~ /\.(docx|doc|odt|pptx|rtf)$/)                return "Word documents"
  if (l ~ /\.(md|mdx|txt)$/)                           return "Markdown & notes"
  if (l ~ /\.(json|jsonl|ya?ml|service|sh|js|css|crt|url|download)$/) return "Config, data & scripts"
  if (l ~ /\.(png|jpe?g|webp|svg|gif|bmp|tiff?)$/)     return "Images"
  if (l ~ /\.(ogg|mp3|m4a|wav|flac|opus)$/)            return "Audio"
  if (l ~ /\.(mp4|mkv|webm|mov|avi)$/)                 return "Video"
  if (l ~ /\.tgs$/)                                    return "Stickers"
  return "Other / unclassified"
}

# insertion sort of LIST[1..c] in place
function isort(LIST, c,   i, j, t) {
  for (i = 2; i <= c; i++) {
    t = LIST[i]
    for (j = i - 1; j >= 1 && LIST[j] > t; j--) LIST[j + 1] = LIST[j]
    LIST[j + 1] = t
  }
  return c
}

{
  size = $1; path = $2
  sub("^" SRC "/", "", path)
  if (path == "" || path == SRC) next
  split(path, parts, "/")
  name = parts[length(parts)]
  sub_ = (length(parts) > 1) ? parts[1] : ""

  g = classify(name)
  key = g SUBSEP sub_

  if (!(key in SEEN)) { SEEN[key] = 1; SUBKEY[++NSUB] = key; if (!(sub_ in SUBSEEN)) { SUBSEEN[sub_] = 1; SUBS[++NSUBS] = sub_ } }
  FILES[key, ++COUNT[key]] = sprintf("%s\t%d", path, size)
  BYTES[key] += size
  GTOTAL[g] += size; GCOUNT[g]++
  TOTAL += size; N++
  if (!(g in GSEEN)) { GSEEN[g] = 1; GLIST[++NGL] = g }

  if (sub_ != "") {
    DIRCOUNT[sub_]++
    DIRBYTES[sub_] += size
  }
  if (!(sub_ in BULKY)) {                        # bulk trees are skipped for dupe/stem reports
    dir = path; if (path !~ /\//) dir = ""; else sub(/\/[^\/]*$/, "", dir)
    NAMECNT[dir SUBSEP name]++
    NAMEPATH[dir SUBSEP name, NAMECNT[dir SUBSEP name]] = path
    NAMESIZE[dir SUBSEP name, NAMECNT[dir SUBSEP name]] = size
    if (name ~ /\./) {
      st = name; sub(/\.[^.]*$/, "", st)
      ex = name; sub(/.*\./, "", ex)
      EXTS[dir SUBSEP st, tolower(ex)] = 1
      if (!((dir SUBSEP st) in STSEEN)) { STSEEN[dir SUBSEP st] = 1; STEMS[++nst] = dir SUBSEP st }
    }
  }

  if (tolower(name) ~ /^(client_secret.*\.json|cookies.*\.txt|.*recovery[-_]?(key|codes).*|.*backup[-_]?codes.*|.*api[-_]?key.*|\..*env|credentials.*\.json|id_(rsa|ed25519).*)$/ ||
      tolower(name) ~ /\.(crt|pem|key|p12|pfx)$/)
    SECRET[++SCOUNT] = sprintf("%s\t%d", path, size)
}

END {
  printf "# Inventory: %s:%s\n\n", HOST, SRC
  printf "**%d files, %d types, %s total** — generated %s\n\n", N, NGL, human(TOTAL), strftime("%Y-%m-%d %H:%M %Z")

  print "## Totals by type (whole tree)\n"
  print "| Type | Files | Size |"
  print "| --- | ---: | ---: |"
  for (i = 1; i <= NGL; i++) {
    g = GRP[i]
    if (!(g in GCOUNT)) continue
    printf "| %s | %d | %s |\n", g, GCOUNT[g], human(GTOTAL[g])
  }
  printf "| **total** | **%d** | **%s** |\n\n", N, human(TOTAL)

  c = isort(SUBS, NSUBS)
  print "## Folders (top level)\n"
  print "| Folder | Files | Size |"
  print "| --- | ---: | ---: |"
  for (i = 1; i <= c; i++) printf "| %s | %d | %s |\n", SUBS[i], DIRCOUNT[SUBS[i]], human(DIRBYTES[SUBS[i]])
  print ""

  print "## Files by type\n"
  print "Bulk trees (" BL[1] ", " BL[2] ") are summarised; a folder with more than " MAXLIST " files of one type is summarised too.\n"

  for (i = 1; i <= n; i++) {
    g = GRP[i]
    if (!(g in GCOUNT)) continue
    printf "### %s — %d file%s, %s\n\n", g, GCOUNT[g], (GCOUNT[g] == 1 ? "" : "s"), human(GTOTAL[g])

    # folders for this group: top level (empty) first, then sorted
    ns = 0
    for (k = 1; k <= NSUB; k++) {
      split(SUBKEY[k], kv, SUBSEP)
      if (kv[1] != g) continue
      if (kv[2] != "") SUBOUTL[++ns] = kv[2]
    }
    isort(SUBOUTL, ns)
    if ((g SUBSEP "") in SEEN) { for (k = ns; k >= 1; k--) SUBOUTL[k + 1] = SUBOUTL[k]; SUBOUTL[1] = ""; ns++ }

    for (j = 1; j <= ns; j++) {
      sub_ = SUBOUTL[j]
      key = g SUBSEP sub_
      cnt = COUNT[key]
      if (sub_ == "" || (cnt <= MAXLIST && !(sub_ in BULKY))) {
        nl = 0
        for (m = 1; m <= cnt; m++) { split(FILES[key, m], f, "\t"); LINE[++nl] = sprintf("%s\t%s", f[1], human(f[2])) }
        isort(LINE, nl)
        for (m = 1; m <= nl; m++) { split(LINE[m], lg, "\t"); printf "- `%s` (%s)\n", lg[1], lg[2] }
        delete LINE
      } else {
        printf "- `%s/` — %d file%s, %s (not listed)\n", sub_, cnt, (cnt == 1 ? "" : "s"), human(BYTES[key])
      }
    }
    print ""
  }

  # duplicates / near-duplicates inside a single folder
  nd = 0
  for (key in NAMECNT) if (NAMECNT[key] > 1) nd++
  if (nd) {
    print "## Same filename in the same directory (review before cleaning)\n"
    shown = 0
    for (key in NAMECNT) {
      if (NAMECNT[key] <= 1) continue
      if (shown++ >= MAXDUP) { print "- ... more, list truncated"; break }
      split(key, kv, SUBSEP)
      printf "- `%s` × %d:\n", kv[2], NAMECNT[key]
      for (j = 1; j <= NAMECNT[key]; j++) printf "  - `%s` (%s)\n", NAMEPATH[key, j], human(NAMESIZE[key, j])
    }
    print ""
  }

  c3 = isort(STEMS, nst)
  first = 1
  for (i = 1; i <= c3; i++) {
    sk = STEMS[i]; c2 = 0
    for (e in EXTS) { split(e, ee, SUBSEP); if (ee[1] SUBSEP ee[2] == sk) TMP[++c2] = ee[3] }
    if (c2 < 2) { delete TMP; continue }
    isort(TMP, c2)
    if (first) { print "## Same name, several formats\n"; first = 0 }
    split(sk, sp, SUBSEP)
    pre = (sp[1] == "") ? "" : sp[1] "/"
    line = ""
    for (j = 1; j <= c2; j++) line = line (j > 1 ? ", " : "") TMP[j]
    printf "- `%s%s` — %s\n", pre, sp[2], line
    delete TMP
  }
  if (!first) print ""

  if (SCOUNT) {
    nc = isort(SECRET, SCOUNT)
    print "## Sensitive files (keys, cookies, recovery codes, client secrets)\n"
    for (i = 1; i <= nc; i++) {
      split(SECRET[i], f, "\t")
      split(f[1], pp, "/")
      if (pp[1] in BULKY) continue
      printf "- `%s` (%s)\n", f[1], human(f[2])
    }
    print ""
  }
}
'
