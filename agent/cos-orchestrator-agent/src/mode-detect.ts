// What counts as a mode request, as pure functions.
//
// No imports beyond the shared text cleaner, so the JEV classifier can call the detector
// from its own path (src/jev-classify.ts) without an import cycle: a mode request is
// never worth a classifier call, whichever extension pi happened to load first.
//
// Short on purpose. A message is a mode request only when it is short, mentions a mode,
// and either names a target mode after a verb or asks about the mode that is on.

import { cleanPrompt } from "./prompt-text.ts";

/** What the message asked for. */
export type ModeRequest = { kind: "status" } | { kind: "change"; mode: string };

/** A mode request is short. Longer text is prose that happens to mention a mode. */
const MAX_CHARS = 160;

const STOP = new Set([
  "the", "a", "an", "your", "my", "our", "his", "her", "its", "their",
  "teu", "tua", "seu", "sua", "meu", "minha", "o", "a", "os", "as",
  "de", "do", "da", "em", "e", "and", "or", "to", "para", "mode", "modo",
]);

const VERB = "change|switch|set|put|move|turn|activate|enable|go|" +
  "muda|mudas|mudar|altera|alteras|alterar|alterna|alternar|troca|trocar|" +
  "passa|passar|poe|põe|poes|pões|coloca|colocar|ativa|ativas|ativar";
const MODE = "mode|modo";
const TOKEN = "[\"'“”]?([\\p{L}\\p{N}_-]{1,24})[\"'“”]?";

/** "change your mode to normal", "muda o teu modo para normal", "set mode advanced". */
const CHANGE_PATTERNS = [
  new RegExp(`\\b(?:${VERB})\\b[^\\n]{0,40}?\\b(?:${MODE})\\b[^\\n]{0,24}?\\b(?:to|para|=>|->|:)\\s*${TOKEN}`, "iu"),
  new RegExp(`\\b(?:${VERB})\\b[^\\n]{0,24}?\\b(?:to|para)\\s+(?:the\\s+|o\\s+|teu\\s+|tua\\s+)?(?:${MODE})\\s+${TOKEN}`, "iu"),
  new RegExp(`\\b(?:${VERB})\\b[^\\n]{0,24}?\\b(?:to|para)\\s+${TOKEN}\\s+(?:${MODE})\\b`, "iu"),
  new RegExp(`^\\s*(?:please\\s+|por favor\\s+)?(?:use|usa|activate|ativa|ativar|enable|turn on)\\s+${TOKEN}\\s+(?:${MODE})\\b`, "iu"),
  // "set mode advanced" and "muda o modo normal": an imperative that ends on the token.
  new RegExp(`^\\s*(?:please\\s+|por favor\\s+)?(?:set|put|seta|muda|mudar|troca|trocar|coloca|colocar)\\s+(?:the\\s+|your\\s+|o\\s+|teu\\s+|tua\\s+)?(?:${MODE})\\s+${TOKEN}\\s*[.!]?\\s*$`, "iu"),
];

const STATE_WORD = /\b(?:are you|are we|am i|is it|is the agent|is pi|running|current|actual|atual|now|active|estamos|estás|estou|set|using)\b/iu;

/** A question about the mode that is on, rather than a statement or an unrelated use of "mode". */
export function isModeQuestion(text: string): boolean {
  const asks = /\b(?:what|which|whats|what's|qual|quais|que)\b[^\n]{0,40}\b(?:mode|modo)\b/iu;
  if (asks.test(text) && STATE_WORD.test(text)) return true;
  if (/\b(?:current|actual|atual|active)\s+(?:mode|modo)\b/iu.test(text) &&
    (/\?/.test(text) || /^(?:what|which|qual|que|show|mostra|diz|tell|current|atual|mode|modo)\b/iu.test(text))) return true;
  if (/\b(?:mode|modo)\s+(?:status|state)\b/iu.test(text)) return true;
  if (/^(?:mode|modo)\s*[?!.]*$/iu.test(text)) return true;
  if (/\b(?:what|which|whats|what's)\s+(?:is\s+)?(?:the|your|our)\s+(?:mode|modo)\b(?!\s+of)/iu.test(text)) return true;
  return false;
}

/**
 * The request in this message, or null. Pure: no file, no clock, no process.
 * Change wins over status when both shapes appear, because it names a target mode.
 */
export function detectModeRequest(text: string): ModeRequest | null {
  const cleaned = cleanPrompt(text).toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > MAX_CHARS || cleaned.includes("```") || cleaned.startsWith("/")) return null;
  for (const pattern of CHANGE_PATTERNS) {
    const mode = modeToken(pattern.exec(cleaned)?.[1]);
    if (mode) return { kind: "change", mode };
  }
  return isModeQuestion(cleaned) ? { kind: "status" } : null;
}

function modeToken(raw: string | undefined): string | null {
  const token = (raw ?? "").replace(/[^\p{L}\p{N}_-]/gu, "").toLowerCase();
  if (!token || token.length > 24 || STOP.has(token)) return null;
  return token;
}
