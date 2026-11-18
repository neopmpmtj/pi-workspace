// Calls the calendar node when the arbiter's winner for a message is `calendar`.
// One classification per message is shared with the other decision-node hooks
// (src/jev-classify.ts); this hook never classifies on its own.
//
// Band act: the node runs its destinations:
//   do:calendar:gog    -> `gog calendar freebusy` on the resolved slot (read-only)
//   do:calendar:create -> writes the event, only when that read said FREE
// and the message finishes inside this extension, with no model turn:
//   * local (TUI, `-p`): the trace and the outcome go to stdout, input is "handled".
//   * Telegram: the same text is sent through the bridge's delivery API, then "handled".
// If Telegram delivery fails the turn is NOT swallowed: `before_agent_start` attaches
// the hidden block so the reply still reaches the user.
//
// Band hint, or the extractor disagreed: nothing is written, the turn runs, and the
// model gets a hidden hint to ask before anything is created.
//
// Off unless ~/.pi/config.json has calendarNode.enabled true.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readCalendarNode } from "../../src/global-config.ts";
import {
  type CalendarVerdict,
  contextBlock,
  hintBlock,
  isUnsure,
  outcomeLines,
  runCalendarNode,
  telegramReply,
  traceLines,
} from "../../src/calendar-node.ts";
import { claimAnnouncement, classifyPrompt, type JevClassification, winnerLine } from "../../src/jev-classify.ts";
import { sendTelegram, TELEGRAM } from "../../src/telegram-delivery.ts";

function show(ctx: ExtensionContext, answer: string): void {
  if (ctx.hasUI) ctx.ui.notify(answer);
  else writeSync(1, `${answer}\n`);
}

/** Classify once (shared), print the winner line once, and run the node when calendar won. */
async function judge(text: string, ctx: ExtensionContext, print: boolean, route: boolean):
  Promise<{ jev: JevClassification; verdict: CalendarVerdict | null }> {
  const jev = await classifyPrompt(text);
  if (print && claimAnnouncement(text)) show(ctx, winnerLine(jev));
  if (!jev.ok || jev.winner?.class !== "calendar" || jev.winner.band === "none") return { jev, verdict: null };
  const verdict = await runCalendarNode(text, { dryRun: !route, classifierJson: jev.file });
  return { jev, verdict };
}

export default function registerCalendarNode(pi: ExtensionAPI): void {
  // One verdict per prompt, so a turn that was not swallowed never re-runs the node.
  let last: { text: string; verdict: CalendarVerdict | null; shown: boolean } | null = null;

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };

    const text = event.text.trim();
    if (!text || text.startsWith("/")) return { action: "continue" };

    const setting = await readCalendarNode();
    if (!setting) return { action: "continue" };

    const { verdict } = await judge(text, ctx, setting.print, setting.route);
    last = { text, verdict, shown: false };
    if (!verdict) return { action: "continue" };

    const executed = setting.route && verdict.ok && !verdict.abstained && !isUnsure(verdict) &&
      verdict.routes.some((route) => route.destination === "do:calendar:create");

    if (TELEGRAM.test(text)) {
      if (!executed) return { action: "continue" };
      if (!(await sendTelegram(telegramReply(verdict, setting.print)))) {
        return { action: "continue" };   // no delivery: let the model reply instead
      }
      last.shown = true;
      return { action: "handled" };
    }

    if (setting.print) {
      show(ctx, traceLines(verdict).join("\n"));
      last.shown = true;
    }
    if (!executed) return { action: "continue" };

    show(ctx, outcomeLines(verdict).join("\n"));
    return { action: "handled" };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (event.messageType !== "user") return;

    const text = event.prompt.trim();
    if (!text) return;

    const setting = await readCalendarNode();
    if (!setting) {
      last = null;
      return;
    }

    const cached = last && last.text === text ? last : null;
    const verdict = cached ? cached.verdict : (await judge(text, ctx, setting.print, setting.route)).verdict;
    last = null;
    if (!verdict) return;

    if (setting.print && !cached?.shown) show(ctx, traceLines(verdict).join("\n"));
    if (!verdict.ok || verdict.abstained) return;

    if (isUnsure(verdict)) {
      return { message: { customType: "calendar-node", content: hintBlock(verdict), display: false } };
    }
    if (!setting.route) return;

    return {
      message: {
        customType: "calendar-node",
        content: contextBlock(verdict),
        display: false,
      },
    };
  });
}
