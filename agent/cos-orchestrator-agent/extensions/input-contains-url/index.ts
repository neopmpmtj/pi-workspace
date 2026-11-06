// Prints true or false when the prompt contains a URL.
// print hides the screen line only. The labeled lines still go to the model.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readInputContainsUrl } from "../../src/global-config.ts";
import { inputContainsUrl, inputContainsUrlLines } from "../../src/input-contains-url.ts";

function show(ctx: ExtensionContext, answer: string): void {
  if (ctx.hasUI) ctx.ui.notify(answer);
  else writeSync(1, `${answer}\n`);
}

export default function registerInputContainsUrl(pi: ExtensionAPI): void {
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };
    const setting = await readInputContainsUrl();
    if (setting?.print) show(ctx, inputContainsUrl(event.text) ? "true" : "false");
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event) => {
    if (event.messageType !== "user") return;
    const setting = await readInputContainsUrl();
    if (!setting) return;
    return {
      message: {
        customType: "input-contains-url",
        content: inputContainsUrlLines(inputContainsUrl(event.prompt)),
        display: false,
      },
    };
  });
}
