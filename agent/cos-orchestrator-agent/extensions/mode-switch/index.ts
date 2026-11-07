// The mode switch: the hook above the JEV classifier.
//
// "Above" is structural, not positional: pi loads extensions in directory order, so
// src/jev-classify.ts refuses a mode request on its own (skipped: "mode request") and every
// hook after this one ignores the replacement text (src/mode-ack.ts). No order is assumed.
//
// A message that asks what the agent's mode is, or asks to change it, is answered by one or
// two or three control-plane CLI calls (`pi-config get promptBuild --json`, `pi-config use
// promptBuild.<mode>`, then the read again as a read-back). No JEV classification, no decision
// node, and no model decision about what to do: the replacement text already carries the result.
//
// A mode is the enabled promptBuild option: 1-Personal, 2-Development, 3-Work, 4-Automatic.
// "development" resolves to 2-Development; inputPhrase (normal/advanced) is untouched.
//
// Off unless ~/.pi/config.json has modeSwitch.enabled true.
// answer "model" (the default) replaces the message with an acknowledgement and lets one
// short model turn report it; the replacement is marked so the phrase appenders and the JEV
// classifier skip it. answer "hook" prints the CLI's one line itself and finishes the turn
// with no model call at all.
//
// A failed CLI never becomes a success message: the replacement quotes the exit status and
// the CLI's own words, and tells the model to say the mode did not change.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readModeSwitch } from "../../src/global-config.ts";
import { markModeAck } from "../../src/mode-ack.ts";
import { detectModeRequest, runModeRequest } from "../../src/mode-switch.ts";
import { sendTelegram, TELEGRAM } from "../../src/telegram-delivery.ts";

function show(ctx: ExtensionContext, answer: string): void {
  if (ctx.hasUI) ctx.ui.notify(answer);
  else writeSync(1, `${answer}\n`);
}

export default function registerModeSwitch(pi: ExtensionAPI): void {
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };

    const text = event.text;
    if (!text.trim() || text.trim().startsWith("/")) return { action: "continue" };
    // Pure and cheap: only a request reaches the config read and the CLI.
    if (!detectModeRequest(text)) return { action: "continue" };

    const setting = await readModeSwitch();
    if (!setting) return { action: "continue" };

    const outcome = await runModeRequest(text);
    if (!outcome) return { action: "continue" };
    if (setting.print) show(ctx, outcome.trace);

    if (setting.answer === "hook") {
      if (TELEGRAM.test(text)) {
        // Same delivery path the decision-node hooks use; a failed send keeps the turn.
        if (await sendTelegram(outcome.answer)) return { action: "handled" };
      } else {
        show(ctx, outcome.answer);
        return { action: "handled" };
      }
    }

    markModeAck(outcome.ack);
    return { action: "transform", text: outcome.ack };
  });
}
