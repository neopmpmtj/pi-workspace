#! /usr/bin/env python3
"""Draw a high-level backbone diagram of a repository, as an SVG.

The picture is a spine: one vertebra per top-level entry, sorted by weight, with a
proportional bar for the number of files git tracks under it and a preview of its
children. Entries git does not track (ignored scratch dirs, empty dirs) are drawn
hollow so the diagram never overstates what is actually in the repository.

Stdlib only. Output is deterministic: no timestamps, no randomness, entries sorted.

Usage:
    python3 repo-backbone.py                                  # current git repo -> repo-backbone.svg
    python3 repo-backbone.py --root ~/.pi --depth 3
    python3 repo-backbone.py --root . --sort name --out /tmp/backbone.svg
    python3 repo-backbone.py --root . --depth 0 --exclude z.old,logs
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------- geometry ----

WIDTH = 1180
MARGIN = 48
HEADER_H = 158
FOOTER_H = 62

SPINE_X = 118
NODE_R = 7.0
BRANCH_END = 172
LABEL_X = 184
BAR_X, BAR_MAX_W, BAR_H = 604, 250, 8
COUNT_X = BAR_X + BAR_MAX_W + 16

FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
UI_FONT = "Inter, Helvetica, Arial, sans-serif"

BG_TOP, BG_BOTTOM = "#0a0e1c", "#131a33"
INK, MUTED, FAINT = "#eaf0ff", "#8ea2c9", "#5a6b8c"
ACCENT, ACCENT_2 = "#4cc9f0", "#f72585"
UNTRACKED_STROKE = "#6b7ea6"
NODE_FILL = "#0f1730"

# ------------------------------------------------------------------- model ----


@dataclass
class Entry:
    """One top-level entry of the repository."""

    name: str
    kind: str  # "dir" | "file"
    tracked: int = 0
    children: list[str] = field(default_factory=list)
    nested_repo: bool = False
    ignored: bool = False

    @property
    def is_tracked(self) -> bool:
        return self.tracked > 0

    @property
    def notes(self) -> list[str]:
        """Short truths about this entry, shown under its name."""
        out: list[str] = []
        if self.nested_repo:
            out.append("own git repo")
        if self.ignored:
            out.append("git-ignored")
        return out

    @property
    def status(self) -> str:
        if self.is_tracked:
            return str(self.tracked)
        return "ignored" if self.ignored else "untracked"


def git_tracked(root: Path) -> tuple[Counter[str], int] | None:
    """Tracked file count per top-level entry, plus the total. None if not a repo."""
    try:
        proc = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z"],
            capture_output=True,
            check=False,
        )
    except (OSError, ValueError):
        return None
    if proc.returncode != 0:
        return None

    counts: Counter[str] = Counter()
    total = 0
    for raw in proc.stdout.split(b"\0"):
        if not raw:
            continue
        path = raw.decode("utf-8", "surrogateescape")
        top = path.split("/", 1)[0]
        counts[top] += 1
        total += 1
    return counts, total


def git_ignored(root: Path, names: list[str]) -> set[str]:
    """Which of the given top-level names git ignores. Empty set if not a repo."""
    if not names:
        return set()
    try:
        proc = subprocess.run(
            ["git", "-C", str(root), "check-ignore", "--stdin"],
            input="\n".join(names),
            capture_output=True,
            text=True,
            check=False,
        )
    except (OSError, ValueError):
        return set()
    ignored = set()
    for line in proc.stdout.splitlines():
        top = line.strip().split("/", 1)[0]
        if top in names:
            ignored.add(top)
    return ignored


def collect_entries(
    root: Path, depth: int, exclude: set[str], include_hidden: bool = False
) -> list[Entry]:
    """Top-level entries of root, annotated with tracked counts and child previews."""
    tracked = git_tracked(root)
    counts, _total = tracked if tracked else (Counter(), 0)

    candidates: list[Path] = []
    for child in sorted(root.iterdir(), key=lambda p: p.name):
        name = child.name
        if name in exclude or name == ".git":
            continue
        if not include_hidden and name.startswith("."):
            continue
        candidates.append(child)

    ignored = git_ignored(root, [c.name for c in candidates])

    entries: list[Entry] = []
    for child in candidates:
        name = child.name
        kind = "dir" if child.is_dir() else "file"
        previews: list[str] = []
        if kind == "dir" and depth > 0:
            try:
                kids = sorted(
                    (
                        p
                        for p in child.iterdir()
                        if p.name != ".git" and (include_hidden or not p.name.startswith("."))
                    ),
                    key=lambda p: (not p.is_dir(), p.name),
                )
            except OSError:
                kids = []
            previews = [k.name for k in kids[:depth]]
            if len(kids) > depth:
                previews.append(f"+{len(kids) - depth}")
        entries.append(
            Entry(
                name=name,
                kind=kind,
                tracked=counts.get(name, 0),
                children=previews,
                nested_repo=(child / ".git").exists(),
                ignored=name in ignored,
            )
        )
    return entries


def sort_entries(entries: list[Entry], mode: str) -> list[Entry]:
    if mode == "name":
        return sorted(entries, key=lambda e: (e.kind != "dir", e.name.lower()))
    return sorted(entries, key=lambda e: (-e.tracked, e.kind != "dir", e.name.lower()))


# -------------------------------------------------------------- rendering -----


def esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def render(
    entries: list[Entry],
    *,
    root_label: str,
    root_path: str,
    repo_label: str,
    total_tracked: int,
    show_children: bool,
) -> str:
    rows = len(entries)
    row_h = 66 if show_children else 46
    body_top = HEADER_H
    height = HEADER_H + max(rows, 1) * row_h + FOOTER_H

    max_tracked = max((e.tracked for e in entries), default=0) or 1
    untracked = sum(1 for e in entries if not e.is_tracked)
    dirs = sum(1 for e in entries if e.kind == "dir")

    spine_top = body_top - 22
    spine_bottom = body_top + rows * row_h - 10
    parts: list[str] = []

    add = parts.append

    add(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {height}" '
        f'width="{WIDTH}" height="{height}" role="img" '
        f'aria-label="Repository backbone: {esc(root_label)}">'
    )
    add(f"  <title>{esc(root_label)} — repo backbone</title>")
    add("  <defs>")
    add(
        '    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">'
        f'<stop offset="0%" stop-color="{BG_TOP}"/>'
        f'<stop offset="100%" stop-color="{BG_BOTTOM}"/></linearGradient>'
    )
    add(
        '    <linearGradient id="spine" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0%" stop-color="{ACCENT}" stop-opacity="0.85"/>'
        f'<stop offset="55%" stop-color="{ACCENT_2}" stop-opacity="0.55"/>'
        f'<stop offset="100%" stop-color="{ACCENT_2}" stop-opacity="0.12"/></linearGradient>'
    )
    add(
        '    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">'
        f'<stop offset="0%" stop-color="{ACCENT}"/>'
        f'<stop offset="100%" stop-color="{ACCENT_2}"/></linearGradient>'
    )
    add(
        '    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">'
        '<feGaussianBlur stdDeviation="4" result="b"/>'
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    )
    add("  </defs>")

    add(f'  <rect width="{WIDTH}" height="{height}" fill="url(#bg)"/>')

    # ---- header
    add(f'  <g font-family="{UI_FONT}">')
    add(
        f'    <text x="{MARGIN}" y="52" font-size="11" letter-spacing="3.2" '
        f'fill="{ACCENT}" opacity="0.9">REPO BACKBONE</text>'
    )
    add(
        f'    <text x="{MARGIN}" y="90" font-size="30" font-weight="700" '
        f'fill="{INK}">{esc(root_label)}</text>'
    )
    add(
        f'    <text x="{MARGIN}" y="115" font-size="12.5" fill="{MUTED}" '
        f'font-family="{FONT}">{esc(truncate(root_path, 74))}</text>'
    )
    stats = [
        (f"{rows}", "top-level entries"),
        (f"{dirs}", "directories"),
        (f"{total_tracked}", "files tracked by git"),
        (f"{untracked}", "not tracked"),
    ]
    sx = WIDTH - MARGIN
    for i, (value, label) in enumerate(reversed(stats)):
        x = sx - i * 172
        add(
            f'    <text x="{x}" y="74" text-anchor="end" font-size="26" '
            f'font-weight="700" fill="{INK}">{value}</text>'
        )
        add(
            f'    <text x="{x}" y="96" text-anchor="end" font-size="11" '
            f'fill="{MUTED}">{esc(label)}</text>'
        )
    add("  </g>")
    add(f'  <line x1="{MARGIN}" y1="{HEADER_H - 26}" x2="{WIDTH - MARGIN}" '
        f'y2="{HEADER_H - 26}" stroke="{INK}" stroke-opacity="0.10"/>')

    # ---- spine
    add(
        f'  <rect x="{SPINE_X - 5}" y="{spine_top}" width="10" '
        f'height="{spine_bottom - spine_top}" rx="5" fill="url(#spine)"/>'
    )

    # ---- rows
    for i, entry in enumerate(entries):
        y = body_top + i * row_h + row_h / 2
        hollow = not entry.is_tracked
        add(f'  <g font-family="{FONT}">')
        # branch from spine to label
        add(
            f'    <line x1="{SPINE_X + NODE_R}" y1="{y}" x2="{BRANCH_END}" y2="{y}" '
            f'stroke="{UNTRACKED_STROKE if hollow else ACCENT}" '
            f'stroke-opacity="{0.35 if hollow else 0.7}" stroke-width="1.5"'
            + (' stroke-dasharray="3 4"' if hollow else "")
            + "/>"
        )
        # vertebra
        if hollow:
            add(
                f'    <circle cx="{SPINE_X}" cy="{y}" r="{NODE_R}" fill="{BG_TOP}" '
                f'stroke="{UNTRACKED_STROKE}" stroke-width="2"/>'
            )
        else:
            add(
                f'    <circle cx="{SPINE_X}" cy="{y}" r="{NODE_R}" fill="{NODE_FILL}" '
                f'stroke="{ACCENT}" stroke-width="2" filter="url(#glow)"/>'
            )
        # name
        name_fill = INK if entry.is_tracked else MUTED
        weight = "600" if entry.kind == "dir" else "400"
        style = "" if entry.kind == "dir" else ' font-style="italic"'
        add(
            f'    <text x="{LABEL_X}" y="{y + 5}" font-size="15" font-weight="{weight}"'
            f'{style} fill="{name_fill}">{esc(truncate(entry.name, 44))}</text>'
        )
        # second line: notes about the entry, then a preview of its children
        notes = entry.notes
        kids = " · ".join(entry.children)
        if show_children and (notes or kids):
            spans = ""
            if notes:
                spans += (
                    f'<tspan fill="{ACCENT}" opacity="0.85">'
                    f"{esc(' · '.join(notes))}</tspan>"
                )
            if notes and kids:
                spans += f'<tspan fill="{FAINT}"> · </tspan>'
            if kids:
                spans += f'<tspan fill="{FAINT}">{esc(truncate(kids, 46))}</tspan>'
            add(
                f'    <text x="{LABEL_X}" y="{y + 24}" font-size="11.5">{spans}</text>'
            )
        # weight bar
        pinned = entry.tracked / max_tracked
        bar_w = 0.0 if hollow else max(3.0, BAR_MAX_W * pinned)
        add(
            f'    <rect x="{BAR_X}" y="{y - BAR_H / 2}" width="{BAR_MAX_W}" '
            f'height="{BAR_H}" rx="{BAR_H / 2}" fill="{INK}" opacity="0.06"/>'
        )
        if bar_w:
            add(
                f'    <rect x="{BAR_X}" y="{y - BAR_H / 2}" width="{bar_w:.1f}" '
                f'height="{BAR_H}" rx="{BAR_H / 2}" fill="url(#bar)" opacity="0.9"/>'
            )
        count_text = entry.status
        add(
            f'    <text x="{COUNT_X}" y="{y + 4.5}" font-size="12" '
            f'fill="{MUTED if hollow else INK}">{esc(count_text)}</text>'
        )
        add("  </g>")

    # ---- footer / legend
    fy = height - FOOTER_H + 34
    add(f'  <g font-family="{UI_FONT}" font-size="11.5" fill="{MUTED}">')
    add(
        f'    <circle cx="{MARGIN + 6}" cy="{fy - 4}" r="6" fill="{NODE_FILL}" '
        f'stroke="{ACCENT}" stroke-width="2"/>'
    )
    add(f'    <text x="{MARGIN + 22}" y="{fy}">tracked by git</text>')
    add(
        f'    <circle cx="{MARGIN + 156}" cy="{fy - 4}" r="6" fill="{BG_TOP}" '
        f'stroke="{UNTRACKED_STROKE}" stroke-width="2"/>'
    )
    add(f'    <text x="{MARGIN + 172}" y="{fy}">not tracked (ignored or empty)</text>')
    add(
        f'    <text x="{MARGIN + 400}" y="{fy}" opacity="0.75">bar = files tracked, '
        f'scaled to {max_tracked}</text>'
    )
    add(
        f'    <text x="{WIDTH - MARGIN}" y="{fy}" text-anchor="end" '
        f'opacity="0.6">{esc(repo_label)}</text>'
    )
    add("  </g>")

    add("</svg>")
    return "\n".join(parts) + "\n"


# -------------------------------------------------------------------- cli -----


def resolve_root(raw: str) -> Path:
    root = Path(raw).expanduser().resolve()
    if not root.is_dir():
        raise SystemExit(f"not a directory: {root}")
    return root


def repo_label_for(root: Path) -> str:
    try:
        proc = subprocess.run(
            ["git", "-C", str(root), "config", "--get", "remote.origin.url"],
            capture_output=True,
            text=True,
            check=False,
        )
    except (OSError, ValueError):
        return "no git remote"
    url = proc.stdout.strip()
    if proc.returncode != 0 or not url:
        return "no git remote"
    label = url.rstrip("/").removesuffix(".git")
    return label.split("//")[-1].replace(":", "/", 1) if "//" in label else label


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Draw a high-level backbone of a repository.")
    ap.add_argument("--root", default=".", help="repository root (default: .)")
    ap.add_argument(
        "--out",
        default=str(Path(__file__).with_name("repo-backbone.svg")),
        help="output SVG (default: repo-backbone.svg beside this script)",
    )
    ap.add_argument(
        "--depth", type=int, default=3, help="children to preview per entry (0 = none)"
    )
    ap.add_argument(
        "--sort", choices=("weight", "name"), default="weight", help="row order"
    )
    ap.add_argument("--exclude", default="", help="comma-separated names to skip")
    ap.add_argument(
        "--list", action="store_true", help="print the table to stdout, write no SVG"
    )
    ap.add_argument(
        "--include-hidden",
        action="store_true",
        help="include dotfiles and dot-directories (skipped by default)",
    )
    args = ap.parse_args(argv)

    root = resolve_root(args.root)
    exclude = {n.strip() for n in args.exclude.split(",") if n.strip()}

    entries = collect_entries(root, max(args.depth, 0), exclude, args.include_hidden)
    if not entries:
        raise SystemExit(f"nothing to draw in {root}")
    entries = sort_entries(entries, args.sort)

    tracked = git_tracked(root)
    total_tracked = tracked[1] if tracked else 0

    if args.list:
        name_w = max(len(e.name) for e in entries)
        for e in entries:
            kids = "  " + " · ".join(e.children) if e.children else ""
            notes = " [" + ", ".join(e.notes) + "]" if e.notes else ""
            print(f"{e.name:<{name_w}}  {e.kind:<4}  {e.status:>9}{notes}{kids}")
        print(
            f"{len(entries)} entries, {total_tracked} tracked files, "
            f"{sum(1 for e in entries if not e.is_tracked)} not tracked"
        )
        return 0

    svg = render(
        entries,
        root_label=root.name,
        root_path=str(root),
        repo_label=repo_label_for(root),
        total_tracked=total_tracked,
        show_children=args.depth > 0,
    )

    # never write a file a renderer would reject
    ET.fromstring(svg)

    out = Path(args.out).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg, encoding="utf-8")

    print(
        f"{out} ({out.stat().st_size} bytes) — {len(entries)} entries, "
        f"{total_tracked} tracked files, "
        f"{sum(1 for e in entries if not e.is_tracked)} not tracked"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
