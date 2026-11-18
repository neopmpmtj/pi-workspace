// Prints true or false when the prompt contains a filesystem path.
// print hides the screen line only. The labeled lines still go to the model.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readInputContainsPath } from "../../src/global-config.ts";
import { isModeAck } from "../../src/mode-ack.ts";
import { inputContainsPath, inputContainsPathLines } from "../../src/input-contains-path.ts";

function show(ctx: ExtensionContext, answer: string): void {
  if (ctx.hasUI) ctx.ui.notify(answer);
  else writeSync(1, `${answer}\n`);
}

export default function registerInputContainsPath(pi: ExtensionAPI): void {
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };
    if (isModeAck(event.text)) return { action: "continue" };
    const setting = await readInputContainsPath();
    if (setting?.print) show(ctx, inputContainsPath(event.text) ? "true" : "false");
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event) => {
    if (event.messageType !== "user") return;
    if (isModeAck(event.prompt)) return;
    const setting = await readInputContainsPath();
    if (!setting) return;
    return {
      message: {
        customType: "input-contains-path",
        content: inputContainsPathLines(inputContainsPath(event.prompt)),
        display: false,
      },
    };
  });
}
