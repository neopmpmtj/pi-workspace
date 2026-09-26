/**
 * custom-headers.ts — Adds custom HTTP headers to provider requests.
 *
 * Station: before_provider_headers
 *
 * Useful for tracking in API provider dashboards (OpenRouter, etc).
 * Add or remove headers as needed.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_provider_headers", async (event, ctx) => {
    event.headers["X-Pi-App"] = "explore-discover";
    event.headers["X-Pi-Model"] = ctx.model?.id ?? "unknown";
  });
}
