# Text-to-Speech Hotkey App — Setup & Implementation Report

**Date:** 2026-09-26
**System:** Ubuntu 24.04 (Python 3.12.3 · Django 6.1.1 · edge-tts 7.2.8 · ffplay/ffmpeg)
**Location:** `~/.pi/apps-scripts/text-to-speech/` (committed to `pi-workspace` as `7796b70`)

---

## Problem

The `on-demand-stt-rewrite` ecosystem covered the voice→text direction (hotkey recording → Whisper transcription → auto-paste) and the text→text direction (clipboard → LLM rewrite → auto-paste). Missing was the reverse voice direction: **select text → hear it spoken aloud**. The goal was a sibling app that:

1. Takes clipboard text and sends it to a **text-to-speech (TTS)** model.
2. Saves the audio file locally and plays it on the laptop speakers.
3. Supports **four providers**: a free tier (Microsoft), a mid tier (OpenAI), a mid+ tier (Cartesia Sonic), and a top tier (ElevenLabs).
4. Provides a **web dashboard** for settings (like the existing speech-to-text dashboard), a **CLI for agent-driven control**, a **retention-cleanup cron job**, and — added mid-build — **global playback controls** (pause, stop, replay) that work from any window.

## Research Phase

### Web Searches Performed

The user was unsure which TTS providers to use ("many dozens of providers… bewildered"). Research targeted the user's existing OpenClaw VPS, ElevenLabs specifics, and mid-tier candidates:

| # | Search Focus | Key Sources |
|---|---|---|
| 1 | OpenClaw TTS — Microsoft Edge provider, OpenAI-compatible endpoint, VPS config | `docs.openclaw.ai/tools/tts` (+ `field-reference`), `docs.openclaw.ai/gateway/openai-http-api` |
| 2 | Free Microsoft TTS — edge-tts Python module, Azure free tier | `github.com/rany2/edge-tts`, `azure.microsoft.com/pricing/speech` |
| 3 | ElevenLabs API — pricing, convert endpoint, model comparison | `elevenlabs.io/docs/api-reference/text-to-speech/convert`, `elevenlabs.io/pricing/api` |
| 4 | Mid-tier landscape — Cartesia vs ElevenLabs vs OpenAI, gpt-4o-mini-tts pricing | `docs.cartesia.ai/api-reference/tts/bytes`, `developers.openai.com/docs/models/gpt-4o-mini-tts`, coval.ai comparison |
| 5 | Open-source fallbacks — Kokoro, Piper, Qwen3-TTS | `github.com/hexgrad/kokoro`, `github.com/OHF-Voice/piper1-gpl` |
| 6 | Cartesia request shape — `generation_config` speed/volume/emotion | `docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion` |

### Key Findings

1. **The "free Microsoft TTS inside OpenClaw" is reachable without OpenClaw.** OpenClaw's `microsoft` TTS provider is Microsoft Edge's online neural TTS via `node-edge-tts` — no API key, no VPS needed. The Python `edge-tts` package calls the same service directly from any machine (322 voices, rate/pitch/volume controls). The VPS round-trip was dropped; `edge-tts` runs locally.
2. **OpenClaw is a TTS *consumer*, not a server.** Its gateway's OpenAI-compatible HTTP surface only exposes `/v1/chat/completions`, `/v1/models`, `/v1/embeddings` (disabled by default) — there is no public `/v1/audio/speech` to call.
3. **ElevenLabs shape:** `POST /v1/text-to-speech/{voice_id}` with `xi-api-key`; models `eleven_flash_v2_5` (cheap/fast), `eleven_turbo_v2_5`, `eleven_v3`, `eleven_multilingual_v2` (best); `voice_settings = {stability, similarity_boost, style, use_speaker_boost, speed}`; ≈ $0.05/1k chars on Flash.
4. **Cartesia shape:** `POST /tts/bytes` with `X-API-Key` + `Cartesia-Version` headers; `model_id: sonic-3.6`; `generation_config = {speed: 0.6–1.5, volume, emotion}`; output_format `{container: mp3, encoding: mp3, sample_rate: 44100, bit_rate: 128000}`; voices are UUIDs via `GET /voices`.
5. **OpenAI TTS chosen as the mid tier:** `gpt-4o-mini-tts`/`tts-1` at ≈ $0.015/min, and — decisively — the user already has `OPENAI_API_KEY` on the machine, so it required zero new credentials. Cartesia was added as a fourth provider for voice quality.
6. **Latency reality check:** Cartesia advertises sub-90ms *streaming* TTFA; edge-tts ≈ 0.3–1s; ElevenLabs Multilingual v2 is slow (1.5–3s). With a **save-then-play** design, perceived latency for clipboard-sized text is 1–2s for all providers (generation time dominates on long text). Streaming was deferred to v2.

