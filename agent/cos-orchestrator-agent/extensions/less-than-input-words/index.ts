// Prints true or false when the prompt has fewer words than the configured limit,
// before that turn is sent. Stays silent unless lessThanInputWords is enabled and words is set.
// print defaults to true; boolean false hides the answer. The labeled lines still go to the model.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readLessThanInputWords } from "../../src/global-config.ts";
import { isModeAck } from "../../src/mode-ack.ts";
import { lessThanInputWords, lessThanInputWordsLines } from "../../src/less-than-input-words.ts";

function show(ctx: ExtensionContext, answer: string): void {
  if (ctx.hasUI) ctx.ui.notify(answer);
  else writeSync(1, `${answer}\n`);
}

export default function registerLessThanInputWords(pi: ExtensionAPI): void {
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };
    if (isModeAck(event.text)) return { action: "continue" };
    const setting = await readLessThanInputWords();
    if (setting?.print) show(ctx, lessThanInputWords(event.text, setting.words) ? "true" : "false");
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event) => {
    if (event.messageType !== "user") return;
    if (isModeAck(event.prompt)) return;
    const setting = await readLessThanInputWords();
    if (!setting) return;
    return {
      message: {
        customType: "less-than-input-words",
        content: lessThanInputWordsLines(lessThanInputWords(event.prompt, setting.words)),
        display: false,
      },
    };
  });
}
