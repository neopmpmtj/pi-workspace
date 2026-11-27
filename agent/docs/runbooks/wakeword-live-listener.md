# Live wakeword ("Hey Pamela") in the pi TUI

Say **"Hey Pamela"** at the laptop and a tone plays. The microphone is open for the
whole interactive session; detection is local, and no audio is written, transcribed, or
sent to a model. Built 2026-11-27.

## Pieces

| Path | Role |
| --- | --- |
| `agent/scripts/wakeword/listen.py` | Microphone loop. openWakeWord ONNX model, 80 ms frames, prints `READY` / `TRIGGER <score> at=<time>` / `STOPPED`. SIGTERM-safe. |
| `agent/scripts/wakeword/wakewordctl` | **The one control seam.** `on/off/restart/start/stop/status/test`, owns the pidfile, log, and `enabled` flag. |
| `agent/scripts/wakeword/tone1.wav` | The cue (44.1 kHz mono). Played with `aplay`, fallback `pw-play`. |
| `agent/extensions/wakeword.ts` | `session_start` → `wakewordctl start`; watches the log and plays the tone on `TRIGGER`; `session_shutdown` (quit only) → `stop-if-owner`. Also `/wakeword` and the `wakeword` tool. |
| `agent/src/wakeword-watch.ts` | Log tailer used by the extension (tested in `agent/test/wakeword-watch.test.ts`). |
| `~/.config/pi-wakeword.json` | Machine-local opt-in + tuning (mode 600). **No file = no listener.** |
| `agent/logs/wakeword.log`, `.pid` | Runtime state (gitignored). |

The model and Python env stay in the training repo:

- model `~/python/261114-VAD-openWakeWord/vad-openwakeword/models/hey_pamela.onnx`
- venv `~/python/261114-VAD-openWakeWord/vad-openwakeword/.venv`
- training repo `neopmpmtj/vad-openwakeword` (private); 90 synthetic positives / 180 negatives, no recorded takes.

## Commands

```
/wakeword                       status (same as below)
/wakeword on                    arm + start now; survives the next session
/wakeword off                   stop now + stay off at the next session
/wakeword restart               stop then start (after a threshold/model edit)
/wakeword test                  play the tone once
```

Aliases: `enable`, `resume` = on; `disable`, `pause` = off.

The agent can run the same actions with the **`wakeword` tool** (`action: on|off|restart|status|test`),
and a terminal uses the script, which behaves identically:

```bash
~/.pi/agent/scripts/wakeword/wakewordctl status
~/.pi/agent/scripts/wakeword/wakewordctl restart
```

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
  "cooldown_ms": 3000
}
```

- `threshold` — frame score needed. Raise to 0.7+ if the TV triggers it; lower to 0.5 if
  your voice misses. The model is synthetic-only and the README of the training repo warns
  that near-misses such as "hello pamela" score above 0.5.
- `consecutive` — frames in a row above the threshold. 2 = ~160 ms of evidence.
- `cooldown_ms` — minimum gap between tones.
- `enabled` — written by `on`/`off`; this is what survives a restart.

Run `/wakeword restart` after editing. Creating the file on a host is what turns the
feature on there; the VPS has none, so its sessions never touch the microphone.

## Host scope

- The extension loads on both hosts (same repo). Only a host with
  `~/.config/pi-wakeword.json` and a microphone starts anything.
- Only an interactive session (`ctx.mode === "tui"`) arms it. `pi --print`, cron sessions,
  and sibling agents do not.
- One listener per host: `start` is a no-op when the pid is alive.
- The pidfile records `owner=<pi pid>`. A session stops the listener on quit only when it
  is the owner, so a second window or a short-lived `pi --print` cannot take the mic away
  from the session that armed it.

## Verify

```bash
~/.pi/agent/scripts/wakeword/wakewordctl status   # enabled=true running=true pid=NNNN
tail -f ~/.pi/agent/logs/wakeword.log             # READY at start, TRIGGER on a hit
```

Detection was verified end-to-end on 2026-11-27 by playing a synthetic positive clip
through the speakers: `TRIGGER 0.732`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `disabled; not starting` | `enabled` is false — `/wakeword on`. |
| `ERROR microphone unavailable` | another process holds the mic (`python -m vad`, voice-dictate, OBS). `/wakeword stop`, free it, `/wakeword on`. |
| No `TRIGGER` at all | check `READY` exists in the log; if not, the model or venv path in the config is wrong (`wakewordctl start` prints the tail). |
| Fires on the TV | raise `threshold` to 0.7 and `consecutive` to 3, then `/wakeword restart`. |
| Tone silent, trigger logged | speaker/volume/sink issue, not detection: `wakewordctl test`. |
| Two tones per phrase | two sessions each watching the same log; only one TUI session per host is expected. |

The mic stays open while the listener runs — that is the trade-off for instant detection.
`/wakeword off` releases it immediately.
