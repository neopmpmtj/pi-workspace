import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function agentDir(env: NodeJS.ProcessEnv): string {
  return env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent-image-describer", "image-describer");
}

/** `.env` lives beside the agent directory, in the repo root. */
export function agentEnvFile(env: NodeJS.ProcessEnv): string {
  return path.join(path.dirname(agentDir(env)), ".env");
}

/** Fill missing keys from this agent's .env only. Never overrides a value already set. */
export async function loadAgentEnv(env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const merged: NodeJS.ProcessEnv = { ...env };
  let text: string;
  try {
    text = await readFile(agentEnvFile(env), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return merged;
    throw error;
  }
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (merged[key]) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    merged[key] = value;
  }
  return merged;
}

export function requireKey(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Add it to ${agentEnvFile(env)} and restart via pi-image-describer.`);
  }
  return value;
}
