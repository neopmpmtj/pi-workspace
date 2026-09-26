# 🔊 text-to-speech

Select text → copy → press **Ctrl+Alt+S** → this app reads your clipboard out loud,
saves the audio file, and plays it through the laptop speakers.

A sibling of [`on-demand-stt-rewrite`](../on-demand-stt-rewrite) (speech-to-text +
text_rewrite), running the same architecture in reverse: **clipboard → TTS model →
audio file → playback**.

## Providers (4 tiers)

| # | Provider | Tier | API key | Cost |
|---|----------|------|---------|------|
| 1 | **Microsoft Edge** (via `edge-tts`) | Free | none | $0 |
| 2 | **OpenAI TTS** (`gpt-4o-mini-tts` / `tts-1`) | Mid | `OPENAI_API_KEY` (already on this machine) | ~$0.015/min |
| 3 | **Cartesia Sonic** (`sonic-3.6`) | Mid+ | `CARTESIA_API_KEY` | per-char credits |
| 4 | **ElevenLabs** (`eleven_flash_v2_5` / `multilingual_v2` / …) | Top | `ELEVENLABS_API_KEY` | ~$0.05/1k chars |

Per-provider options exposed:

- **Edge** — voice (322 voices), rate/pitch/volume
- **OpenAI** — model, voice, `instructions` (voice steering)
- **Cartesia** — model, voice, emotion tag (calm/excited/sarcastic/…)
- **ElevenLabs** — model, voice library, stability / similarity / style / speaker boost

## Usage

### The hotkey (normal use)

1. Select text anywhere and copy it (**Ctrl+C**).
2. Press **Ctrl+Alt+S**.
3. The audio is synthesized, saved to `~/Voice/`, and played.

### Playback controls (while audio is playing)

| Key | Action |
|-----|--------|
| **Space** | Pause / resume |
| **Escape** | Stop playback |
| **Ctrl+Alt+P** | Replay the last recording |

These are global shortcuts — they work from any window. Space and Escape are
only active *while audio is playing* (`play_daemon.py` enables the bindings
on start and releases them on exit), so typing is completely unaffected
whenever nothing is playing. **Note:** while a clip is playing, the Space
and Escape keys are grabbed system-wide — so you can't type spaces or use
Esc in other apps until playback ends (stop it with Esc or let it finish).

The hotkeys are registered in GNOME (`Settings → Keyboard → Custom
Shortcuts`): `text-to-speech` (Ctrl+Alt+S, custom8), `tts-pause` (Space,
custom9 — enabled dynamically during playback), `tts-stop` (Escape,
custom10 — enabled dynamically during playback), `tts-replay` (Ctrl+Alt+P,
custom11). Re-register with:

```bash
# if you ever need to recreate them (custom9/custom10 bindings are managed
# dynamically by play_daemon.py — leave their bindings empty here)
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom8/ name 'text-to-speech'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom8/ command '/home/pmpmt/.pi/apps-scripts/text-to-speech/tts_speak.sh'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom8/ binding '<Control><Alt>s'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom9/ name 'tts-pause'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom9/ command '/home/pmpmt/.pi/apps-scripts/text-to-speech/tts_control.sh pause'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom10/ name 'tts-stop'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom10/ command '/home/pmpmt/.pi/apps-scripts/text-to-speech/tts_control.sh stop'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom11/ name 'tts-replay'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom11/ command '/home/pmpmt/.pi/apps-scripts/text-to-speech/tts_replay.sh'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom11/ binding '<Control><Alt>p'
```

### CLI (for you, agents, and automation)

```bash
# cd into the app dir or use the venv python; the package is pip-installed (editable)
cd ~/.pi/apps-scripts/text-to-speech
.venv/bin/python3 -m text_to_speech --help

# Speak the clipboard with the current provider (same as the hotkey)
.venv/bin/python3 -m text_to_speech

# Speak specific text (useful for testing / agents)
.venv/bin/python3 -m text_to_speech --text "Good morning!"

# Switch provider / voice (saves to state; affects the hotkey immediately)
.venv/bin/python3 -m text_to_speech --provider elevenlabs
.venv/bin/python3 -m text_to_speech --provider openai --voice nova --speed 1.1
.venv/bin/python3 -m text_to_speech --provider edge --voice pt-PT-FernandaNeural

# Per-provider options
.venv/bin/python3 -m text_to_speech --instructions "Speak in a calm British accent"   # openai
.venv/bin/python3 -m text_to_speech --emotion excited                                 # cartesia
.venv/bin/python3 -m text_to_speech --stability 0.6 --similarity 0.8 --style 0.1      # elevenlabs
.venv/bin/python3 -m text_to_speech --rate +10% --pitch -5Hz                          # edge

# Inspect
.venv/bin/python3 -m text_to_speech --status
.venv/bin/python3 -m text_to_speech --list-providers
.venv/bin/python3 -m text_to_speech --list-voices --provider elevenlabs

# Replay the last recording
.venv/bin/python3 -m text_to_speech --replay

# Playback controls (signals to the running play_daemon)
./tts_control.sh pause   # pause / resume
./tts_control.sh stop    # stop

# Reset everything to defaults
.venv/bin/python3 -m text_to_speech --clear-state
```

### Web dashboard (port 8031)

A Django dashboard (same look as the speech-to-text one on port 8030) for
changing settings without the CLI:

