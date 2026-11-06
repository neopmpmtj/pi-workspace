// Calls the reminder node when the arbiter's winner for a message is `reminder` or
// `reminder_done`. Shares one classification per message with the calendar hook
// (src/jev-classify.ts) and never classifies on its own.
//
// Band act:
//   reminder       -> do:reminder:log (row in reminders.jsonl), do:reminder:calendar (event)
//   reminder_done  -> do:reminder:done (closes the matching pending reminder)
// and the message finishes here with no model turn: printed locally, or sent through the
// Telegram bridge. A failed Telegram delivery keeps the turn and attaches the hidden block.
//
// Band hint, an extractor disagreement, or a done message that matched no pending
// reminder: nothing is written, the turn runs, and the model gets a hidden hint.
//
// The writes have their own switch, reminderNode.writes (default true). With it false the
// node routes nothing at all - no row in reminders.jsonl, no calendar event, no done op - and
// the hook finishes no turn: no delivery, no hidden block, the message reaches the model as
// an ordinary turn. JEV still classifies, which is where the next destination hooks in.
//
// Reminders never touch docs/INBOX.md. Off unless ~/.pi/config.json has reminderNode.enabled true.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type ReminderNode, readReminderNode } from "../../src/global-config.ts";
import { claimAnnouncement, classifyPrompt, winnerLine } from "../../src/jev-classify.ts";
import {
  isReminderUnsure,
  reminderContextBlock,
  reminderHintBlock,
  reminderOutcomeLines,
  reminderTelegramReply,
  reminderTraceLines,
  type ReminderVerdict,
  runReminderNode,
} from "../../src/reminder-node.ts";
import { sendTelegram, TELEGRAM } from "../../src/telegram-delivery.ts";

const CLASSES = new Set(["reminder", "reminder_done"]);

function show(ctx: ExtensionContext, answer: string): void {
  if (ctx.hasUI) ctx.ui.notify(answer);
  else writeSync(1, `${answer}\n`);
}

async function judge(text: string, ctx: ExtensionContext, setting: ReminderNode): Promise<ReminderVerdict | null> {
  const jev = await classifyPrompt(text);
  if (setting.print && claimAnnouncement(text)) show(ctx, winnerLine(jev));
  if (!jev.ok || !jev.winner || !CLASSES.has(jev.winner.class) || jev.winner.band === "none") return null;
  return runReminderNode(text, { dryRun: !setting.route, writes: setting.writes, classifierJson: jev.file });
}

export default function registerReminderNode(pi: ExtensionAPI): void {
  let last: { text: string; verdict: ReminderVerdict | null; shown: boolean } | null = null;

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };

    const text = event.text.trim();
    if (!text || text.startsWith("/")) return { action: "continue" };

    const setting = await readReminderNode();
    if (!setting) return { action: "continue" };

    const verdict = await judge(text, ctx, setting);
    last = { text, verdict, shown: false };
    if (!verdict) return { action: "continue" };

    const wrote = setting.route && verdict.ok && !verdict.abstained && !isReminderUnsure(verdict) &&
      verdict.routes.some((r) => r.destination.startsWith("do:reminder:"));
    // Only a turn whose writes actually ran is finished here. With the write switch off the
    // node routes nothing and the model answers the message.
    const executed = wrote && setting.writes;

    if (TELEGRAM.test(text)) {
      if (!executed) return { action: "continue" };
      if (!(await sendTelegram(reminderTelegramReply(verdict, setting.print)))) return { action: "continue" };
      last.shown = true;
      return { action: "handled" };
    }

    if (setting.print) {
      show(ctx, reminderTraceLines(verdict).join("\n"));
      last.shown = true;
    }
    if (!executed) return { action: "continue" };

    show(ctx, reminderOutcomeLines(verdict).join("\n"));
    return { action: "handled" };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (event.messageType !== "user") return;

    const text = event.prompt.trim();
    if (!text) return;

    const setting = await readReminderNode();
    if (!setting) {
      last = null;
      return;
    }

    const cached = last && last.text === text ? last : null;
    const verdict = cached ? cached.verdict : await judge(text, ctx, setting);
    last = null;
    if (!verdict) return;

    if (setting.print && !cached?.shown) show(ctx, reminderTraceLines(verdict).join("\n"));
    if (!verdict.ok || verdict.abstained) return;

    if (isReminderUnsure(verdict)) {
      return { message: { customType: "reminder-node", content: reminderHintBlock(verdict), display: false } };
    }
    if (!setting.route || !setting.writes) return;
    return { message: { customType: "reminder-node", content: reminderContextBlock(verdict), display: false } };
  });
}
