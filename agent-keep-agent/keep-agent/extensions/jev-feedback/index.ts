// /jev-wrong <label> files the last classified message into the JEV eval set with the
// right label; /calendar-undo deletes the last event the calendar node created. No chat turn.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { appendGolden, goldenFile, JEV_LABELS, parseJevLabel, runCalendarUndo } from "../../src/jev-feedback.ts";
import { lastClassification } from "../../src/jev-classify.ts";
import { recordCommandIfUnsaved } from "../../src/session-command.ts";

export default function registerJevFeedback(pi: ExtensionAPI): void {
  pi.registerCommand("jev-wrong", {
    description: `Label the last message for the JEV eval set: /jev-wrong <${JEV_LABELS.join("|")}>`,
    handler: async (args, ctx) => {
      const command = args.trim() ? `/jev-wrong ${args.trim()}` : "/jev-wrong";
      const label = parseJevLabel(args);
      if (!label) {
        fail(pi, ctx, `usage: /jev-wrong <${JEV_LABELS.join("|")}>`, command);
        return;
      }
      const last = lastClassification();
      if (!last?.ok || !last.winner) {
        fail(pi, ctx, "no classified message in this session yet", command);
        return;
      }
      const result = await appendGolden(last.text, label, `${last.winner.class}:${last.winner.band}`, goldenFile());
      show(pi, ctx, `[ok] ${result} · "${last.text}" was ${last.winner.class} ${last.winner.band}, now labelled ${label}`, command);
    },
  });

  pi.registerCommand("calendar-undo", {
    description: "Delete the last event the calendar node created",
    handler: async (args, ctx) => {
      const command = args.trim() ? `/calendar-undo ${args.trim()}` : "/calendar-undo";
      const result = await runCalendarUndo();
      const text = `${result.status}${result.event_id ? ` ${result.event_id}` : ""} · ${result.note}`;
      if (!["deleted", "dry-run", "nothing"].includes(result.status)) {
        fail(pi, ctx, text, command);
        return;
      }
      show(pi, ctx, `[ok] ${text}`, command);
    },
  });
}

function show(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string, command: string): void {
  if (!ctx.hasUI) writeSync(1, `${text}\n`);
  recordCommandIfUnsaved(ctx.sessionManager, command);
  pi.sendMessage({ customType: "jev-feedback", content: text, display: true }, { triggerTurn: false });
}

function fail(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string, command: string): void {
  recordCommandIfUnsaved(ctx.sessionManager, command);
  ctx.ui.notify(text, "error");
  console.error(`[FAIL] ${text}`);
  if (!ctx.hasUI) process.exitCode = 1;
  pi.sendMessage({ customType: "jev-feedback", content: `[FAIL] ${text}`, display: true }, { triggerTurn: false });
}
