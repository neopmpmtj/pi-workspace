// Puts the selected promptBuild option into the system prompt for this run.
// Off unless ~/.pi/prompt-build-config.json has promptBuild.enabled true and exactly one option on.
// A section that is on with zero options, or with more than one, prints the conflict and sets no section.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readPromptBuild } from "../../src/global-config.ts";

function show(ctx: ExtensionContext, answer: string): void {
  if (ctx.hasUI) ctx.ui.notify(answer);
  else writeSync(1, `${answer}\n`);
}

export default function registerPromptBuild(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event, ctx) => {
    const setting = await readPromptBuild();
    if (!setting || setting.conflict || setting.section === null) {
      if (setting?.conflict) show(ctx, setting.conflict);
      delete event.systemPromptOptions.sections.prompt_build;
      return;
    }
    event.systemPromptOptions.sections.prompt_build = setting.section;
  });
}
