"""
CLI for text_to_speech.

Human + agent friendly: both the dashboard and agents (via these CLI flags)
update the same .tts_state.json. Running with no arguments reads the
clipboard, synthesizes, saves and plays — that's what the Ctrl+Alt+S
hotkey does.
"""

import argparse
import os
import sys
from typing import List, Optional

from .core.cleanup import cleanup_audio
from .core.clipboard import read_clipboard, send_notification
from .core.engine import resolve_output_dir, resolve_retention_days, speak
from .core.synthesizers import PROVIDER_ORDER, get_synthesizer, provider_list
from .core.synthesizers.base import SynthError
from .logging_utils import get_logger, set_console_level
from .state.state_manager import PROVIDER_IDS, StateManager

logger = get_logger("cli")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="text-to-speech",
        description=(
            "Speak clipboard text out loud. Synthesizes with the current "
            "provider, saves the audio, and plays it back."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  text-to-speech                          # speak clipboard with current provider
  text-to-speech --text "Hello world"     # speak given text
  text-to-speech --provider elevenlabs    # switch provider (and save state)
  text-to-speech --provider openai --voice nova
  text-to-speech --list-voices            # voices of the current provider
  text-to-speech --list-voices --provider edge
  text-to-speech --list-providers         # show all 4 providers + key status
  text-to-speech --status                 # show current settings
  text-to-speech --cleanup-audio --dry-run
  text-to-speech --cleanup-audio --days 7
  text-to-speech --replay                  # play the last recording again
  text-to-speech --clear-state            # reset all settings to defaults
""",
    )

    # --- selection ---------------------------------------------------
    parser.add_argument("--provider", choices=PROVIDER_IDS, help="Select the active provider")
    parser.add_argument("--voice", help="Select voice for the active provider")
    parser.add_argument("--speed", type=float, help="Global speech speed (0.5-2.0)")
    parser.add_argument("--model", help="Model id (openai/cartesia/elevenlabs)")

    # --- per-provider settings ----------------------------------------
    parser.add_argument("--instructions", help="OpenAI: voice steering instructions")
    parser.add_argument("--emotion", help="Cartesia: emotion tag (e.g. calm, excited)")
    parser.add_argument("--stability", type=float, help="ElevenLabs: stability 0-1")
    parser.add_argument("--similarity", type=float, help="ElevenLabs: similarity 0-1")
    parser.add_argument("--style", type=float, help="ElevenLabs: style 0-1")
    parser.add_argument(
        "--speaker-boost",
        dest="use_speaker_boost",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="ElevenLabs: enable/disable speaker boost",
    )
    parser.add_argument("--rate", help="Edge: rate percent (e.g. +10%%)")
    parser.add_argument("--pitch", help="Edge: pitch (e.g. +0Hz)")
    parser.add_argument("--volume", help="Edge: volume (e.g. +0%%)")

    # --- global settings ----------------------------------------------
    parser.add_argument("--output-dir", help="Folder for saved audio files")
    parser.add_argument("--retention-days", type=float, help="Keep audio for N days")

    # --- actions ------------------------------------------------------
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--status", action="store_true", help="Show current settings and exit")
    actions.add_argument("--list-providers", action="store_true", help="List providers and exit")
    actions.add_argument("--list-voices", action="store_true", help="List voices and exit")
    actions.add_argument("--cleanup-audio", action="store_true", help="Delete old audio files and exit")
    actions.add_argument("--replay", action="store_true", help="Replay the last recording and exit")
    actions.add_argument("--clear-state", action="store_true", help="Reset saved state and exit")

    # --- input / behavior ---------------------------------------------
    parser.add_argument("--text", help="Speak this text instead of the clipboard")
    parser.add_argument("--days", type=float, help="Cleanup: delete files older than N days")
    parser.add_argument("--dry-run", action="store_true", help="Cleanup: show what would be deleted")
    parser.add_argument("--no-save-state", action="store_true", help="Do not persist flag changes")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose console logging")

    return parser


# ----------------------------------------------------------------------
def _print_providers(state) -> None:
    print("Available providers:")
    print("=" * 60)
    current = state.get("provider")
    for prov in provider_list():
        synth = get_synthesizer(prov["id"], state.get(prov["id"], {}))
        ok, reason = synth.is_configured()
        marker = "*" if prov["id"] == current else " "
        status = "ready" if ok else f"NOT CONFIGURED ({reason})"
        print(f"{marker} {prov['id']:<12} {prov['label']}")
        print(f"    {prov['description']}")
        print(f"    status: {status}")


def _print_status(state) -> None:
    provider_id = state.get("provider", "edge")
    prov = get_synthesizer(provider_id, state.get(provider_id, {}))
    ok, reason = prov.is_configured()
    cfg = state.get(provider_id, {})
    g = state.get("global", {})

    print("Text-to-Speech status")
    print("=" * 60)
    print(f"Provider:    {provider_id} ({prov.label})")
    print(f"Configured:  {'yes' if ok else 'NO — ' + reason}")
    print(f"Voice:       {cfg.get('voice', '')}")
    for key in ("model", "instructions", "emotion", "rate", "pitch", "volume"):
        if key in cfg and cfg[key] not in ("", None):
            print(f"{key.capitalize():<12}{cfg[key]}")
    if provider_id == "elevenlabs":
        print(
            f"Voice tuning: stability={cfg.get('stability')} similarity={cfg.get('similarity')} "
            f"style={cfg.get('style')} speaker_boost={cfg.get('use_speaker_boost')}"
        )
    print(f"Speed:       {g.get('speed', 1.0)}")
    print(f"Output dir:  {resolve_output_dir(state)}")
    print(f"Retention:   {resolve_retention_days(state)} days")


def _print_voices(provider_id: str, state) -> int:
    synth = get_synthesizer(provider_id, state.get(provider_id, {}))
    ok, reason = synth.is_configured()
    if not ok:
        print(f"Provider '{provider_id}' is not configured: {reason}")
        return 1
    print(f"Voices for '{provider_id}' ({synth.label}):")
    print("=" * 60)
    voices = synth.list_voices()
    if not voices:
        print("No voices available.")
        return 0
    for v in voices:
        extra = f" [{v.get('language', '')}]" if v.get("language") else ""
        print(f"  {v['id']:<40} {v.get('name', '')}{extra}")
    print(f"\n{len(voices)} voice(s).")
    return 0


# ----------------------------------------------------------------------
SETTER_KEYS = (
    ("voice", "voice"),
    ("model", "model"),
    ("instructions", "instructions"),
    ("emotion", "emotion"),
    ("rate", "rate"),
    ("pitch", "pitch"),
    ("volume", "volume"),
)
SETTER_FLOATS = (
    ("stability", "stability"),
    ("similarity", "similarity"),
    ("style", "style"),
)


def apply_setters(args: argparse.Namespace, state) -> bool:
    """Apply setter flags to the state in place. Returns True if changed."""
    changed = False

    if args.provider:
        state["provider"] = args.provider
        changed = True

    pid = state.get("provider", "edge")
    cfg = state.setdefault(pid, {})

    for attr, key in SETTER_KEYS:
        value = getattr(args, attr)
        if value is not None:
            cfg[key] = value
            changed = True

    for attr, key in SETTER_FLOATS:
        value = getattr(args, attr)
        if value is not None:
            cfg[key] = value
            changed = True

    if args.use_speaker_boost is not None:
        cfg["use_speaker_boost"] = args.use_speaker_boost
        changed = True

    if args.speed is not None:
        state["global"]["speed"] = args.speed
        changed = True
    if args.output_dir:
        state["global"]["output_dir"] = args.output_dir
        changed = True
    if args.retention_days is not None:
        state["global"]["retention_days"] = args.retention_days
        changed = True

    return changed


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.verbose:
        set_console_level("cli", "DEBUG")
        set_console_level("engine", "DEBUG")
        set_console_level("synth", "DEBUG")

    mgr = StateManager()
    state = mgr.load()

    # --- read-only actions ---------------------------------------------
    if args.list_providers:
        _print_providers(state)
        return 0

    if args.status:
        _print_status(state)
        return 0

    if args.list_voices:
        pid = args.provider or state.get("provider", "edge")
        return _print_voices(pid, state)

    if args.clear_state:
        if mgr.clear():
            print("State cleared. Defaults restored for next run.")
        else:
            print("No state file to clear.")
        return 0

    if args.cleanup_audio:
        days = args.days if args.days is not None else resolve_retention_days(state)
        result = cleanup_audio(resolve_output_dir(state), days, dry_run=args.dry_run)
        print(f"Cleanup ({'dry-run' if args.dry_run else 'for real'}) of {result['dir']}:")
        print(f"  deleted: {result['deleted']} file(s)")
        print(f"  kept:    {result['kept']} file(s)")
        if result["deleted"] and result["freed_bytes"]:
            print(f"  freed:   {int(result['freed_bytes']) // 1024} KB")
        return 0

    if args.replay:
        from .core.engine import replay_last

        path = replay_last(state)
        if path is None:
            return 1
        print(f"[TTS] Replaying: {path}")
        return 0

    # --- setters -------------------------------------------------------
    changed = apply_setters(args, state)
    configure_only = changed and args.text is None

    if changed and not args.no_save_state:
        mgr.save(state)
        print("Settings updated:")
        _print_status(state)
    elif changed:
        print("Settings changed for this run only (--no-save-state):")
        _print_status(state)

    if configure_only:
        return 0

    # --- speak ---------------------------------------------------------
    text = args.text if args.text is not None else read_clipboard()
    if not text:
        print("Nothing to speak. Copy some text first (or use --text).")
        return 1

    try:
        result = speak(text, state)
    except SynthError as exc:
        logger.error("Synthesis failed: %s", exc)
        send_notification("Text-to-Speech", f"Synthesis failed: {exc}", "critical")
        print(f"Synthesis failed: {exc}")
        return 1

    print(f"[TTS] {result['status']}: {result['path']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
