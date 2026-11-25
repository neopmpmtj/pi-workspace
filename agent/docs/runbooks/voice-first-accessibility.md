# Voice-first access — the agent that talks back

**Trigger:** the user's eyesight is degrading. Reading long replies is no longer viable; the
agent's output has to be *heard*, on every surface, without per-surface forks of the code.

**Status:** Telegram on the VPS works (Piper, local, free, `.ogg` voice notes). Laptop and
home server: one command each.

---

## 1. The rule that prevents the spaghetti

Everything that produces speech goes through **one** script:

```
agent/scripts/speech/speak.sh        text on stdin → .ogg/.opus (or .wav with -o)
```

Surfaces are *transports*, not TTS implementations:

| Surface | How it reaches the user's ears | Code needed |
| --- | --- | --- |
| Telegram (VPS, phone) | `speak.sh` → `.ogg` → Bot API `sendVoice` | none — bridge config (`outboundHandlers` voice handler) |
| Laptop TUI | `speak.sh --play` → `pw-play` on the laptop speakers | existing: `agent/extensions/speech-reply.ts`, enabled per host by `PI_SPEECH_TUI=1` |
| Home server | same as VPS: Telegram voice notes | none — run `setup-host.sh` |

Corollary: adding a *paid* voice (OpenAI TTS, ElevenLabs, Cartesia) touches `speak.sh` only.
Adding a *surface* touches that surface only. Never both in one change.

## 2. The chain, in order of cost

1. `clean.py` — markdown → speakable text (no `**`, no URL read out, no code fences, 1600 char
   cap with "the rest is in the text reply").
2. `speak.sh` — picks the engine:
   - **piper** (default): local, CPU, MIT-ish voice models, GPL-3.0 CLI, ~1.4 s for 5 s of
     audio on a 2-core VPS. No key, no network, no quota.
   - **espeak-ng**: only if piper is missing. Robotic, instant, apt-installable.
3. `ffmpeg -c:a libopus -b:a 32k -ac 1 -ar 48000` — Telegram voice notes must be OGG/Opus;
   ≤50 MB / ≤1 h. A 20 s note is ~80 KB.

## 3. Set up a host (VPS done, laptop and home server pending)

```bash
bash ~/.pi/agent/scripts/speech/setup-host.sh      # idempotent; no sudo
```

Then **restart the agent on that host** (the Telegram bridge reads `telegram.json` once at
startup — there is no file watcher). On the VPS:

```bash
systemctl --user restart pi-vps-agent      # from an SSH shell, never from inside the agent
```

Verification without a restart: attach the self-test file.

```bash
printf 'speech is ready' | ~/.pi/agent/scripts/speech/speak.sh -o /tmp/t.ogg
```

## 4. What the agent must do differently now

Reading is the bottleneck, so reply *shape* matters as much as delivery:

- Lead with the answer in one spoken-friendly sentence. Details after, or in a file.
- No tables in a spoken reply — they read as noise. No long code dumps read aloud; say
  "written to `<path>`" instead.
- Put the *spoken* part in a `telegram_voice` comment and keep the text short. When in doubt,
  speak it: a redundant voice note costs nothing, an unreadable wall of text costs the
  working relationship.
- Anything genuinely important gets written to a file **and** said, because the file survives
  and the speech is how the user receives it.

## 5. Roadmap (agreed, not built)

| Step | Why | Cost |
| --- | --- | --- |
| ~~Laptop TUI speech extension~~ — done 2026-11-25 | laptop sessions went unspoken | `agent/extensions/speech-reply.ts`, off unless `PI_SPEECH_TUI=1` |
| Voice *input* on Telegram | typing will get hard too; the bridge already supports transcription providers | local Whisper (`sherpa-onnx-node` or `whisper.cpp`), no cloud |
| Better voice (paid) | naturalness, once there is income | one branch in `speak.sh`; OpenAI `gpt-4o-mini-tts` ≈ $0.015/1k chars |
| Desktop screen reader (Orca + speech-dispatcher) | reading *anything else* on the laptop, not just pi | `spd-say` baseline; no Piper module for speech-dispatcher exists |

## 5b. The laptop TUI extension

`agent/extensions/speech-reply.ts` is inert unless the machine says otherwise. To turn it on
on the laptop:

```bash
printf 'PI_SPEECH_TUI=1\n' >> ~/.config/pi-speech.env
```

It speaks on `turn_end`, only for a response that used no tools (the final answer, not the
thinking in between), queues one note at a time, and renders a warning in the TUI when the
speech command fails — so a silent laptop is a visible error, not a mystery. The VPS keeps it
off: it has no audio device, and its speech goes out as Telegram voice notes.

## 6. Durability checklist

- `agent/scripts/speech/` is tracked in the repo → both hosts and the home server get it by
  `git pull`. Voices live in `~/.local/share/piper-voices`, not in git (61 MB each).
- `~/.config/pi-speech.env` and `agent/telegram.json` are machine-local: per-host voice,
  rate and bridge wiring, never merged.
- Engine names, flags and the output contract are documented in `scripts/speech/README.md`;
  change one without the other and the next host silently loses its voice.

## 7. Failure modes seen in practice

| Symptom | Cause | Fix |
| --- | --- | --- |
| `piper: command not found` | venv missing on this host | `setup-host.sh` |
| reply arrives silent, no error visible | bridge config not reloaded | restart the agent |
| `INVALID_PROTOBUF` from onnxruntime | truncated voice download | delete the `.onnx`, re-run `setup-host.sh` |
| long reply cut mid-sentence | `--limit` truncation | raise `--limit`, or split the reply |
| `piper.download_voices` crashes on `UnicodeEncodeError` | non-ASCII voice name (`pt_PT-tugão`) | `setup-host.sh` fetches from HF with percent-encoded URLs instead |
