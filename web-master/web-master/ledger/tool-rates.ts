import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./env.ts";

export const TOOL_RATES_FILE = "tool-rates.json";

/** Dollars per search, per provider. `tokens` marks a provider whose own model use we cannot see. */
export interface ToolRate {
  perSearch: number;
  /** True when the provider also bills model tokens that never reach the session file. */
  tokensUnmetered?: boolean;
  source?: string;
}

export interface ToolRates {
  source: "file" | "built-in";
  updatedAt: string | null;
  /** Short hash of the table, recorded on every row. */
  version: string;
  providers: Record<string, ToolRate>;
  fetch: { perUrl: number };
  error?: string;
}

/**
 * List prices when no card is installed. Documentation is the source: Brave and Perplexity
 * charge per request, DuckDuckGo and keyless Exa are free, and Gemini/OpenAI bill model tokens
 * on top of the per-request fee, which the session file never records.
 */
export const BUILT_IN: ToolRates = {
  source: "built-in",
  updatedAt: null,
  version: "builtin",
  providers: {
    brave: { perSearch: 0.005, source: "brave.com/search/api" },
    perplexity: { perSearch: 0.005, source: "docs.perplexity.ai search api" },
    tavily: { perSearch: 0.008, source: "tavily.com/pricing" },
    exa: { perSearch: 0, source: "keyless Exa MCP" },
    duckduckgo: { perSearch: 0, source: "free" },
    gemini: { perSearch: 0.014, tokensUnmetered: true, source: "ai.google.dev grounding" },
    openai: { perSearch: 0.01, tokensUnmetered: true, source: "openai web search tool" },
  },
  fetch: { perUrl: 0 },
};

export function toolRatesPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(repoRoot(env), TOOL_RATES_FILE);
}

export async function readToolRates(env: NodeJS.ProcessEnv = process.env): Promise<ToolRates> {
  let text: string;
  try {
    text = await readFile(toolRatesPath(env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return BUILT_IN;
    return { ...BUILT_IN, error: `tool-rates.json could not be read: ${message(error)}` };
  }
  try {
    const parsed = parseToolRates(text);
    return { ...parsed, source: "file", version: versionOf(parsed.providers, parsed.fetch) };
  } catch (error) {
    // A broken card must not stop a run; the built-in table is used and the error is surfaced.
    return { ...BUILT_IN, error: message(error) };
  }
}

export function parseToolRates(text: string): { updatedAt: string; providers: Record<string, ToolRate>; fetch: { perUrl: number } } {
  const root = record(JSON.parse(text) as unknown);
  if (root.schemaVersion !== 1) throw new Error(`${TOOL_RATES_FILE} schemaVersion must be 1.`);
  if (root.currency !== "USD") throw new Error(`${TOOL_RATES_FILE} currency must be "USD".`);
  if (root.unit !== "per_search") throw new Error(`${TOOL_RATES_FILE} unit must be "per_search".`);
  const updatedAt = typeof root.updatedAt === "string" && Number.isFinite(Date.parse(root.updatedAt)) ? root.updatedAt : new Date(0).toISOString();
  const listed = record(root.providers ?? {});
  const providers: Record<string, ToolRate> = {};
  for (const [name, value] of Object.entries(listed)) {
    const item = record(value);
    const perSearch = price(item.perSearch, `providers.${name}.perSearch`);
    providers[name] = {
      perSearch,
      ...(item.tokensUnmetered === true ? { tokensUnmetered: true } : {}),
      ...(typeof item.source === "string" ? { source: item.source } : {}),
    };
  }
  const fetch = record(root.fetch ?? {});
  return {
    updatedAt,
    providers,
    fetch: { perUrl: price(fetch.perUrl ?? 0, "fetch.perUrl") },
  };
}

export type CostStatus = "rated" | "partial" | "unrated" | "free";

export interface ToolCost {
  total: number;
  status: CostStatus;
  /** Providers with no row in the card: their share is unknown, not free. */
  unrated: string[];
  /** Providers that also bill tokens we cannot see. */
  unmetered: string[];
}

/**
 * Dollars for one tool call from its per-provider search counts. A provider missing from the
 * card makes the result `unrated` (or `partial`), never free: an unknown price is not zero.
 */
export function toolCost(providers: Record<string, number>, rates: ToolRates): ToolCost {
  let total = 0;
  let rated = 0;
  const unrated: string[] = [];
  const unmetered: string[] = [];
  for (const [provider, count] of Object.entries(providers)) {
    const rate = rates.providers[provider];
    if (!rate) {
      unrated.push(provider);
      continue;
    }
    total += count * rate.perSearch;
    rated += 1;
    if (rate.tokensUnmetered) unmetered.push(provider);
  }
  const status: CostStatus =
    rated === 0 && unrated.length === 0
      ? "free"
      : unrated.length === 0
        ? unmetered.length > 0
          ? "partial"
          : "rated"
        : rated === 0
          ? "unrated"
          : "partial";
  return { total, status, unrated, unmetered };
}

export function versionOf(providers: Record<string, ToolRate>, fetch: { perUrl: number }): string {
  const canonical = Object.keys(providers)
    .sort()
    .map((name) => `${name}:${providers[name].perSearch}:${providers[name].tokensUnmetered ? 1 : 0}`)
    .concat(`fetch:${fetch.perUrl}`)
    .join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${TOOL_RATES_FILE} must be a JSON object.`);
  return value as Record<string, unknown>;
}

function price(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${TOOL_RATES_FILE} ${where} must be a number zero or higher.`);
  }
  return value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
