/**
 * Watches the wakeword listener's log for `TRIGGER` lines.
 *
 * The listener is a separate process owned by `scripts/wakeword/wakewordctl`, so
 * its log is the only channel back to the pi extension. Polling a stat plus the
 * new bytes is cheaper than a pipe per listener and survives a restart from any
 * surface, `/reload`, and a crashed child.
 *
 * `TRIGGER` is the interface line emitted by `scripts/wakeword/listen.py`. A
 * half-written trailing line is held until its newline arrives, and a truncated
 * or rotated file resets the read offset so the next trigger is not lost.
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";

export interface TriggerWatch {
  stop(): void;
}

export function startTriggerWatch(logPath: string, onTrigger: () => void, pollMs = 350): TriggerWatch {
	let offset = 0;
	let pending = "";

	// Only triggers from now on: a previous session's hits must not fire a tone at startup.
	try {
		offset = statSync(logPath).size;
	} catch {
		offset = 0;
	}

	const poll = (): void => {
		let size: number;
		try {
			size = statSync(logPath).size;
		} catch {
			return;
		}
		if (size < offset) offset = 0; // truncated or rotated by the ctl
		if (size === offset) return;

		const length = size - offset;
		const buffer = Buffer.alloc(length);
		const fd = openSync(logPath, "r");
		try {
			readSync(fd, buffer, 0, length, offset);
		} finally {
			closeSync(fd);
		}
		offset = size;

		const lines = (pending + buffer.toString("utf8")).split("\n");
		pending = lines.pop() ?? ""; // a half-written line waits for its newline
		for (const line of lines) {
			if (line.startsWith("TRIGGER")) onTrigger();
		}
	};

	const timer = setInterval(poll, pollMs);
	timer.unref?.();
	return {
		stop(): void {
			clearInterval(timer);
		},
	};
}
