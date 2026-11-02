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
  return flags.length > 0 ? `/describe-images ${flags}` : "/describe-images";
}

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
