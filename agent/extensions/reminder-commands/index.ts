// /reminders, /reminder-done and /reminder-undo. Each runs decision-nodes/reminder/route.py.
// No chat turn.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatReminderTable, type ReminderRow, runReminderCommand } from "../../src/reminder-node.ts";
import { recordCommandIfUnsaved } from "../../src/session-command.ts";

export default function registerReminderCommands(pi: ExtensionAPI): void {
  pi.registerCommand("reminders", {
    description: "The reminders table: /reminders (pending) · /reminders --all",
    handler: async (args, ctx) => {
      const command = commandLine("reminders", args);
      const all = /(^|\s)--all(\s|$)/.test(args);
      const result = await runReminderCommand(all ? ["--list", "--all"] : ["--list"]);
      if (!result.ok || !Array.isArray(result.value)) {
        fail(pi, ctx, result.ok ? "route.py --list printed no table" : result.error, command);
        return;
      }
      show(pi, ctx, formatReminderTable(result.value as ReminderRow[]), command);
    },
  });

  pi.registerCommand("reminder-done", {
    description: "Mark a reminder done: /reminder-done <id> (ids are in /reminders)",
    handler: async (args, ctx) => {
      const command = commandLine("reminder-done", args);
      const id = args.trim().split(/\s+/)[0] ?? "";
      if (!/^r-\d{8}-[0-9a-f]{4}$/.test(id)) {
        fail(pi, ctx, "usage: /reminder-done <id>, for example /reminder-done r-20261105-ab12", command);
        return;
      }
      await runAction(pi, ctx, ["--done", id], ["done", "unchanged"], command);
    },
  });

  pi.registerCommand("reminder-undo", {
    description: "Withdraw the newest pending reminder and delete its future event",
    handler: async (args, ctx) => {
      await runAction(pi, ctx, ["--undo"], ["undone", "nothing"], commandLine("reminder-undo", args));
    },
  });
}

async function runAction(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string[], good: string[], command: string): Promise<void> {
  const result = await runReminderCommand(args);
  if (!result.ok) {
    fail(pi, ctx, result.error, command);
    return;
  }
  const value = (result.value ?? {}) as { status?: string; note?: string };
  const text = `${value.status ?? "?"} · ${value.note ?? ""}`.trim();
  if (!good.includes(value.status ?? "")) {
    fail(pi, ctx, text, command);
    return;
  }
  show(pi, ctx, `[ok] ${text}`, command);
}

function show(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string, command: string): void {
  if (!ctx.hasUI) writeSync(1, `${text}\n`);
  recordCommandIfUnsaved(ctx.sessionManager, command);
  pi.sendMessage({ customType: "reminder-commands", content: text, display: true }, { triggerTurn: false });
}

function fail(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string, command: string): void {
  recordCommandIfUnsaved(ctx.sessionManager, command);
  ctx.ui.notify(text, "error");
  console.error(`[FAIL] ${text}`);
  if (!ctx.hasUI) process.exitCode = 1;
  pi.sendMessage({ customType: "reminder-commands", content: `[FAIL] ${text}`, display: true }, { triggerTurn: false });
}

function commandLine(name: string, args: string): string {
  const rest = args.trim();
  return rest ? `/${name} ${rest}` : `/${name}`;
}
