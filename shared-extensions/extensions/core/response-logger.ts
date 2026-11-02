/**
 * response-logger.ts — Tracks provider response times.
 *
 * Station: before_provider_request + after_provider_response
 *
 * Pairs the two stations to measure how long each API call takes.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const LOG_FILE = join(import.meta.dirname, "..", "events.log");
let lastCallStart = 0;

function log(msg: string) {
  const ts = new Date().toISOString();
  appendFileSync(LOG_FILE, `[${ts}] RESPONSE ${msg}\n`);
}

export default function (pi: ExtensionAPI) {
  pi.on("before_provider_request", async (event, ctx) => {
    lastCallStart = Date.now();
  });

  pi.on("after_provider_response", async (event, ctx) => {
    const duration = Date.now() - lastCallStart;
    const status = event.status;
    const p = event.payload as any;
    const model = p?.model ?? "unknown";

    let emoji = "✓";
    if (status >= 400 && status < 500) emoji = "⚠";
    else if (status >= 500) emoji = "✗";

    log(`${emoji} ${status} ${model} — ${duration}ms`);
  });
}
