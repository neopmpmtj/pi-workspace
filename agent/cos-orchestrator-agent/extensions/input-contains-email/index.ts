// Prints true or false when the prompt contains one or more email addresses.
// print hides the screen line only. The labeled lines still go to the model.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readInputContainsEmail } from "../../src/global-config.ts";
import { isModeAck } from "../../src/mode-ack.ts";
import { inputContainsEmail, inputContainsEmailLines } from "../../src/input-contains-email.ts";

function show(ctx: ExtensionContext, answer: string): void {
  if (ctx.hasUI) ctx.ui.notify(answer);
  else writeSync(1, `${answer}\n`);
}

export default function registerInputContainsEmail(pi: ExtensionAPI): void {
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };
    if (isModeAck(event.text)) return { action: "continue" };
    const setting = await readInputContainsEmail();
    if (setting?.print) show(ctx, inputContainsEmail(event.text).length > 0 ? "true" : "false");
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event) => {
    if (event.messageType !== "user") return;
    if (isModeAck(event.prompt)) return;
    const setting = await readInputContainsEmail();
    if (!setting) return;
    return {
      message: {
        customType: "input-contains-email",
        content: inputContainsEmailLines(inputContainsEmail(event.prompt)),
        display: false,
      },
    };
  });
}
