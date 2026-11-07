// Appends inputPhrase lines to each user message before the turn.
// Off unless ~/.pi/input-phrase-config.json has inputPhrase.enabled true and exactly one option on.
// A section that is on with zero options, or with more than one, prints the conflict and appends nothing.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readInputPhrase } from "../../src/global-config.ts";
import { isModeAck } from "../../src/mode-ack.ts";
import { appendInputPhrase, inputPhraseApplies } from "../../src/input-phrase.ts";

function show(ctx: ExtensionContext, answer: string): void {
  if (ctx.hasUI) ctx.ui.notify(answer);
  else writeSync(1, `${answer}\n`);
}

export default function registerInputPhrase(pi: ExtensionAPI): void {
  pi.on("input", async (event, ctx) => {
    if (!inputPhraseApplies(event.text, event.source)) return { action: "continue" };
    if (isModeAck(event.text)) return { action: "continue" };
    const setting = await readInputPhrase();
    if (!setting) return { action: "continue" };
    if (setting.conflict) {
      show(ctx, setting.conflict);
      return { action: "continue" };
    }
    if (setting.lines.length === 0) return { action: "continue" };
    return { action: "transform", text: appendInputPhrase(event.text, setting.lines) };
  });
}
