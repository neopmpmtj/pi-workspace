"""
CLI for ExplainLike12.

Human + agent friendly. Running with no arguments reads the clipboard,
explains it with the current settings, and pastes the explanation at the
cursor — that's what the Ctrl+Alt+L hotkey does.

Setter flags (--audience, --model, --length) save to .explain_state.json,
so an agent can switch settings on your behalf at any time.
"""

import argparse
import os
import sys
from pathlib import Path
from typing import List, Optional

from .config import StateManager
from .core.clipboard import read_clipboard, send_notification, write_and_paste
from .core.engine import ExplainError, Explainer
from .logging_utils import get_logger, set_console_level
from .prompts import (
    AUDIENCE_ORDER,
    AUDIENCES,
    LENGTH_ORDER,
    DEFAULT_AUDIENCE,
    DEFAULT_LENGTH,
    DEFAULT_MODEL,
)

logger = get_logger("cli")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="explain_like",
        description=(
            "Explain clipboard text like I'm 12. Reads the clipboard, asks an "
            "LLM for a plain-language breakdown, and pastes the explanation "
            "at your cursor."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  explain_like                              # explain clipboard (Ctrl+Alt+L)
  explain_like --text "SQL injection is..." # explain given text
  explain_like --audience 12th              # switch audience (saves state)
  explain_like --length short               # shorter answers (saves state)
  explain_like --model gpt-4o               # switch model (saves state)
  explain_like --no-paste                   # clipboard only, no auto-paste
  explain_like --save /tmp/notes.md         # write explanation to a file
  explain_like --list-audiences             # show audience presets
  explain_like --status                     # show current settings
  explain_like --clear-state                # reset settings to defaults
""",
    )

    # --- settings ------------------------------------------------------
    parser.add_argument("--audience", choices=AUDIENCE_ORDER,
                        help="Who to explain for (default: 12)")
    parser.add_argument("--model", help="OpenAI model (default: gpt-4o-mini)")
    parser.add_argument("--length", choices=LENGTH_ORDER,
                        help="Explanation length (default: medium)")

    # --- actions --------------------------------------------------------
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--status", action="store_true",
                         help="Show current settings and exit")
    actions.add_argument("--list-audiences", action="store_true",
                         help="List audience presets and exit")
    actions.add_argument("--clear-state", action="store_true",
                         help="Reset saved settings and exit")

    # --- input / output --------------------------------------------------
    parser.add_argument("--text", help="Explain this text instead of the clipboard")
    parser.add_argument("--no-paste", action="store_true",
                        help="Do not auto-paste; leave explanation in clipboard")
    parser.add_argument("--save", metavar="FILE",
                        help="Write the explanation to a file instead of pasting")
    parser.add_argument("--no-save-state", action="store_true",
                        help="Do not persist flag changes")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Verbose console logging")

    return parser


def _print_status(state) -> None:
    print("ExplainLike12 status")
    print("=" * 60)
    print(f"Audience:  {state.get('audience', DEFAULT_AUDIENCE)} "
          f"({AUDIENCES[state.get('audience', DEFAULT_AUDIENCE)]['label']})")
    print(f"Model:     {state.get('model', DEFAULT_MODEL)}")
    print(f"Length:    {state.get('length', DEFAULT_LENGTH)}")
    print(f"API key:   {'set' if os.environ.get('OPENAI_API_KEY') else 'NOT SET'}")


def _print_audiences() -> None:
    print("Available audiences:")
    print("=" * 60)
    for key in AUDIENCE_ORDER:
        print(f"  {key:<6} {AUDIENCES[key]['label']}")


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.verbose:
        set_console_level("cli", "DEBUG")
        set_console_level("engine", "DEBUG")

    mgr = StateManager()
    state = mgr.load()

    # --- read-only actions ----------------------------------------------
    if args.status:
        _print_status(state)
        return 0

    if args.list_audiences:
        _print_audiences()
        return 0

    if args.clear_state:
        if mgr.clear():
            print("Settings reset to defaults.")
        else:
            print("No state file to clear.")
        return 0

    # --- setters ---------------------------------------------------------
    changed = False
    if args.audience:
        state["audience"] = args.audience
        changed = True
    if args.model:
        state["model"] = args.model
        changed = True
    if args.length:
        state["length"] = args.length
        changed = True

    # If the user passed --no-paste or --save they clearly want an
    # explanation, not just a configuration change.
    output_action = bool(args.no_paste or args.save)
    configure_only = changed and args.text is None and not output_action

    if changed and not args.no_save_state:
        mgr.save(state)
        print("Settings updated:")
        _print_status(state)
    elif changed:
        print("Settings changed for this run only (--no-save-state):")
        _print_status(state)

    if configure_only:
        return 0

    # --- input -----------------------------------------------------------
    text = args.text if args.text is not None else read_clipboard()
    if not text:
        print("Nothing to explain. Copy some text first (or use --text).")
        return 1

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        print("OPENAI_API_KEY is not set. See README / .env.example.")
        send_notification("ExplainLike12", "OPENAI_API_KEY is not set", "critical")
        return 1

    # --- explain ----------------------------------------------------------
    audience = state.get("audience", DEFAULT_AUDIENCE)
    length = state.get("length", DEFAULT_LENGTH)
    model = state.get("model", DEFAULT_MODEL)

    send_notification(
        "ExplainLike12",
        f"Explaining for: {AUDIENCES.get(audience, {}).get('label', audience)}...",
        "low",
    )

    explainer = Explainer(
        model=model,
        api_key=api_key,
        base_url=os.environ.get("OPENAI_BASE_URL") or None,
    )

    try:
        explanation = explainer.explain(text, audience=audience, length=length)
    except ExplainError as exc:
        logger.error("Explanation failed: %s", exc)
        send_notification("ExplainLike12", f"Explanation failed: {exc}", "critical")
        print(f"Explanation failed: {exc}")
        return 1

    if not explanation:
        print("The LLM returned an empty explanation.")
        return 1

    # --- output -----------------------------------------------------------
    if args.save:
        out_path = Path(args.save).expanduser()
        try:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(explanation, encoding="utf-8")
            print(f"Explanation saved to {out_path}")
            send_notification("ExplainLike12", f"Explanation saved to {out_path}", "normal")
        except OSError as exc:
            logger.error("Failed to save file: %s", exc)
            send_notification("ExplainLike12", f"Failed to save file: {exc}", "critical")
            return 1
        return 0

    if args.no_paste:
        import pyperclip

        pyperclip.copy(explanation)
        send_notification(
            "ExplainLike12",
            "Explanation ready in clipboard. Press Ctrl+V to paste it.",
            "normal",
        )
        print("[ELI12] Explanation copied to clipboard (--no-paste).")
        return 0

    pasted = write_and_paste(explanation)
    if pasted:
        print("[ELI12] Explanation pasted at cursor.")
    else:
        print("[ELI12] Explanation in clipboard (auto-paste skipped). Press Ctrl+V.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
