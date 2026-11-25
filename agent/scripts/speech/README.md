# speech — the one way text becomes audio

Three surfaces need to *hear* this agent: Telegram on the VPS, the laptop TUI, and the home
server later. They all call **one** script, so a better voice or a paid API later is a config
line, not new code in three places.

## The contract

```bash
printf '%s' "$text" | ~/.pi/agent/scripts/speech/speak.sh -o out.ogg
# stdout: /abs/path/out.ogg      exit 0 = playable file exists
```

| flag | meaning |
| --- | --- |
| `-o OUT` | output file; extension picks the container (`.ogg`/`.opus` = Telegram voice note, `.wav` = raw) |
| `-l en\|pt` | which voice (en_US-lessac, pt_PT-tugão) — a voice choice, not translation |
| `-e auto\|piper\|espeak` | engine; `auto` = piper, then espeak-ng if piper is missing |
| `--play` | also play on this host's speakers (laptops; headless hosts just skip it) |
| `-t TEXT` | text as an argument instead of stdin |
| `--limit N` | max characters spoken (default 1600, `0` = all) |

Rules that keep it from rotting:

- **No other file in this tree may call `piper`, `espeak-ng` or `ffmpeg -c:a libopus` directly.**
  If something needs speech, it calls `speak.sh`. That is the single seam.
- Markdown is stripped by `clean.py` before synthesis: no asterisks, no URLs read out
  character by character, no code fences recited, no emoji names.
- It never fails silently: a missing engine or empty text is a non-zero exit with a message,
  because the user cannot see a silent failure.

## Files

| file | role |
| --- | --- |
| `speak.sh` | the gateway: text → ogg/wav, engine selection, optional local playback |
| `clean.py` | markdown → speakable text, truncation with "the rest is in the text reply" |
| `setup-host.sh` | idempotent per-host setup: piper venv, voices, `~/.config/pi-speech.env`, Telegram wiring, self-test |

## Per-host setup

```bash
bash ~/.pi/agent/scripts/speech/setup-host.sh
```

No sudo: piper goes into `~/.local/venvs/piper`, voices into `~/.local/share/piper-voices`,
choices into `~/.config/pi-speech.env` (machine-local, outside the repo, so hosts may differ
without merge conflicts).

## Telegram wiring (inside `agent/telegram.json`)

`setup-host.sh` writes this block; a restart of the agent is needed because the bridge reads
its config at startup:

```json
"voice": { "replyMode": "always" },
"outboundHandlers": [
  { "type": "voice", "template": "~/.pi/agent/scripts/speech/speak.sh -o {ogg}",
    "output": "{ogg}", "timeout": 120000 }
]
```

With that in place a reply carries audio when it includes a `telegram_voice` comment;
`voice.replyMode: always` makes the bridge ask for one on every turn. `telegram_attach` on an
`.ogg`/`.opus` file is the manual path and needs no config at all.

`agent/telegram.json` is per-host and gitignored, so run `setup-host.sh` on each new host
instead of copying the file.

## Swapping the engine later

`~/.config/pi-speech.env`, no code change:

```bash
PI_SPEECH_ENGINE=auto
PI_SPEECH_VOICE=en_GB-cori-high     # any voice from rhasspy/piper-voices
PI_SPEECH_LENGTH_SCALE=1.05          # slower for tired eyes
```

A paid provider becomes one more branch inside `speak.sh` — the only file that changes.

Runbook: `agent/docs/runbooks/voice-first-accessibility.md`.
