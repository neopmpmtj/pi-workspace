# 🎓 ExplainLike12

Select technical text → copy → press **Ctrl+Alt+L** → an LLM explains it for a
**bright 12-year-old** (someone who already understands some things but needs
the breakdown) → the explanation is pasted at your cursor.

An independent sibling of `text_rewrite` and `text-to-speech` — same
clipboard → LLM → output pattern, different job: *reading help*, not rewriting.

## Usage

### The hotkey (normal use)

1. Select the technical text and copy it (**Ctrl+C**).
2. Press **Ctrl+Alt+L**.
3. A notification appears while the LLM thinks (~2-5s), then the
   explanation is pasted at your cursor. Your original text is never
   modified — it's only read from the clipboard.

The hotkey is registered in GNOME as custom shortcut `custom12`
(`Settings → Keyboard → Custom Shortcuts`). Re-register with:

```bash
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom12/ name 'explain-like-12'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom12/ command '/home/pmpmt/.pi/apps-scripts/ExplainLike12/explain.sh'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom12/ binding '<Control><Alt>l'
```

### CLI (for you and for agents)

```bash
cd ~/.pi/apps-scripts/ExplainLike12

# Explain the clipboard (same as the hotkey)
.venv/bin/python3 -m explain_like

# Explain specific text
.venv/bin/python3 -m explain_like --text "LLMs use vector embeddings to ..."

# Switch audience / length / model (saves to state; the hotkey follows)
.venv/bin/python3 -m explain_like --audience 12th
.venv/bin/python3 -m explain_like --audience 8 --length short
.venv/bin/python3 -m explain_like --model gpt-4o --length long

# Output options
.venv/bin/python3 -m explain_like --no-paste          # clipboard only
.venv/bin/python3 -m explain_like --save ~/notes/explanation.md

# Inspect / reset
.venv/bin/python3 -m explain_like --status
.venv/bin/python3 -m explain_like --list-audiences
.venv/bin/python3 -m explain_like --clear-state
```

## Audiences

| Preset | Who | Style |
|--------|-----|-------|
| `12` (default) | Bright 12-year-old | plain words, step-by-step, 1-2 analogies, terms defined inline |
| `8` | Curious 8-year-old | very short sentences, playful analogies, everything defined |
| `12th` | Smart 12th grader | real terminology, motivation → mechanics → trade-offs, key takeaways |
| `adult` | Smart adult, non-expert | plain language, no dumbing down, practical focus |

## Configuration

- **`.env`** (git-ignored, already created): `OPENAI_API_KEY` — the app's
  **primary** key source; rotate it here. `~/.config/openai.env` is only a
  fallback (sourced by `explain.sh`) and the app's `.env` always wins.
  Optional: `OPENAI_BASE_URL` to point at any OpenAI-compatible endpoint
  (e.g. an OpenClaw gateway).
- **`.explain_state.json`**: current `audience`, `model`, `length` — the
  single source of truth shared by the CLI, the hotkey, and agents.
- Defaults: `audience=12`, `model=gpt-4o-mini`, `length=medium`
  (~300-450 words).

## Project structure

```
ExplainLike12/
├── explain.sh               # hotkey wrapper (Ctrl+Alt+L)
├── requirements.txt / pyproject.toml / .env.example
├── .explain_state.json      # shared settings state
└── src/explain_like/
    ├── cli.py               # all CLI commands
    ├── prompts.py           # audience presets (the heart of the app)
    ├── config.py            # state manager
    └── core/
        ├── clipboard.py     # clipboard read + X11/Wayland-aware paste
        └── engine.py        # LLM calls with retry/backoff
```

## Troubleshooting

- **Nothing happens on the hotkey** — run `explain.sh` in a terminal and
  check the error; also check GNOME custom shortcut `custom12`.
- **"OPENAI_API_KEY is not set"** — add the key to the app's `.env`
  (`~/.pi/apps-scripts/ExplainLike12/.env`). `explain.sh` also sources
  `~/.config/openai.env` as a fallback.
- **Explanation didn't paste** — the explanation is still in the clipboard
  (notification says so); press Ctrl+V manually. Auto-paste needs
  `ydotool` (Wayland) or `pyautogui` (X11).
- **Pasting into the wrong place** — the explanation goes wherever your
  cursor is. Use `--no-paste` or `--save` if you'd rather not auto-paste.

## Ideas for later

- A tiny web/GUI popup to read long explanations instead of pasting
- "Explain and follow up" mode (ask questions about the explanation)
- Support other LLM providers via `OPENAI_BASE_URL` profiles
