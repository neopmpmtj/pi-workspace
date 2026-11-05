#! /usr/bin/env python3
"""Draw the path one message travels from entry to the model, as an SVG.

The trace is derived from the real agent home, not from memory: it reads
`settings.json` (which extensions load, in what order), `~/.pi/config.json` (which
classifiers are enabled and whether they print), and each extension's own source
(which hooks it registers, whether it can end a turn, which hidden block it attaches).

Nothing is hardcoded about this agent except the order pi itself guarantees, so the
picture follows the config: switch a classifier off and it is drawn switched off.

Stdlib only. Output is deterministic: no timestamps, settings order preserved.

Usage:
    python3 input-path.py                       # this agent home -> input-path.svg
    python3 input-path.py --list                # print the stations, write nothing
    python3 input-path.py --agent-home ~/.pi/agent-x/x --config ~/.pi/config.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------- geometry ----

WIDTH = 1240
MARGIN = 48
HEADER_H = 168
FOOTER_H = 96

RAIL_X = 182
CARD_X = 248
CARD_W = WIDTH - CARD_X - MARGIN
CARD_H = 78
GAP = 14
ROW_H = CARD_H + GAP
PHASE_H = 44

FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
UI_FONT = "Inter, Helvetica, Arial, sans-serif"
CHIP_FONT = 10.5
CHIP_PAD = 9
CHIP_CHAR = 6.3

BG_TOP, BG_BOTTOM = "#0a0e1c", "#121a30"
INK, MUTED, FAINT = "#eaf0ff", "#8ea2c9", "#5a6b8c"
CARD_FILL, CARD_STROKE = "#111a31", "#22314f"

PHASES = {
    "entry": ("#4cc9f0", "ENTRY"),
    "input": ("#f72585", "INPUT HOOK"),
    "before": ("#ffb703", "BEFORE_AGENT_START"),
    "request": ("#57cc99", "REQUEST"),
    "return": ("#9f7aea", "RETURN TRIP"),
}
DANGER = "#f72585"

# ------------------------------------------------------------------- model ----


@dataclass
class Station:
    """One stop on the path."""

    phase: str
    title: str
    path: str
    note: str = ""
    chips: list[tuple[str, str]] = field(default_factory=list)  # (text, kind)
    may_end_turn: bool = False


def camel(stem: str) -> str:
    """input-contains-email -> inputContainsEmail."""
    head, *rest = stem.split("-")
    return head + "".join(part[:1].upper() + part[1:] for part in rest)


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


# ------------------------------------------------------------------ inputs ----


def load_json(path: Path, what: str) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise SystemExit(f"cannot read {what} at {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{what} at {path} is not valid JSON: {exc}") from exc


def config_entry(config: dict, name: str) -> tuple[str, dict | None]:
    """The config.json key and object that governs an extension, matched by name."""
    for key, value in config.items():
        if norm(key) == norm(name) and isinstance(value, dict):
            return key, value
    return "", None


HOOKS = (
    "input",
    "before_agent_start",
    "before_provider_request",
    "tool_result",
    "tool_call",
    "context",
    "session_start",
)


def scan_extension(file: Path) -> dict:
    """What an extension registers and what it is allowed to do, read from its source."""
    try:
        text = file.read_text(encoding="utf-8")
    except OSError:
        return {"hooks": set(), "handled": False, "print": False, "custom_types": []}
    return {
        "hooks": {h for h in HOOKS if f'pi.on("{h}"' in text},
        "handled": 'action: "handled"' in text,
        "print": "print" in text,
        "custom_types": re.findall(r'customType:\s*"([^"]+)"', text),
    }


def extension_name(entry: str) -> str:
    """Human name of a settings.json extension entry: dir name, or file stem."""
    raw = Path(entry.lstrip("+"))
    if raw.name == "index.ts":
        return raw.parent.name
    return raw.stem


def extension_file(path: str, agent_home: Path) -> Path | None:
    """Resolve a settings.json extensions entry to the file it loads."""
    candidate = Path(path.lstrip("+"))
    if not candidate.is_absolute():
        candidate = agent_home / candidate
    if candidate.is_file():
        return candidate
    index = candidate / "index.ts"
    return index if index.is_file() else None


# ------------------------------------------------------------------ build -----


def build_stations(agent_home: Path, config: dict, settings: dict) -> list[Station]:
    stations: list[Station] = []
    loaded = [p for p in settings.get("extensions", []) if isinstance(p, str)]

    scanned: list[tuple[str, Path, dict]] = []
    for entry in loaded:
        file = extension_file(entry, agent_home)
        if file is None:
            continue
        scanned.append((entry, file, scan_extension(file)))

    input_exts = [s for s in scanned if "input" in s[2]["hooks"]]
    before_exts = [s for s in scanned if "before_agent_start" in s[2]["hooks"]]
    provider_exts = [s for s in scanned if "before_provider_request" in s[2]["hooks"]]
    tool_result_exts = [s for s in scanned if "tool_result" in s[2]["hooks"]]

    bridge = agent_home / "npm" / "node_modules" / "@llblab" / "pi-telegram" / "package.json"
    has_bridge = bridge.is_file()

    # -- entry ------------------------------------------------------------------
    stations.append(
        Station(
            phase="entry",
            title="message enters",
            path="TUI keystroke · pi -p prompt"
            + (" · Telegram (@llblab/pi-telegram)" if has_bridge else ""),
            note="a Telegram message arrives with a `[telegram…]` prefix, which later hooks can detect",
            chips=[("one string", "muted")],
        )
    )
    stations.append(
        Station(
            phase="entry",
            title="pi core: input dispatch",
            path="extension event `input` · handlers run in settings.json load order",
            note="text starting with / goes to a command, not a turn · a handler may answer continue or handled",
            chips=[("handler order = load order", "muted")],
        )
    )

    # -- input hooks ------------------------------------------------------------
    if not input_exts:
        stations.append(
            Station(
                phase="input",
                title="(no input hooks registered)",
                path="settings.json extensions",
                note="nothing inspects the text before the turn",
                chips=[("pass-through", "muted")],
            )
        )
    for entry, file, info in input_exts:
        name = extension_name(entry)
        key, cfg = config_entry(config, name)
        chips: list[tuple[str, str]] = []
        if cfg is None:
            chips.append(("not in config.json", "muted"))
        else:
            chips.append(("enabled" if cfg.get("enabled") else "off", "ok" if cfg.get("enabled") else "muted"))
            if cfg.get("print"):
                chips.append(("prints true/false", "muted"))
        if info["handled"]:
            chips.append(("can end the turn", "danger"))
        note = "sees the raw text, decides whether to act"
        if cfg and cfg.get("mode"):
            note += f" · config.json: {key}.mode = {cfg['mode']}"
        stations.append(
            Station(
                phase="input",
                title=name,
                path=str(file.relative_to(agent_home)),
                note=note,
                chips=chips,
                may_end_turn=info["handled"],
            )
        )

    # -- before_agent_start -----------------------------------------------------
    for entry, file, info in before_exts:
        name = extension_name(entry)
        key, cfg = config_entry(config, name)
        chips = []
        skip = {"archive", "cos-orchestrator-agent", "cos-orchestrator-agent-usage"}
        hidden = [ct for ct in info["custom_types"] if ct not in skip]
        if hidden and hidden[0] == "calendar-node":
            chips.append(("fallback block only", "muted"))
        elif hidden:
            chips.append((f"adds {camel(hidden[0])}", "ok"))
        else:
            chips.append(("read-only", "muted"))
        if cfg is not None:
            chips.append(("enabled" if cfg.get("enabled") else "off", "ok" if cfg.get("enabled") else "muted"))
        note = "attaches a hidden message (display:false) that the model reads but the screen hides"
        if info["handled"]:
            note = "only when the input hook did not already answer: attaches the fallback block"
        elif not hidden:
            note = "observes the assembled prompt and writes a capture file; mutates nothing"
        stations.append(
            Station(
                phase="before",
                title=name,
                path=str(file.relative_to(agent_home)),
                note=note,
                chips=chips,
            )
        )

    # -- request ----------------------------------------------------------------
    labels = []
    for entry, _file, info in before_exts:
        for ct in info["custom_types"]:
            if ct.startswith(("input-contains-", "less-than-")):
                labels.append(camel(ct))
    stations.append(
        Station(
            phase="request",
            title="prompt assembly",
            path="pi core: system prompt + AGENTS.md + APPEND_SYSTEM.md + transcript + hidden blocks",
            note="the classification blocks ride along as messages, not as prompt sections",
            chips=[(f"+{len(labels)} hidden blocks", "ok")] if labels else [],
        )
    )
    if provider_exts:
        for entry, file, info in provider_exts:
            stations.append(
                Station(
                    phase="request",
                    title=Path(entry.lstrip("+")).stem,
                    path=str(file.relative_to(agent_home)),
                    note="observes the assembled payload last, before it leaves the machine",
                    chips=[("read-only", "muted")],
                )
            )

    provider = settings.get("defaultProvider", "?")
    model = settings.get("defaultModel", "?")
    blurb = (
        "hidden blocks I read: " + " · ".join(labels)
        if labels
        else "no hidden blocks ride along"
    )
    stations.append(
        Station(
            phase="request",
            title=f"model request → {provider}/{model}",
            path="settings.json defaultProvider / defaultModel",
            note=blurb,
            chips=[("the end of the path", "ok")],
        )
    )

    # -- return trip ------------------------------------------------------------
    for entry, file, info in tool_result_exts:
        stations.append(
            Station(
                phase="return",
                title=f"{extension_name(entry)} (tool output)",
                path=str(file.relative_to(agent_home)),
                note="runs after a tool, before its output joins the transcript: secrets are redacted first",
                chips=[("scrubs secrets", "danger")],
            )
        )

    return stations


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


def chip_width(text: str) -> float:
    return len(text) * CHIP_CHAR + CHIP_PAD * 2


CHIP_FILL = {"ok": "#12303a", "muted": "#1a2338", "danger": "#3a1229"}
CHIP_INK = {"ok": "#7fe3ff", "muted": "#93a5c7", "danger": "#ff8fc0"}


def render(stations: list[Station], *, agent_home: str, config_path: str, model: str) -> str:
    phase_order = [
        p
        for p in ("entry", "input", "before", "request", "return")
        if any(st.phase == p for st in stations)
    ]
    # one layout pass, so the canvas is exactly as tall as the content
    layout: list[tuple[str, float, list[tuple[Station, float]]]] = []
    y = HEADER_H
    for phase in phase_order:
        group = [st for st in stations if st.phase == phase]
        layout.append((phase, y, [(st, y + PHASE_H + i * ROW_H) for i, st in enumerate(group)]))
        y += PHASE_H + len(group) * ROW_H
    height = y + FOOTER_H

    add = (out := []).append

    add(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {height}" '
        f'width="{WIDTH}" height="{height}" role="img" '
        f'aria-label="Path of an input from entry to the model">'
    )
    add("  <title>Input trace: message → classification → model</title>")
    add("  <defs>")
    add(
        '    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">'
        f'<stop offset="0%" stop-color="{BG_TOP}"/><stop offset="100%" stop-color="{BG_BOTTOM}"/>'
        "</linearGradient>"
    )
    add(
        '    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">'
        '<feGaussianBlur stdDeviation="3.5" result="b"/>'
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    )
    add("  </defs>")
    add(f'  <rect width="{WIDTH}" height="{height}" fill="url(#bg)"/>')

    # ---- header
    add(f'  <g font-family="{UI_FONT}">')
    add(
        f'    <text x="{MARGIN}" y="52" font-size="11" letter-spacing="3.2" '
        f'fill="{PHASES["entry"][0]}">INPUT TRACE</text>'
    )
    add(
        f'    <text x="{MARGIN}" y="92" font-size="30" font-weight="700" '
        f'fill="{INK}">Your message → classification → me</text>'
    )
    add(
        f'    <text x="{MARGIN}" y="118" font-size="12.5" fill="{MUTED}" '
        f'font-family="{FONT}">{esc(truncate(agent_home, 72))}</text>'
    )
    stats: list[tuple[str, str]] = [
        (str(sum(1 for s in stations if s.phase == "input")), "input hooks"),
        (str(sum(1 for s in stations if s.phase == "return")), "return-trip hooks"),
        (str(sum(1 for s in stations if s.may_end_turn)), "can end the turn"),
        (model.split("/")[-1], "default model"),
    ]
    for i, (value, label) in enumerate(stats):
        x = WIDTH - MARGIN - i * 212
        add(
            f'    <text x="{x}" y="78" text-anchor="end" font-size="22" '
            f'font-weight="700" fill="{INK}">{esc(value)}</text>'
        )
        add(
            f'    <text x="{x}" y="100" text-anchor="end" font-size="11" '
            f'fill="{MUTED}">{esc(label)}</text>'
        )
    add("  </g>")
    add(f'  <line x1="{MARGIN}" y1="{HEADER_H - 30}" x2="{WIDTH - MARGIN}" y2="{HEADER_H - 30}" '
        f'stroke="{INK}" stroke-opacity="0.10"/>')

    # ---- phases, rail, cards
    for phase, top, entries in layout:
        colour, label = PHASES[phase]
        add(
            f'  <text x="{MARGIN}" y="{top + 26}" font-family="{UI_FONT}" font-size="10.5" '
            f'letter-spacing="2.4" fill="{colour}">{label}</text>'
        )
        add(
            f'  <line x1="{MARGIN + 8 * len(label) + 24}" y1="{top + 22}" '
            f'x2="{WIDTH - MARGIN}" y2="{top + 22}" stroke="{colour}" stroke-opacity="0.18"/>'
        )
        rail_y = top + PHASE_H
        for station, y in entries:
            cy = y + CARD_H / 2
            add(
                f'  <line x1="{RAIL_X}" y1="{rail_y}" x2="{RAIL_X}" y2="{cy}" '
                f'stroke="{colour}" stroke-opacity="0.45" stroke-width="2"/>'
            )
            rail_y = cy
            add(f'  <g font-family="{FONT}">')
            add(
                f'    <rect x="{CARD_X}" y="{y}" width="{CARD_W}" height="{CARD_H}" rx="12" '
                f'fill="{CARD_FILL}" stroke="{DANGER if station.may_end_turn else CARD_STROKE}" '
                f'stroke-opacity="{0.65 if station.may_end_turn else 1}"/>'
            )
            if station.may_end_turn:
                add(
                    f'    <rect x="{CARD_X}" y="{y + 10}" width="3" height="{CARD_H - 20}" '
                    f'rx="1.5" fill="{DANGER}" opacity="0.9"/>'
                )
            add(
                f'    <circle cx="{RAIL_X}" cy="{cy}" r="7" fill="{BG_TOP}" stroke="{colour}" '
                f'stroke-width="2" filter="url(#glow)"/>'
            )
            add(
                f'    <line x1="{RAIL_X + 7}" y1="{cy}" x2="{CARD_X}" y2="{cy}" '
                f'stroke="{colour}" stroke-opacity="0.55" stroke-width="1.5"/>'
            )
            add(
                f'    <text x="{CARD_X + 20}" y="{y + 27}" font-size="15" font-weight="600" '
                f'fill="{INK}">{esc(truncate(station.title, 46))}</text>'
            )
            add(
                f'    <text x="{CARD_X + 20}" y="{y + 47}" font-size="11" fill="{FAINT}">'
                f"{esc(truncate(station.path, 86))}</text>"
            )
            add(
                f'    <text x="{CARD_X + 20}" y="{y + 66}" font-size="11.5" fill="{MUTED}">'
                f"{esc(truncate(station.note, 104))}</text>"
            )
            cursor = CARD_X + CARD_W - 16
            for text, kind in reversed(station.chips):
                w = chip_width(text)
                cx = cursor - w
                add(
                    f'    <rect x="{cx:.1f}" y="{cy - 11}" width="{w:.1f}" height="22" rx="11" '
                    f'fill="{CHIP_FILL[kind]}" stroke="{CHIP_INK[kind]}" stroke-opacity="0.35"/>'
                )
                add(
                    f'    <text x="{cx + CHIP_PAD:.1f}" y="{cy + 4}" font-size="{CHIP_FONT}" '
                    f'fill="{CHIP_INK[kind]}">{esc(text)}</text>'
                )
                cursor = cx - 8
            add("  </g>")

    # arrow between the last two phases it separates
    for phase, top, entries in layout[:-1]:
        colour = PHASES[phase][0]
        ny = top + PHASE_H + len(entries) * ROW_H - GAP / 2
        add(
            f'  <path d="M {RAIL_X - 5} {ny - 4} L {RAIL_X} {ny + 2} L {RAIL_X + 5} {ny - 4}" '
            f'fill="none" stroke="{colour}" stroke-opacity="0.6" stroke-width="1.5"/>'
        )

    # ---- legend
    fy = height - FOOTER_H + 34
    add(f'  <g font-family="{UI_FONT}" font-size="11.5" fill="{MUTED}">')
    lx = MARGIN
    for phase in phase_order:
        colour, label = PHASES[phase]
        add(f'    <circle cx="{lx + 6}" cy="{fy - 4}" r="5.5" fill="{BG_TOP}" stroke="{colour}" stroke-width="2"/>')
        add(f'    <text x="{lx + 18}" y="{fy}">{label.lower()}</text>')
        lx += 18 + 7 * len(label.lower()) + 26
    add(
        f'    <rect x="{lx + 2}" y="{fy - 11}" width="3" height="14" rx="1.5" fill="{DANGER}"/>'
    )
    add(f'    <text x="{lx + 12}" y="{fy}">can end the turn (no model call)</text>')
    add(
        f'    <text x="{MARGIN}" y="{fy + 30}" opacity="0.7">order and flags read from '
        f'settings.json · {esc(truncate(config_path, 46))} · extension sources</text>'
    )
    add(
        f'    <text x="{WIDTH - MARGIN}" y="{fy + 30}" text-anchor="end" opacity="0.7">'
        f"input-path.svg</text>"
    )
    add("  </g>")

    add("</svg>")
    return "\n".join(out) + "\n"


# -------------------------------------------------------------------- cli -----


def default_agent_home() -> Path:
    env = os.environ.get("PI_CODING_AGENT_DIR")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".pi" / "agent-cos-orchestrator-agent" / "cos-orchestrator-agent"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Trace an input from entry to the model.")
    ap.add_argument("--agent-home", default=str(default_agent_home()), help="agent home to trace")
    ap.add_argument("--config", default=str(Path.home() / ".pi" / "config.json"), help="global config.json")
    ap.add_argument(
        "--out",
        default=str(Path(__file__).with_name("input-path.svg")),
        help="output SVG (default: input-path.svg beside this script)",
    )
    ap.add_argument("--list", action="store_true", help="print the stations, write no SVG")
    args = ap.parse_args(argv)

    agent_home = Path(args.agent_home).expanduser().resolve()
    config_path = Path(args.config).expanduser().resolve()

    settings = load_json(agent_home / "settings.json", "settings.json")
    config = load_json(config_path, "config.json") if config_path.is_file() else {}

    stations = build_stations(agent_home, config, settings)
    model = settings.get("defaultModel", "?")

    if args.list:
        for s in stations:
            chips = ", ".join(t for t, _ in s.chips)
            print(f"[{PHASES[s.phase][1]:<17}] {s.title:<34} {chips}")
        print(f"{len(stations)} stations · model {model}")
        return 0

    svg = render(
        stations,
        agent_home=str(agent_home),
        config_path=str(config_path),
        model=f"{settings.get('defaultProvider', '?')}/{model}",
    )
    ET.fromstring(svg)  # never write a file a renderer would reject

    out = Path(args.out).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg, encoding="utf-8")
    print(f"{out} ({out.stat().st_size} bytes) — {len(stations)} stations, model {model}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