## Architecture / Design Decisions

The app deliberately mirrors the proven sibling pattern (`text_rewrite` / `speech-to-text`):

| Kept from the ecosystem | Why |
|---|---|
| Clipboard input via `pyperclip` + `notify-send` feedback | Proven on this machine (X11/Wayland aware) |
| Shell wrapper + GNOME custom shortcut | Same trigger model as Ctrl+Alt+R / Ctrl+Alt+minus |
| Shared JSON state file read fresh on every run | Same live-config model as `.text_rewrite_state.json` / `runtime_config.json` |
| Django + Bootstrap 5 dashboard, purple-gradient card UI | Visual parity with the 8030 STT dashboard |
| Rotating file logs in `logs/` | Same debugging workflow |

| New decisions | Chosen approach vs alternatives |
|---|---|
| **Provider adapters** | One class per provider behind a common `synthesize(text, speed) -> bytes` interface + registry. Alternative: one monolithic API client — rejected for extensibility |
| **Playback engine** | Detached **`play_daemon.py`** process (pidfile + signals), mirroring the STT app's `record_daemon.py` toggle pattern. Alternative: blocking player in the hotkey process — rejected because pause/stop need a controllable long-lived process |
| **Pause mechanism** | `SIGSTOP`/`SIGCONT` on the ffplay child. Zero new dependencies (mpv's IPC socket would need an apt install; ffplay has no IPC at all) |
| **Global Space/Escape keys** | Dynamically toggled GNOME bindings (`custom9`/`custom10`) enabled only during playback — a permanently-bound global Space would swallow every spacebar press system-wide while idle. This was the key UX constraint |
| **Replay** | Newest `tts_*` file by mtime in the output dir — no extra state tracking |
| **Output format** | MP3 everywhere (all four providers support it); ffplay plays it, aplay is the wav fallback |

### File Layout

```
~/.pi/apps-scripts/text-to-speech/
├── tts_speak.sh              # Ctrl+Alt+S hotkey wrapper
├── tts_control.sh            # pause|stop signals (Space / Escape targets)
├── tts_replay.sh             # Ctrl+Alt+P replay wrapper
├── play_daemon.py            # background player (pause/stop/replay daemon)
├── start_dashboard.sh        # dashboard on http://127.0.0.1:8031
├── install_cleanup_cron.sh   # installs the daily retention cron job
├── .tts_state.json           # shared settings state (git-ignored)
├── .env                      # API keys — primary source (git-ignored)
├── src/text_to_speech/
│   ├── cli.py                # all CLI commands (human + agent)
│   ├── state/state_manager.py
│   └── core/
│       ├── clipboard.py      # clipboard + notifications
│       ├── engine.py         # synth → save → spawn-daemon pipeline
│       ├── player.py         # player command resolution (aplay/ffplay)
│       ├── cleanup.py        # retention cleanup (cron target)
│       └── synthesizers/     # base + edge + openai_tts + cartesia + elevenlabs
└── web_dashboard/            # Django (settings_app) on port 8031
```

## Implementation Phases

### Phase 1 — Core package + four synthesizers

`cli.py` (296 lines) is both the hotkey entry point and the agent control surface. Running bare speaks the clipboard; setter flags (`--provider`, `--voice`, `--speed`, `--stability`…) mutate `.tts_state.json`; action flags cover `--status`, `--list-providers`, `--list-voices`, `--replay`, `--cleanup-audio`, `--clear-state`. A heuristic distinguishes "configure only" from "explain/speak": setters alone save and exit (so an agent can switch providers without triggering audio); `--text` or output flags force a run.

Each synthesizer maps the global `speed` (0.5–2.0) into its native parameter:

| Provider | Endpoint / library | Auth | Speed mapping |
|---|---|---|---|
| `edge` | `edge_tts.Communicate().stream()` (async) | none | `rate` percent string, clamped ±(-50/+100)% |
| `openai` | `POST api.openai.com/v1/audio/speech` | `OPENAI_API_KEY` | `speed` 0.25–4.0 + optional `instructions` steering |
| `cartesia` | `POST api.cartesia.ai/tts/bytes` | `CARTESIA_API_KEY` (+ `Cartesia-Version`) | `generation_config.speed` 0.6–1.5 + `emotion` |
| `elevenlabs` | `POST api.elevenlabs.io/v1/text-to-speech/{voice_id}` | `ELEVENLABS_API_KEY` | `voice_settings.speed` 0.5–2.0 + stability/similarity/style/speaker-boost |

Cartesia's `voice` field is sent as `{"mode": "id", "id": ...}` with automatic retry as a plain string on 4xx (the API docs evolved between versions). Voice listing per provider: live `GET /voices` for ElevenLabs/Cartesia, `edge_tts.list_voices()` (322 voices), static list for OpenAI; each provider has offline fallbacks (e.g. Cartesia's Leo/Jace/Maya UUIDs).

