"""
explain_like — ExplainLike12.

Select technical text -> copy -> press Ctrl+Alt+L -> an LLM explains it
for a bright 12-year-old (who already understands some things but needs
the breakdown) and pastes the explanation at your cursor.
"""

from pathlib import Path

# App root: .../ExplainLike12/src/explain_like/__init__.py -> parents[2]
APP_ROOT = Path(__file__).resolve().parent.parent.parent
STATE_FILE = APP_ROOT / ".explain_state.json"
ENV_FILE = APP_ROOT / ".env"

# Load the project .env (if present). override=True: the app's own .env is
# the PRIMARY key source and wins over anything already in the environment
# (e.g. ~/.config/openai.env sourced by the shell wrapper as a fallback),
# so per-app key rotation always works.
try:
    from dotenv import load_dotenv

    load_dotenv(ENV_FILE, override=True)
except Exception:  # pragma: no cover
    pass

__version__ = "0.1.0"