```bash
~/.pi/apps-scripts/text-to-speech/start_dashboard.sh
# → http://127.0.0.1:8031
```

The dashboard and the CLI share the same `.tts_state.json`, so changes from
either side apply to the next hotkey press. The dashboard offers:

- provider + voice picker (voices fetched live per provider, with a filter box)
- per-provider options (only the relevant fields are shown)
- global speed, audio folder, retention days
- a **▶ Play test** button that synthesizes a short preview in the browser

> Note: port **8030** is the speech-to-text dashboard; this one is **8031**.

## Audio files & the cleanup cron job

Every spoken clip is saved to `~/Voice/` (configurable) as
`tts_<provider>_<YYYYMMDD-HHMMSS>.mp3`.

**Automatic cleanup:** a cron job runs **daily at 03:00** and deletes generated
audio files older than the retention period — **14 days by default,
configurable** (dashboard "Keep audio (days)" field, CLI `--retention-days`,
or the `TTS_RETENTION_DAYS` env var).

Installed cron line (re-run the installer if you move the app):

```bash
~/.pi/apps-scripts/text-to-speech/install_cleanup_cron.sh
# installs:
#   0 3 * * * cd ~/.pi/apps-scripts/text-to-speech && .venv/bin/python3 -m text_to_speech --cleanup-audio >> /tmp/tts_cleanup.log 2>&1
```

Manual runs:

```bash
.venv/bin/python3 -m text_to_speech --cleanup-audio --dry-run          # preview
.venv/bin/python3 -m text_to_speech --cleanup-audio                    # delete
.venv/bin/python3 -m text_to_speech --cleanup-audio --days 7           # custom retention
```

Only files matching `tts_*.mp3/.wav/.ogg/.opus/.flac/.m4a/.aac` in the output
folder are ever considered — other files are never touched.

## Configuration

### API keys — `.env` (git-ignored)

```bash
cd ~/.pi/apps-scripts/text-to-speech
cp .env.example .env   # the real .env already exists — keep it, it's git-ignored
# edit .env to add/rotate keys (app .env is the primary source)
```

- **`OPENAI_API_KEY`** — already set in this app's own `.env` (git-ignored).
  `~/.config/openai.env` is only a fallback (sourced by the shell wrappers),
  and the app's `.env` always wins — so rotate keys per app by editing it.
- `CARTESIA_API_KEY` — free account at <https://cartesia.ai>; add it to `.env`.
- `ELEVENLABS_API_KEY` — from <https://elevenlabs.io>; add it to `.env`.
- Providers without a key show as "NOT CONFIGURED" in `--list-providers` and the
  dashboard; the other providers keep working.

### State file — `.tts_state.json`

The single source of truth (current provider, voice, per-provider settings,
speed, output dir, retention days). Written by the CLI, the dashboard, and
read fresh on every hotkey press. Delete it (`--clear-state`) to restore
defaults.

### Environment overrides

| Variable | Default | Purpose |
|----------|---------|---------|
| `TTS_OUTPUT_DIR` | `~/Voice` | audio save folder |
| `TTS_RETENTION_DAYS` | `14` | cleanup retention |

## Project structure

```
text-to-speech/
├── tts_speak.sh              # hotkey wrapper (Ctrl+Alt+S)
├── tts_control.sh            # pause|stop control script (Space / Escape)
├── tts_replay.sh             # replay the last recording (Ctrl+Alt+P)
├── play_daemon.py            # background player daemon (pause/stop/replay)
├── start_dashboard.sh        # dashboard on http://127.0.0.1:8031
├── install_cleanup_cron.sh   # installs the daily cleanup cron job
├── requirements.txt / pyproject.toml / .env.example
├── .tts_state.json           # shared settings state
├── src/text_to_speech/
│   ├── cli.py                # all CLI commands
│   ├── state/state_manager.py
│   └── core/
│       ├── clipboard.py      # clipboard input + desktop notifications
│       ├── engine.py         # synth -> save -> play pipeline
│       ├── player.py         # aplay / ffplay detection
│       ├── cleanup.py        # retention cleanup (cron target)
│       └── synthesizers/     # one adapter per provider
└── web_dashboard/            # Django dashboard (settings_app)
```

## Troubleshooting

- **Nothing happens on the hotkey** — run `~/.pi/apps-scripts/text-to-speech/tts_speak.sh`
  in a terminal and check the error; also check GNOME custom shortcut `custom8`.
- **"Missing API key"** — the provider isn't configured; add the key to `.env`
  (see above). `--list-providers` shows per-provider status.
- **Clipboard empty** — you must copy the text first (Ctrl+C).
- **No sound** — playback uses `ffplay` (installed) with `aplay` as a wav
  fallback. Check logs in `logs/`.
- **Long text is slow on Edge (free)** — the free Microsoft endpoint can take
  tens of seconds for very long texts; OpenAI/Cartesia/ElevenLabs are faster.
  (Streaming playback is the planned v2 fix.)
- **Voice list fails on the dashboard** — the provider's API key is missing or
  the network call failed; the built-in fallback voices are still listed.

## v2 ideas (parked)

- Streaming playback (Cartesia/edge-tts/ElevenLabs stream) for instant start on long texts
- Optional offline local provider (Kokoro/Piper)
- Per-provider hotkeys (Ctrl+Alt+1/2/3/4)
- Pause via a chord (e.g. Ctrl+Alt+Space) instead of plain Space, if the
  Space grab during playback ever gets in the way of typing while listening
