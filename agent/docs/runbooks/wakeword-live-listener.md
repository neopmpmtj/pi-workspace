# Live wakeword + voice session ("Hey Pamela")

Say **"Hey Pamela"** at the laptop: a tone plays, then whatever you say is transcribed and sent
to the agent as a prompt. One clean request is submitted immediately; several sentences wait in
a buffer until you say **"okay go"**; **"Pamela off"** (or 120 s of silence) ends the session.
The microphone is muted while the agent runs and while its answer is spoken. Built 2026-11-27.

## Chain

```
mic → openWakeWord (hey_pamela.onnx) → TRIGGER
    → wakewordctl stop (release mic) → python -m vad --session
    → Ready → tone1.wav → VAD → gpt-transcribe → phrase match / JEV
    → SUBMIT {json} → pi.sendUserMessage(markVoiceInput(text))
    → pi JEV → calendar/reminder/mode routing | model turn (answer spoken by speech-reply)
    → END → wakewordctl start
```

## Pieces

| Path | Role |
| --- | --- |
| `agent/scripts/wakeword/listen.py` | Wakeword only: openWakeWord ONNX, 80 ms frames, prints `READY` / `TRIGGER <score>` / `STOPPED`. |
| `agent/scripts/wakeword/wakewordctl` | **The one control seam** for the wakeword listener (`on/off/start/stop/restart/status/test`, pidfile, log, `enabled`). |
| `agent/extensions/wakeword.ts` | Arms at session start; TRIGGER → tone → voice session; forwards `SUBMIT`; mutes the vad during runs and speech; re-arms at `END`. Also `/wakeword` and the `wakeword` tool. |
| `agent/src/wakeword-watch.ts` | Log tailer (tested). |
| `agent/src/voice-input.ts` | `markVoiceInput` / `isVoiceInput` / `stripVoiceMarker` — lets a voice prompt pass the "extension source" guards. |
| `agent/src/speech-activity.ts` + `voice-reply.ts` | Who is speaking right now; spoken routing confirmations. |
| `~/.pi/vad-code` (own repo) | The voice session: VAD → `gpt-transcribe` → phrase match → JEV → `SUBMIT`/`END`. `python -m vad --session`. |
| `~/.config/pi-wakeword.json` | Machine-local opt-in + tuning. **No file = no listener.** |
| `agent/logs/wakeword.log`, `.pid` | Runtime state (gitignored). Lines from the extension start with `pi:`. While a voice session is live, `/wakeword status` shows `running=false`: the wakeword listener is released and the vad process owns the microphone. |

Model + venv stay in the training repo: `~/python/261114-VAD-openWakeWord/vad-openwakeword`
(`models/hey_pamela.onnx`, `.venv`). The voice session uses `~/.pi/vad-code/.venv`.

## Commands

```
/wakeword                 status
/wakeword on              arm the wakeword + listen now (aliases enable, resume)
/wakeword off             end any voice session, stop the listener, stay off next session (disable, pause)
/wakeword restart         stop → start (after a threshold change)
/wakeword test            play the tone once
```

The agent has the same actions through the **`wakeword` tool**; a terminal uses
`agent/scripts/wakeword/wakewordctl <action>`. Ending any of these actions during a voice
session also closes the session (the vad process is stopped first).

## Config `~/.config/pi-wakeword.json`

```json
{
  "enabled": true,
  "phrase": "hey pamela",
  "python": "/home/pmpmt/python/261114-VAD-openWakeWord/vad-openwakeword/.venv/bin/python",
  "model": "/home/pmpmt/python/261114-VAD-openWakeWord/vad-openwakeword/models/hey_pamela.onnx",
  "tone": "/home/pmpmt/.pi/agent/scripts/wakeword/tone1.wav",
  "threshold": 0.6,
  "consecutive": 2,
  "cooldown_ms": 3000,
  "capture": true,
  "vadHome": "/home/pmpmt/.pi/vad-code",
  "vadPython": "/home/pmpmt/.pi/vad-code/.venv/bin/python",
  "sessionIdleS": 120
}
```

`threshold`/`consecutive`/`cooldown_ms` tune the wakeword. `capture: false` keeps the tone but
skips transcription. `sessionIdleS` ends a silent session. Restart after editing.

## Voice session rules (in `vad-code`)

