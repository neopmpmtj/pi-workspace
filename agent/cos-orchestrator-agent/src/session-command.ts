import { existsSync } from "node:fs";

export interface SessionCommandWriter {
  getSessionFile(): string | undefined;
  appendMessage?(message: UserCommandMessage): string;
}

export interface UserCommandMessage {
  role: "user";
  content: Array<{ type: "text"; text: string }>;
  timestamp: number;
}

export function slashCommand(args: string): string {
  const flags = args.trim();
  return flags.length > 0 ? `/ask ${flags}` : "/ask";
}

/**
 * A new TUI session is saved only after a user message, and a print-mode command
 * run makes no chat turn at all, so the command line itself is recorded when the
 * session file is not on disk yet. Returns true when it wrote one.
 */
export function recordCommandIfUnsaved(session: SessionCommandWriter, command: string, now = Date.now()): boolean {
  const file = session.getSessionFile();
  if (!file || existsSync(file) || typeof session.appendMessage !== "function") return false;
  session.appendMessage({
    role: "user",
    content: [{ type: "text", text: command }],
    timestamp: now,
  });
  return true;
}
