// /archive runs archive_to_target_full_tree.py. No chat turn.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ARCHIVE_HELP, parseArchiveArgs, runArchive } from "../../src/archive-command.ts";
import { recordCommandIfUnsaved } from "../../src/session-command.ts";

const DESCRIPTION = "Move a file or folder into the archive: /archive <path> · /archive --undo";

export default function registerArchive(pi: ExtensionAPI): void {
  const handler = async (cmdName: string, args: string, ctx: ExtensionCommandContext) => {
    const command = commandLine(cmdName, args);
    let parsed: ReturnType<typeof parseArchiveArgs>;
    try {
      parsed = parseArchiveArgs(args);
    } catch (error) {
      fail(pi, ctx, error instanceof Error ? error.message : "archive failed", command);
      return;
    }
    if ("help" in parsed) {
      show(pi, ctx, ARCHIVE_HELP, command);
      return;
    }
    if ("error" in parsed) {
      fail(pi, ctx, parsed.error, command);
      return;
    }
    try {
      const result = await runArchive(parsed.argv, ctx.cwd, ctx.signal);
      const text = result.output || (result.code === 0 ? "[ok]" : "[FAIL]");
      if (result.code !== 0) {
        fail(pi, ctx, text, command);
        return;
      }
      show(pi, ctx, text, command);
    } catch (error) {
      fail(pi, ctx, error instanceof Error ? error.message : "archive failed", command);
    }
  };

  pi.registerCommand("archive", {
    description: DESCRIPTION,
    handler: (args, ctx) => handler("archive", args, ctx),
  });

  // Alias for backward compatibility
  pi.registerCommand("arquive", {
    description: "Alias for /archive",
    handler: (args, ctx) => handler("archive", args, ctx),
  });
}

function show(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string, command: string): void {
  if (!ctx.hasUI) writeSync(1, `${text}\n`);
  recordCommandIfUnsaved(ctx.sessionManager, command);
  pi.sendMessage({ customType: "archive", content: text, display: true }, { triggerTurn: false });
}

function fail(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string, command: string): void {
  recordCommandIfUnsaved(ctx.sessionManager, command);
  ctx.ui.notify(text, "error");
  console.error(`[FAIL] ${text}`);
  if (!ctx.hasUI) process.exitCode = 1;
  pi.sendMessage(
    { customType: "archive", content: text.startsWith("[FAIL]") ? text : `[FAIL] ${text}`, display: true },
    { triggerTurn: false },
  );
}

function commandLine(cmdName: string, args: string): string {
  const rest = args.trim();
  return rest ? `/${cmdName} ${rest}` : `/${cmdName}`;
}