| Phrase result | Action |
| --- | --- |
| `Pamela off` / `Power off` **as the whole utterance** | submit any buffered text, then end; the wakeword re-arms. `power off the lights` stays a request (buffered). |
| `okay go` / `OK Go` / `OK Vai` | submit the buffer; the command words are not sent |
| JEV says **yes** (exactly one request) | submit buffer + this phrase immediately |
| JEV says **no** | append to the buffer and keep listening |
| short / empty / transcription error | nothing, log only |
| 120 s without a phrase | end, re-arm |

Phrases are in `~/.pi/vad-code/src/phrase_match/config.py`. Add a mishearing as a new phrase
(e.g. the transcriber heard "Pavlov" once from synthetic speech). The short-clip gate cutoff is
`min_content_s = 0.5` in `src/short_clip_gate/config.py`.

## Mute while the agent answers

`speech-reply.ts` (TUI answers) and `voice-reply.ts` (routed calendar/reminder confirmations)
bracket playback with `speechStarted()` / `speechFinished()` in `agent/src/speech-activity.ts`.
The wakeword extension mutes the vad with `SIGUSR1` on `agent_start` **and** whenever speech is
active, and unmutes with `SIGUSR2` when the run is settled and no audio is playing. Frames are
read but dropped, so the agent's own voice is never transcribed. Barge-in during a run is off
by design.

## Pi-side routing

The transcript is sent with `markVoiceInput`, which passes the `event.source === "extension"`
guards in `calendar-node`, `reminder-node`, `mode-switch`, `input-phrase` and the
`input-contains-*` / `less-than-input-words` tags. Behaviour is then identical to typed input:
same JEV winner, same bands, same Telegram/TUI delivery, same `review.jsonl` rows.

A routed voice request (calendar/reminder) finishes without a model turn, so its outcome line is
spoken directly through `scripts/speech/speak.sh --play`. Prompt templates are never expanded
for voice (`pi.sendUserMessage` default), so a spoken `/command` cannot run.

## Host scope

Only a host with `~/.config/pi-wakeword.json` starts anything (the VPS has none). Only an
interactive session (`ctx.mode === "tui"`) arms it. One listener per host; the pidfile records
`owner=<pi pid>` and a session stops the listener on quit only if it started it. A second
window or a short-lived `pi --print` cannot take the mic away from the session that armed it.

## Verify (2026-11-27)

- Wakeword: a synthetic "hey pamela" clip through the speakers scored `TRIGGER 0.732`, and the
  extension spawned `aplay …/tone1.wav` ~350 ms later.
- Pipeline (audio injected into the real loop, no mic): `[1] What time is it?` → JEV `yes`
  (0.96) → `SUBMIT {"text":"What time is it?","reason":"single"}`.
- Extension bridge (fake vad): `session_start` → TRIGGER → `SUBMIT` forwarded with the marker →
  `END` → wakeword re-armed; quit stopped it.
- `agent/test/wakeword-watch.test.ts` 4/4; `tsc --noEmit` clean; `check-registers.sh` OK.
- The physical speaker→mic path is weak for the VAD (laptop DMIC at 34%); a real voice at the
  mic is the intended input. The wakeword model is far more tolerant of speaker audio.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `disabled; not starting` | `enabled` is false — `/wakeword on`. |
| Tone plays, nothing is submitted | speech too short (`No text detected` in the vad output) or JEV said `no` — see `BUFFER n` in `agent/logs/wakeword.log`; say "okay go". |
| Phrase said, no `END` | the transcript did not match a phrase (e.g. "Pavlov"); add the mishearing to `phrase_match/config.py`, or `/wakeword off`. |
| `ERROR microphone unavailable` | another process holds the mic; `/wakeword off`, free it, `/wakeword on`. |
| Fires on the TV | raise `threshold` to 0.7, `consecutive` to 3, `/wakeword restart`. |
| Nothing after "Hey Pamela" | check `READY`/`TRIGGER` in `agent/logs/wakeword.log`; if the model/venv path is wrong, `wakewordctl start` prints the tail. |
| Voice prompt not routed to calendar | the marker was stripped or the hook guard was changed; check `isVoiceInput` in `src/voice-input.ts` and the `input` guard in `calendar-node/index.ts`. |
