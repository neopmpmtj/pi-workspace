// Sends text to the Telegram surface a session is bound to, through the bridge's
// public delivery entry. Used by the decision-node hooks that finish a turn themselves.
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Telegram prompts carry a surface prefix; only those go through the bridge. */
export const TELEGRAM = /^\s*\[telegram/i;

/** The bridge's public delivery entry, installed under this agent home. */
function deliveryModule(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PI_TELEGRAM_DELIVERY?.trim();
  if (override) return override;
  return path.join(env.HOME ?? "", ".pi", "agent-keep-agent", "keep-agent",
    "npm", "node_modules", "@llblab", "pi-telegram", "dist", "api", "delivery.js");
}

type SendView = (
  view: { text: string; parseMode?: string },
  options: { scope: { kind: string } },
) => Promise<{ ok: boolean; reason?: string }>;

/**
 * Deliver text to the Telegram surface this session is bound to. Tries the exact turn
 * target first, then the instance's assigned thread or paired chat. Returns false when
 * the bridge is absent or refuses - the caller then keeps the model turn.
 */
export async function sendTelegram(text: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try {
    const module = (await import(pathToFileURL(deliveryModule(env)).href)) as { sendTelegramView?: SendView };
    const send = module.sendTelegramView;
    if (typeof send !== "function") return false;
    for (const kind of ["active-turn", "instance"]) {
      const sent = await send({ text }, { scope: { kind } });
      if (sent?.ok) return true;
    }
    return false;
  } catch {
    return false;
  }
}