### Phase 2 — Engine, persistence, cleanup

`engine.speak()`: synthesize → save `tts_<provider>_<timestamp>.mp3` into `~/Voice` (configurable) → notify with controls hint → spawn detached daemon. `cleanup.py` deletes only `tts_*` audio files older than N days (default 14; `TTS_RETENTION_DAYS` env or state), never touching other files. Installed cron: `0 3 * * * … -m text_to_speech --cleanup-audio >> /tmp/tts_cleanup.log 2>&1`.

### Phase 3 — Web dashboard (port 8031)

Django `settings_app` on **8031** (8030 is taken by the STT dashboard): provider select → live voice list via `/voices?provider=` AJAX (with client-side filter), per-provider option blocks toggled by JS, global speed slider / output dir / retention days, and a **▶ Play test** endpoint (`POST /preview` → `audio/mpeg` blob played in the browser). The dashboard and CLI write the same `.tts_state.json`; the engine reads it fresh per run — no restart needed for either surface.

### Phase 4 — Playback controls (pause / stop / replay)

- **Ctrl+Alt+P** (permanent, GNOME `custom11`) → `tts_replay.sh` → `--replay` (newest file).
- **Space / Escape** (dynamic, `custom9`/`custom10`): registered with **empty** bindings; `play_daemon.py` sets them to `space`/`Escape` on start and clears them on exit. Idle typing is completely unaffected; during playback the keys are grabbed system-wide (documented trade-off; chord alternative parked in future work).
- Signals to the daemon: `SIGUSR1` toggles pause (SIGSTOP/SIGCONT on the ffplay child), `SIGTERM` stops.

### Phase 5 — Daemon bug: signal-handler reentrancy (the significant fix)

**Symptom (end-to-end test):** stop took exactly **3.07s**; a second "Stop requested" log line appeared; after a replay-during-playback test the dying daemon unlinked the *new* daemon's pidfile and released its key bindings (race observed in `player.log`).

