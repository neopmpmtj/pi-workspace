// Classifies each new message as a calendar entry and, on a match, runs the
// `calendar` node's router before the turn starts:
//   do:calendar:gog    -> `gog calendar freebusy` on the resolved slot (read-only)
//   do:calendar:create -> writes the event, only when that read said FREE
// The trace goes on screen; the result is injected so the turn relays it instead of
// repeating the work. Off unless ~/.pi/config.json has calendarRouter.enabled true.
//
// Everything happens in `before_agent_start`, not in `input`. An `input` handler that
// awaits a four-second route races the run start: the verdict can arrive after the
// block was supposed to be attached, leaving the turn blind to work already done.
// `before_agent_start` is awaited before the model request, so the block always lands.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readCalendarRouter } from "../../src/global-config.ts";
import { contextBlock, runCalendarRoute, traceLines } from "../../src/calendar-router.ts";

function show(ctx: ExtensionContext, answer: string): void {
  if (ctx.hasUI) ctx.ui.notify(answer);
  else writeSync(1, `${answer}\n`);
}

export default function registerCalendarRouter(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event, ctx) => {
    if (event.messageType !== "user") return;

    const text = event.prompt.trim();
    if (!text) return;

    const setting = await readCalendarRouter();
    if (!setting) return;

    const verdict = await runCalendarRoute(text, { dryRun: !setting.route });
    if (setting.print) show(ctx, traceLines(verdict).join("\n"));

    // A dry run writes nothing, so there is nothing to hand to the turn.
    if (!setting.route || !verdict.ok || verdict.abstained || !verdict.isMatch) return;

    return {
      message: {
        customType: "calendar-router",
        content: contextBlock(verdict),
        display: false,
      },
    };
  });
}
