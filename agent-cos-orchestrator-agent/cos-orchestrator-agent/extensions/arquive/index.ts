// /arquive runs archive_to_target_full_tree.py. No chat turn.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ARQUIVE_HELP, parseArquiveArgs, runArquive } from "../../src/arquive-command.ts";
import { recordCommandIfUnsaved } from "../../src/session-command.ts";

const DESCRIPTION = "Move a file or folder into the archive: /arquive <path> · /arquive --undo";

export default function registerArquive(pi: ExtensionAPI): void {
  pi.registerCommand("arquive", {
    description: DESCRIPTION,
    handler: async (args, ctx) => {
      const command = commandLine(args);
      let parsed: ReturnType<typeof parseArquiveArgs>;
      try {
        parsed = parseArquiveArgs(args);
      } catch (error) {
        fail(pi, ctx, error instanceof Error ? error.message : "arquive failed", command);
        return;
      }
      if ("help" in parsed) {
        show(pi, ctx, ARQUIVE_HELP, command);
        return;
      }
      if ("error" in parsed) {
        fail(pi, ctx, parsed.error, command);
        return;
      }
      try {
        const result = await runArquive(parsed.argv, ctx.cwd, ctx.signal);
        const text = result.output || (result.code === 0 ? "[ok]" : "[FAIL]");
        if (result.code !== 0) {
          fail(pi, ctx, text, command);
          return;
        }
        show(pi, ctx, text, command);
      } catch (error) {
        fail(pi, ctx, error instanceof Error ? error.message : "arquive failed", command);
      }
    },
  });
}

function show(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string, command: string): void {
  if (!ctx.hasUI) writeSync(1, `${text}\n`);
  recordCommandIfUnsaved(ctx.sessionManager, command);
  pi.sendMessage({ customType: "arquive", content: text, display: true }, { triggerTurn: false });
}

function fail(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string, command: string): void {
  recordCommandIfUnsaved(ctx.sessionManager, command);
  ctx.ui.notify(text, "error");
  console.error(`[FAIL] ${text}`);
  if (!ctx.hasUI) process.exitCode = 1;
  pi.sendMessage(
    { customType: "arquive", content: text.startsWith("[FAIL]") ? text : `[FAIL] ${text}`, display: true },
    { triggerTurn: false },
  );
}

function commandLine(args: string): string {
  const rest = args.trim();
  return rest ? `/arquive ${rest}` : "/arquive";
}
