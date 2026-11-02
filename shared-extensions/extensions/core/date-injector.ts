/**
 * date-injector.ts — Ensures the AI always knows today's date.
 *
 * Station: before_agent_start
 *
 * Small but useful: AI models don't know what date it is.
 * This injects it before every agent run.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Prepend a date reminder to the system prompt
    const dateNote = `\n\nNote: today's date is ${today}. When asked about dates or timelines, use this as the current date.\n`;

    if (typeof event.systemPrompt === "string") {
      event.systemPrompt = dateNote + event.systemPrompt;
    }
  });
}
