"""Live wakeword listener for the pi TUI.

Reads the default microphone in 80 ms frames, scores each frame with an
openWakeWord ONNX model, and prints one line per event:

    READY model=hey_pamela.onnx threshold=0.60 consecutive=2 cooldown_ms=3000
    TRIGGER 0.874 at=2026-11-27T18:40:12
    STOPPED

`TRIGGER` is the input slot for the pi extension `extensions/wakeword.ts`: the
line is what makes the tone play. Do not delete it because it looks like a
status message; it is the interface.

Audio stays in memory. Nothing is written, transcribed, or sent anywhere; only
the model score is used. `SIGTERM` and Ctrl+C leave the microphone cleanly.

Run through `scripts/wakeword/wakewordctl` rather than by hand; the control
script owns the pidfile and the log. Config is `~/.config/pi-wakeword.json`
(model, threshold, consecutive, cooldown_ms); flags override it for one run.

Example (the ctl does exactly this):

    ~/python/261114-VAD-openWakeWord/vad-openwakeword/.venv/bin/python \
        ~/.pi/agent/scripts/wakeword/listen.py --config ~/.config/pi-wakeword.json
"""

from __future__ import annotations

import argparse
import json
import signal
import sys
import time
from pathlib import Path

RATE = 16_000
FRAME = 1_280  # 80 ms at 16 kHz, the openWakeWord step
DEFAULT_CONFIG = Path.home() / ".config" / "pi-wakeword.json"


def emit(line: str) -> None:
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--model", type=Path, default=None)
    parser.add_argument("--threshold", type=float, default=None)
    parser.add_argument("--consecutive", type=int, default=None)
    parser.add_argument("--cooldown-ms", type=int, default=None)
    return parser.parse_args()


def load_config(path: Path) -> dict:
    if not path.is_file():
        raise SystemExit(f"ERROR config not found: {path}")
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"ERROR config is not valid JSON ({path}): {exc}") from exc


def main() -> int:
    args = parse_args()
    config = load_config(args.config)

    model_path = Path(args.model or config.get("model") or "")
    threshold = float(args.threshold if args.threshold is not None else config.get("threshold", 0.60))
    consecutive = int(args.consecutive if args.consecutive is not None else config.get("consecutive", 2))
    cooldown_ms = int(args.cooldown_ms if args.cooldown_ms is not None else config.get("cooldown_ms", 3000))

    if not model_path.is_file():
        print(f"ERROR model not found: {model_path}", file=sys.stderr, flush=True)
        return 2
    if consecutive < 1:
        print("ERROR --consecutive must be at least 1", file=sys.stderr, flush=True)
        return 2

    # Imported late so a missing dependency prints one clean line from the ctl
    # instead of a traceback at module import.
    try:
        import numpy as np
        import sounddevice as sd
        from openwakeword.model import Model
    except Exception as exc:  # noqa: BLE001 - any import/runtime load failure is fatal
        print(f"ERROR cannot load wakeword runtime: {exc}", file=sys.stderr, flush=True)
        return 2

    stopping = False

    def request_stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    try:
        wake = Model(wakeword_models=[str(model_path)], inference_framework="onnx")
    except Exception as exc:  # noqa: BLE001 - bad/corrupt model is fatal, say why
        print(f"ERROR cannot load model {model_path}: {exc}", file=sys.stderr, flush=True)
        return 2

    try:
        stream = sd.RawInputStream(samplerate=RATE, channels=1, dtype="int16")
        stream.start()
    except Exception as exc:  # noqa: BLE001 - no mic / device busy is fatal, say why
        print(f"ERROR microphone unavailable: {exc}", file=sys.stderr, flush=True)
        return 3

    scored = 0
    last_trigger = 0.0
    emit(
        f"READY model={model_path.name} threshold={threshold:.2f} "
        f"consecutive={consecutive} cooldown_ms={cooldown_ms}"
    )

    try:
        while not stopping:
            pcm, overflowed = stream.read(FRAME)
            del overflowed
            scores = wake.predict(np.frombuffer(pcm, dtype=np.int16))
            score = max(scores.values(), default=0.0) if scores else 0.0

            if score >= threshold:
                scored += 1
            else:
                scored = 0

            now = time.monotonic()
            if scored >= consecutive and (now - last_trigger) * 1000.0 >= cooldown_ms:
                last_trigger = now
                scored = 0
                stamp = time.strftime("%Y-%m-%dT%H:%M:%S")
                emit(f"TRIGGER {score:.3f} at={stamp}")
    except Exception as exc:  # noqa: BLE001 - device unplugged mid-session
        print(f"ERROR microphone read failed: {exc}", file=sys.stderr, flush=True)
        return 3
    finally:
        try:
            stream.stop()
            stream.close()
        except Exception:  # noqa: BLE001 - closing a dead stream must not mask the exit
            pass

    emit("STOPPED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
