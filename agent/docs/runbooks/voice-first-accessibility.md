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
- **But when the user asks to see it** — "print it", "print to screen", "show on screen",
  "show on Telegram" — the same turn must be text, not speech. Run
  `agent/scripts/speech/print-to-screen.sh` **before** the final answer; it arms a one-shot
  flag that `speak.sh` consumes, the bridge finds no voice handler, and it delivers the
  planned text reply instead. See § 4b.
- Anything genuinely important gets written to a file **and** said, because the file survives
  and the speech is how the user receives it.

## 4b. Print to screen — one text-only reply on request

The bridge has no per-turn "text instead of voice" switch: with
`voice.replyMode: always` every Telegram answer is intercepted into a voice note. The
trigger phrases are therefore handled by a **one-shot file gate inside `speak.sh`**, the
single TTS seam every surface already calls:

```
telegram.json  voice handler -> scripts/speech/speak.sh -o {ogg}
                                  | flag fresh?  yes -> rm flag, exit 5, no audio
                                  | no          -> synthesise as usual
scripts/speech/print-to-screen.sh -> tmp/voice-textonly.flag   (epoch seconds)
```

When the user says print/show on screen, print to Telegram, "print it", or "text only",
the agent runs `print-to-screen.sh` in that same turn, before the answer. `speak.sh`
consumes the flag, the bridge records a voice-handler failure, finds no other provider, and
delivers the planned **text** reply (its documented fallback path). The TUI extension sees
the same exit 5 and stays quiet.

Properties worth keeping:

- **No config change and no reload.** The Telegram handler keeps pointing at `speak.sh`, so
  there is nothing to reload and no restart; the gate ships by `git pull`.
- **One shot.** The flag is deleted on use; a normal answer is never silenced twice.
- **Self-healing.** A flag older than 20 min is ignored, so a turn that ended without a voice
  step (abort, empty answer) cannot mute the next one. `PI_SPEECH_TEXTONLY_FLAG` and
  `PI_SPEECH_TEXTONLY_TTL` override path and window.
- **A "voice failed" runtime event is expected** on text-only turns (phase
  `voice-artifacts`). It is the fallback working, not a broken engine.

Self-test without Telegram:

```bash
cd ~/.pi/agent
printf 'spoken test' | scripts/speech/speak.sh -o /tmp/v.ogg; echo $?   # 0 + file
scripts/speech/print-to-screen.sh
printf 'text test'  | scripts/speech/speak.sh -o /tmp/v.ogg; echo $?   # 5, no file
```

## 5. Roadmap (agreed, not built)

| Step | Why | Cost |
| --- | --- | --- |
| ~~Laptop TUI speech extension~~ — done 2026-11-25 | laptop sessions went unspoken | `agent/extensions/speech-reply.ts`, off unless `PI_SPEECH_TUI=1`; live `/speech on\|off` since 2026-11-28 |
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

### The live switch

| command | effect |
| --- | --- |
| `/speech on` | speak laptop answers from the next answer on, and save `PI_SPEECH_TUI=1` |
| `/speech off` | stay silent from the next answer on, and save `PI_SPEECH_TUI=0` |
| `/speech` or `/speech status` | `speech on\|off · source <where the value came from> · speak.sh ok\|MISSING` |
| `/speech toggle` | the opposite of what is in force now |

Properties worth keeping:

- **No restart.** The extension reads the gate on every turn instead of at load, so a switch
  is in force for the very next answer. New *code* still needs `/reload` (or a new session) —
  the command itself can never be half-loaded.
- **The command outlives the gate.** It is registered before the on/off check, so `/speech on`
  exists while speech is off. That was the point: editing the env file used to need a restart.
- **Precedence:** a `/speech` answer for this session → `$PI_SPEECH_TUI` → the env file. A
  stale shell variable can therefore not undo a `/speech off`, and the next session starts
  from the file again.
- **The newest write wins.** `/speech` remembers the env file's mtime when it answers; if the
  file is written afterwards by the site or by `host-toggle.sh`, the file's value takes over
  on the next turn. That is what keeps a page toggle from being masked by an older `/speech`.
- **The project site writes the same file.** Settings at `http://127.0.0.1:8786/settings` calls
  `agent/src/speech-switch.ts`, the writer `/speech` uses — there is no second rewrite to rot.
- **The file is the durable store, and it is written surgically:** only the `PI_SPEECH_TUI`
  line changes; comments, the voice and rate lines, and a duplicate line (dropped, because
  only the first would be read) are handled atomically via temp-file rename, mode 600.
- **A failed write is not a silent lie.** The switch still works for the session and
  `/speech` prints `[warn] … could not write ~/.config/pi-speech.env: <err>`.
- **Telegram is untouched** by this command: it is the TUI surface only. The Telegram switch is
  the next section.
- **Tested** by `agent/test/speech-toggle.test.ts` (parse, replace, append, duplicate, create,
  private mode, newest-writer mtime), `agent/test/speech-command.test.ts` (the command wires up
  and the file follows), `agent/test/speech-host.test.ts` (`host-toggle.sh` and the gate) and
  `control/site.test.ts` (the same writer from the project site, and the VPS card).

### The Telegram switch (VPS) — live, without a bridge restart

`voice.replyMode` in `~/.pi/agent/telegram.json` is read when the bridge starts, so changing it
is restart-class. The bridge has a second seam that is not: it spawns
`scripts/speech/speak.sh` for every voice artifact, and that script re-reads
`~/.config/pi-speech.env` on every call.

| Key | Read by | Effect of `0` |
| --- | --- | --- |
| `PI_SPEECH_TELEGRAM=0` | `speak.sh`, when `--play` is absent | exit 5, no artifact — the bridge's documented text fallback sends the reply as text |
| `PI_SPEECH_TELEGRAM` absent or `1` | same | voice notes as usual |

`--play` marks the laptop TUI, which has its own key, so the Telegram gate can never silence a
laptop answer. Exit 5 is the same answer "print it" already uses: `print-to-screen.sh`
consumes its one-shot flag first, then this durable gate.

- **Writes:** `agent/scripts/speech/host-toggle.sh status|set tui|telegram on|off`, one JSON line,
  rules from `agent/src/speech-switch.ts` (never re-implemented in bash).
  `node --experimental-strip-types agent/src/speech-env-cli.ts` is what it execs.
- **Site:** `/settings` → **VPS** card. The site calls the script locally when this host owns
  the bot (its `telegram.json` exists) and over `ssh neopmpmtj` otherwise, with a fixed
  allowlist, `BatchMode=yes`, a 4s timeout. Unreachable renders the ssh reason, never a fake off.
- **The page shows `replyMode` read-only** (`always`) precisely because it cannot change it
  live; a control that needs a restart would be a lie on a page about immediacy.
- **Proof:** `PI_SPEECH_TELEGRAM=0 bash ~/.pi/agent/scripts/speech/speak.sh -t hi -o /tmp/x.ogg`
  exits 5 and writes nothing; with `--play` it proceeds.

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
