import { createJiti } from "jiti";
import path from "node:path";
import { agentDir } from "../ledger/env.ts";

/**
 * What `/ask` found on the web before the one provider call. The chat tools stay
 * on the research turn; this is the lookup that turn does not run.
 */
export interface AskWebFindings {
  /** Block appended to the question. Empty when there is nothing to add. */
  text: string;
  provider: string | null;
  results: number;
  fetches: number;
  status: "ok" | "failed";
  failure: string | null;
  durationMs: number;
}

export interface AskWebHit {
  title: string;
  url: string;
  snippet: string;
}

export interface AskWebPage {
  title: string;
  url: string;
  text: string;
}

interface RoutedSearch {
  provider?: string;
  results?: AskWebHit[];
}

interface ExtractedPage {
  url?: string;
  title?: string;
  content?: string;
  error?: string | null;
}

interface WebAccess {
  search: (query: string, options?: { numResults?: number; signal?: AbortSignal }) => Promise<RoutedSearch>;
  extractContent: (url: string, signal?: AbortSignal) => Promise<ExtractedPage>;
}

const PAGE_CHARS = 2200;
const SNIPPET_CHARS = 400;
const FETCH_ATTEMPTS = 3;
const MIN_PAGE_CHARS = 200;

let webAccess: Promise<WebAccess> | undefined;

/** The question the model sees: the ask, then the lookup, or the lookup failure. */
export function questionWithWebResults(question: string, findings: AskWebFindings): string {
  if (findings.status === "failed") {
    const reason = findings.failure?.trim() || "the lookup failed";
    return `${question}\n\nWeb lookup failed: ${reason}`;
  }
  const block = findings.text.trim();
  if (!block) return question;
  return `${question}\n\n${block}`;
}

/** Snippets plus one fetched page. The page is where a live fact usually sits. */
export function formatAskWebResults(provider: string, results: readonly AskWebHit[], page: AskWebPage | null): string {
  const lines = [`Web results (${provider}):`];
  if (results.length === 0) lines.push("No results.");
  results.slice(0, 5).forEach((result, index) => {
    const title = result.title.trim() || result.url;
    lines.push(`${index + 1}. ${title}`);
    if (result.url) lines.push(result.url);
    const snippet = clip(result.snippet, SNIPPET_CHARS);
    if (snippet) lines.push(snippet);
  });
  if (page) {
    lines.push("");
    lines.push(`Fetched page: ${page.title.trim() || page.url}`);
    lines.push(page.url);
    lines.push(page.text);
  }
  return lines.join("\n");
}

/**
 * One search on the route in `web-search.json`, then one page from those results.
 * No `provider` argument: the route is what the ledger meters.
 */
export async function searchWebForAsk(query: string, signal?: AbortSignal): Promise<AskWebFindings> {
  const started = Date.now();
  try {
    const access = await loadWebAccess();
    const found = await access.search(query, { numResults: 5, signal });
    const provider = typeof found.provider === "string" && found.provider.trim() !== "" ? found.provider.trim() : "unknown";
    const results = (found.results ?? []).filter((result) => result && (result.url || result.snippet || result.title));
    const page = await fetchFirstPage(access, results, signal);
    return {
      text: formatAskWebResults(provider, results, page),
      provider,
      results: results.length,
      fetches: page ? 1 : 0,
      status: "ok",
      failure: null,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      text: "",
      provider: null,
      results: 0,
      fetches: 0,
      status: "failed",
      failure: firstLine(error),
      durationMs: Date.now() - started,
    };
  }
}

async function fetchFirstPage(
  access: WebAccess,
  results: readonly AskWebHit[],
  signal: AbortSignal | undefined,
): Promise<AskWebPage | null> {
  const urls = results.map((result) => result.url).filter((url) => url.startsWith("http")).slice(0, FETCH_ATTEMPTS);
  for (const url of urls) {
    if (signal?.aborted) return null;
    let page: ExtractedPage;
    try {
      page = await access.extractContent(url, signal);
    } catch {
      continue;
    }
    const text = excerpt(page.content ?? "");
    if (page.error || text.length < MIN_PAGE_CHARS) continue;
    const hit = results.find((result) => result.url === url);
    return { title: page.title?.trim() || hit?.title || url, url: page.url || url, text };
  }
  return null;
}

function excerpt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= PAGE_CHARS) return compact;
  const at = compact.search(/\d+(?:\.\d+)?\s*°/);
  const start = at === -1 ? 0 : Math.max(0, at - 400);
  return compact.slice(start, start + PAGE_CHARS);
}

function clip(text: string, limit: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit)}...`;
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.split("\n")[0]?.trim() || "the lookup failed";
  return line.length > 300 ? `${line.slice(0, 300)}...` : line;
}

async function loadWebAccess(): Promise<WebAccess> {
  if (!webAccess) {
    webAccess = importWebAccess().catch((error: unknown) => {
      webAccess = undefined;
      throw error;
    });
  }
  return webAccess;
}

async function importWebAccess(): Promise<WebAccess> {
  const root = path.join(agentDir(), "npm", "node_modules", "pi-web-access");
  const jiti = createJiti(import.meta.url);
  const searchModule = (await jiti.import(path.join(root, "gemini-search.ts"))) as {
    search?: WebAccess["search"];
  };
  const extractModule = (await jiti.import(path.join(root, "extract.ts"))) as {
    extractContent?: WebAccess["extractContent"];
  };
  if (!searchModule.search || !extractModule.extractContent) {
    throw new Error("pi-web-access did not export search and extractContent.");
  }
  return { search: searchModule.search, extractContent: extractModule.extractContent };
}
