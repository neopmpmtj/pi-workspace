// Classifies each new message as a calendar entry and, on a match, runs the
// `calendar` node's router before the turn starts:
//   do:calendar:gog    -> `gog calendar freebusy` on the resolved slot (read-only)
//   do:calendar:create -> writes the event, only when that read said FREE
//
// A matched message finishes inside this extension, with no model turn:
//   * local (TUI, `-p`): the trace and the outcome go to stdout, input is "handled".
//   * Telegram: the same text is sent through the bridge's delivery API to the current
//     turn's target, then input is "handled".
// If Telegram delivery fails - bridge not running, no bound target - the turn is NOT
// swallowed: input continues and `before_agent_start` attaches the hidden block so the
// reply still reaches the user.
//
// It is never both: a handled input does not reach before_agent_start.
// Off unless ~/.pi/config.json has calendarRouter.enabled true.
import { writeSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readCalendarRouter } from "../../src/global-config.ts";
import {
  type CalendarVerdict,
  contextBlock,
  outcomeLines,
  runCalendarRoute,
  telegramReply,
  traceLines,
} from "../../src/calendar-router.ts";

/** Telegram prompts carry a surface prefix; only those go through the bridge. */
const TELEGRAM = /^\s*\[telegram/i;

function show(ctx: ExtensionContext, answer: string): void {
  if (ctx.hasUI) ctx.ui.notify(answer);
  else writeSync(1, `${answer}\n`);
}

/** The bridge's public delivery entry, installed under this agent home. */
function deliveryModule(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PI_TELEGRAM_DELIVERY?.trim();
  if (override) return override;
  return path.join(env.HOME ?? "", ".pi", "agent-cos-orchestrator-agent", "cos-orchestrator-agent",
    "npm", "node_modules", "@llblab", "pi-telegram", "dist", "api", "delivery.js");
}

type SendView = (
  view: { text: string; parseMode?: string },
  options: { scope: { kind: string } },
) => Promise<{ ok: boolean; reason?: string }>;

/**
 * Deliver text to the Telegram surface this session is bound to. Tries the exact turn
 * target first, then the instance's assigned thread or paired chat. Returns false when
 * the bridge is absent or refuses - the caller then keeps the model turn.
 */
export async function sendTelegram(text: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try {
    const module = (await import(pathToFileURL(deliveryModule(env)).href)) as { sendTelegramView?: SendView };
    const send = module.sendTelegramView;
    if (typeof send !== "function") return false;
    for (const kind of ["active-turn", "instance"]) {
      const sent = await send({ text }, { scope: { kind } });
      if (sent?.ok) return true;
    }
    return false;
  } catch {
    return false;
  }
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

    const verdict = await runCalendarRoute(text, { dryRun: !setting.route });
    last = { text, verdict, shown: false };
    const executed = setting.route && verdict.ok && !verdict.abstained && verdict.isMatch;

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
