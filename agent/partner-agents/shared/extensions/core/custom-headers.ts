/**
 * custom-headers.ts — Adds custom HTTP headers to provider requests.
 *
 * Station: before_provider_headers
 *
 * Useful for tracking in API provider dashboards (OpenRouter, etc).
 * Add or remove headers as needed.
 */
import { basename, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Identify the running agent in provider dashboards without hardcoding a name.
// Resolution order: PI_AGENT_NAME -> basename(PI_CODING_AGENT_DIR) ->
// the workspace this extension was copied into (the parent of extensions/).
const APP_NAME =
  (process.env.PI_AGENT_NAME
    ?? basename(process.env.PI_CODING_AGENT_DIR ?? join(import.meta.dirname, "..")))
  || "pi-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_provider_headers", async (event, ctx) => {
    event.headers["X-Pi-App"] = APP_NAME;
    event.headers["X-Pi-Model"] = ctx.model?.id ?? "unknown";
  });
}
