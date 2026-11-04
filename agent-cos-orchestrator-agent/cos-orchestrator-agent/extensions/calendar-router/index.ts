// Classifies each new message as a calendar entry and, on a match, runs the
// `calendar` node's router before the turn starts:
//   do:calendar:gog    -> `gog calendar freebusy` on the resolved slot (read-only)
//   do:calendar:create -> writes the event, only when that read said FREE
// The trace goes on screen; the result is injected so the turn relays it instead of
// repeating the work. Off unless ~/.pi/config.json has calendarRouter.enabled true.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readCalendarRouter } from "../../src/global-config.ts";
import { type CalendarVerdict, contextBlock, runCalendarRoute, traceLines } from "../../src/calendar-router.ts";

function show(ctx: ExtensionContext, answer: string): void {
  if (ctx.hasUI) ctx.ui.notify(answer);
  else writeSync(1, `${answer}\n`);
}

export default function registerCalendarRouter(pi: ExtensionAPI): void {
  // Set by `input`, consumed by the run it belongs to. Cleared on every input, so a
  // verdict can never leak into a later turn.
  let pending: CalendarVerdict | null = null;

  pi.on("input", async (event, ctx) => {
    pending = null;
    if (event.source === "extension") return { action: "continue" };

    const text = event.text.trim();
    if (!text || text.startsWith("/")) return { action: "continue" };

    const setting = await readCalendarRouter();
    if (!setting) return { action: "continue" };

    const verdict = await runCalendarRoute(text, { dryRun: !setting.route });
    if (setting.print) show(ctx, traceLines(verdict).join("\n"));

    // Only a real, executed match is handed to the turn; a dry run stays on screen.
    if (setting.route && verdict.ok && !verdict.abstained && verdict.isMatch) pending = verdict;
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event) => {
    if (event.messageType !== "user") return;
    const verdict = pending;
    pending = null;
    if (!verdict) return;
    return {
      message: {
        customType: "calendar-router",
        content: contextBlock(verdict),
        display: false,
      },
    };
  });
}