**Investigation:** instrumented each candidate — ffplay dies 0.1s after SIGTERM (even after SIGSTOP/SIGCONT), `notify-send` and `gsettings` return in <25ms — ruling them out. The 3.07s ≈ `child.wait(timeout=3)` timing out inside the signal handler: v1 called `child.poll()`/`child.wait()` from the handler while the main loop was already inside `child.wait()`. Popen wait/poll reentrancy in handler context is unreliable; the inner wait hit its full timeout, and the slow handler then raced the next daemon's startup.

**Fix (rewrite of `play_daemon.py`):**

1. **Signal handlers only set flags** (`stop_requested`, `pause_toggle_requested`); the main loop polls every 50ms and does all real work.
2. **Fast kill path:** `kill_child()` = SIGCONT (if paused) → SIGTERM → 0.5s grace → SIGKILL.
3. **Ownership-checked cleanup:** the daemon only unlinks the pidfile / releases the hotkeys if the pidfile still contains *its own* PID — a slow-dying daemon can never clobber a newer one.
4. **Takeover handshake:** a new daemon kills any old pid and waits (≤3s) for it to exit before writing its own pidfile and enabling controls.

**Verification:** stop time 3.07s → **0.61s**; replay-during-playback leaves exactly one ffplay and one clean pidfile; idle state has empty bindings. (Test-harness note: `pgrep -f "ffplay.*tts_"` matched the test script's own command line, producing phantom process counts — switched to `ps -C ffplay`.)

### Phase 6 — Standalone `.env` key files

Each app owns its `.env` (mode 600, git-ignored) as the **primary** key source: `load_dotenv(..., override=True)` so the app file beats the legacy `~/.config/openai.env` fallback sourced by the wrappers — enabling per-app key rotation. Verified with a stale-key simulation on all four ecosystem apps.

## Files Created / Modified

| File | Lines | Purpose |
|---|---|---|
| `play_daemon.py` | 250 | Background player daemon: flag-based signal handling, dynamic hotkey grab, ownership-checked cleanup |
| `web_dashboard/settings_app/templates/settings_app/dashboard.html` | 415 | Bootstrap 5 dashboard UI + JS (voices AJAX, per-provider fields, preview) |
| `src/text_to_speech/cli.py` | 296 | CLI: speak, setters, status, voices, replay, cleanup, clear-state |
| `README.md` | 236 | Full usage/config/cron/hotkey documentation |
| `src/text_to_speech/core/engine.py` | 181 | speak/replay pipeline + daemon lifecycle management |
| `web_dashboard/settings_app/views.py` | 144 | Dashboard views + `/voices` + `/preview` endpoints |
| `src/text_to_speech/state/state_manager.py` | 124 | `.tts_state.json` load/save with deep-merge defaults |
| `src/text_to_speech/core/synthesizers/cartesia.py` | 111 | Cartesia Sonic adapter (voice-shape retry, fallback voices) |
| `src/text_to_speech/core/cleanup.py` | 103 | Retention cleanup (`tts_*` only, dry-run support) |
| `src/text_to_speech/core/synthesizers/elevenlabs.py` | 95 | ElevenLabs adapter (voice_settings, live voice library) |
| `src/text_to_speech/core/synthesizers/edge.py` | 86 | edge-tts adapter (async stream → bytes, 322 voices) |
| `src/text_to_speech/core/player.py` | 72 | Player command resolution (ffplay/aplay/mpv chain) |
| `src/text_to_speech/core/synthesizers/openai_tts.py` | 60 | OpenAI TTS adapter (+instructions steering) |
| `src/text_to_speech/logging_utils.py` | 59 | Console + rotating-file logging |
| `web_dashboard/dashboard_project/settings.py` | 61 | Minimal Django settings (no model apps, no DB) |
| `src/text_to_speech/core/synthesizers/base.py` | 51 | Synth base class + `SynthError` + key checks |
| `src/text_to_speech/core/synthesizers/__init__.py` | 45 | Provider registry + metadata |
| `src/text_to_speech/core/clipboard.py` | 44 | Clipboard read + notifications |
| `tts_control.sh` | 39 | pause/stop signal dispatch + stale-pidfile binding release |
| `src/text_to_speech/__init__.py` | 32 | APP_ROOT resolution + `.env` loading (override=True) |
| `tts_speak.sh` | 28 | Ctrl+Alt+S wrapper (key sourcing + `-m text_to_speech`) |
| `tts_replay.sh` / `start_dashboard.sh` | 24 | Replay wrapper / dashboard launcher (8031) |
| `install_cleanup_cron.sh` / `.env.example` | 21 | Cron installer / env template |
| `web_dashboard/manage.py` + project scaffolding, `requirements.txt`, `pyproject.toml`, `.gitignore`, `__main__.py`, `__init__.py`s | ~60 | Packaging (editable install), scaffolding |

## Configuration

### GNOME custom shortcuts

| Slot | Name | Binding | Command |
|---|---|---|---|
| custom8 | text-to-speech | `<Control><Alt>s` | `tts_speak.sh` |
| custom9 | tts-pause | `space` *(dynamic: empty when idle)* | `tts_control.sh pause` |
| custom10 | tts-stop | `Escape` *(dynamic: empty when idle)* | `tts_control.sh stop` |
| custom11 | tts-replay | `<Control><Alt>p` | `tts_replay.sh` |

### State file (`.tts_state.json`)

```json
{
  "provider": "edge",
  "global": { "speed": 1.0, "format": "mp3", "output_dir": "~/Voice", "retention_days": 14 },
  "edge":       { "voice": "en-US-MichelleNeural", "rate": "+0%", "pitch": "+0Hz", "volume": "+0%" },
  "openai":     { "voice": "coral", "model": "gpt-4o-mini-tts", "instructions": "" },
  "cartesia":   { "voice": "<uuid>", "model": "sonic-3.6", "emotion": "" },
  "elevenlabs": { "voice": "<id>", "model": "eleven_flash_v2_5", "stability": 0.5,
                  "similarity": 0.75, "style": 0.0, "use_speaker_boost": true }
}
```

### Environment (`.env`, git-ignored, primary source)

`OPENAI_API_KEY` · `ELEVENLABS_API_KEY` · `CARTESIA_API_KEY` · optional `TTS_OUTPUT_DIR` / `TTS_RETENTION_DAYS`

## Usage Quick Reference

```bash
.venv/bin/python3 -m text_to_speech                        # speak clipboard (Ctrl+Alt+S)
.venv/bin/python3 -m text_to_speech --provider elevenlabs  # switch provider (saves state)
.venv/bin/python3 -m text_to_speech --list-voices --provider edge
.venv/bin/python3 -m text_to_speech --replay               # last recording (Ctrl+Alt+P)
.venv/bin/python3 -m text_to_speech --cleanup-audio --dry-run
./tts_control.sh pause                                     # Space (during playback)
./tts_control.sh stop                                      # Escape (during playback)
```

During playback: **Space** = pause/resume · **Escape** = stop · **Ctrl+Alt+P** = replay.

## Limitations & Future Work

1. **Save-then-play only.** Streaming (Cartesia/edge-tts/ElevenLabs `/stream`) is deferred to v2 — long text on the free Edge provider can take tens of seconds to synthesize.
2. **Space/Escape are grabbed globally during playback** — typing spaces in other apps is blocked while audio plays. Chord alternative (Ctrl+Alt+Space) parked.
3. **Pause is process-freeze based** (SIGSTOP): tiny audio buffer drain on pause; no seek support.
4. **Cartesia/ElevenLabs untested live** — adapters implemented against current API docs with fallbacks, but no keys were present during development.
5. **Dashboard is a dev server** (`runserver`) — not a systemd service; won't survive reboot.
