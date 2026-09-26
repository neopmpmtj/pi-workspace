/**
 * rate-limiter.ts — Spaces out API calls to avoid hitting rate limits.
 *
 * Station: before_provider_request
 *
 * Ensures at least 500ms between requests.
 * Simple, effective, no AI provider needed.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const LOG_FILE = join(import.meta.dirname, "..", "events.log");
const MIN_INTERVAL_MS = 500; // half a second between calls

let lastCall = 0;

function log(msg: string) {
  const ts = new Date().toISOString();
  appendFileSync(LOG_FILE, `[${ts}] RATE_LIMIT ${msg}\n`);
}

export default function (pi: ExtensionAPI) {
  pi.on("before_provider_request", async (event, ctx) => {
    const now = Date.now();
    const elapsed = now - lastCall;

    if (elapsed < MIN_INTERVAL_MS) {
      const wait = MIN_INTERVAL_MS - elapsed;
      log(`throttling: waiting ${wait}ms`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }

    lastCall = Date.now();
    // log("request allowed"); // too noisy for regular use
  });
}
