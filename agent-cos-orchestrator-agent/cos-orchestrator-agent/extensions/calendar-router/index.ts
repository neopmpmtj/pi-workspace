// Classifies each new message as a calendar entry and, on a match, runs the
// `calendar` node's router before the turn starts:
//   do:calendar:gog    -> `gog calendar freebusy` on the resolved slot (read-only)
//   do:calendar:create -> writes the event, only when that read said FREE
//
// Two surfaces, two ways of finishing:
//   * local (TUI, `-p`): the extension prints the trace and the outcome and returns
//     "handled", so no model turn runs at all - the node already did the work.
//   * Telegram: the bridge delivers assistant text, so a swallowed turn would send
//     nothing. There the node runs in the awaited `before_agent_start` and the reply
//     relays the injected block.
//
// It is never both: a handled input does not reach before_agent_start.
// Off unless ~/.pi/config.json has calendarRouter.enabled true.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readCalendarRouter } from "../../src/global-config.ts";
import {
  type CalendarVerdict,
  contextBlock,
  outcomeLines,
  runCalendarRoute,
  traceLines,
} from "../../src/calendar-router.ts";

/** Telegram prompts carry a surface prefix; those replies must come from the model. */
const TELEGRAM = /^\s*\[telegram/i;

function show(ctx: ExtensionContext, answer: string): void {
  if (ctx.hasUI) ctx.ui.notify(answer);
  else writeSync(1, `${answer}\n`);
}

export default function registerCalendarRouter(pi: ExtensionAPI): void {
  // One verdict per prompt, so a turn that was not swallowed never re-runs the node.
  let last: { text: string; verdict: CalendarVerdict; shown: boolean } | null = null;

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };

    const text = event.text.trim();
    if (!text || text.startsWith("/")) return { action: "continue" };

    const setting = await readCalendarRouter();
    if (!setting) return { action: "continue" };

    if (TELEGRAM.test(text)) return { action: "continue" };

    const verdict = await runCalendarRoute(text, { dryRun: !setting.route });
    last = { text, verdict, shown: false };

    if (setting.print) {
      show(ctx, traceLines(verdict).join("\n"));
      last.shown = true;
    }

    const executed = setting.route && verdict.ok && !verdict.abstained && verdict.isMatch;
    if (!executed) return { action: "continue" };

    show(ctx, outcomeLines(verdict).join("\n"));
    return { action: "handled" };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (event.messageType !== "user") return;

    const text = event.prompt.trim();
    if (!text) return;

    const setting = await readCalendarRouter();
    if (!setting) {
      last = null;
      return;
    }

    const cached = last && last.text === text ? last : null;
    const verdict = cached?.verdict ?? (await runCalendarRoute(text, { dryRun: !setting.route }));
    last = null;

    if (setting.print && !cached?.shown) show(ctx, traceLines(verdict).join("\n"));

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
