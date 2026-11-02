import type { ChatPoint, ImagePoint } from "./parse.ts";
import type { ModelRate, RateLookup } from "./src/rates.ts";

export interface TokenCost {
  uncachedInput: number;
  cachedInput: number;
  output: number;
  uncachedInputCost: number;
  cachedInputCost: number;
  outputCost: number;
  tokens: number;
  cost: number;
}

export interface SessionBar {
  id: string;
  recordedAt: string;
  description: TokenCost;
  chat: TokenCost;
  totalCost: number;
  totalTokens: number;
  chatRecordedCost: number;
  chatEstimated: boolean;
  rateUnset: boolean;
}

const ZERO_RATE: ModelRate = { input: 0, output: 0, cacheRead: 0 };

export function sessionBars(
  images: ImagePoint[],
  chats: ChatPoint[],
  rateFor: RateLookup,
): SessionBar[] {
  const groups = new Map<string, SessionBar>();
  const group = (id: string, recordedAt: string): SessionBar => {
    const existing = groups.get(id);
    if (existing) {
      if (recordedAt && (!existing.recordedAt || recordedAt < existing.recordedAt)) existing.recordedAt = recordedAt;
      return existing;
    }
    const created: SessionBar = {
      id,
      recordedAt,
      description: emptyCost(),
      chat: emptyCost(),
      totalCost: 0,
      totalTokens: 0,
      chatRecordedCost: 0,
      chatEstimated: false,
      rateUnset: false,
    };
    groups.set(id, created);
    return created;
  };

  for (const image of images) {
    const bucket = group(image.sessionId ? `session:${image.sessionId}` : `run:${image.runId}`, image.recordedAt);
    const counts = imageCounts(image);
    if (!counts) {
      bucket.rateUnset = true;
      continue;
    }
    const rate = rateFor(image.model, image.recordedAt);
    if (!rate) bucket.rateUnset = true;
    addCost(bucket.description, priceTokens(counts, rate ?? ZERO_RATE));
  }
  for (const chat of chats) {
    const bucket = group(chat.sessionId ? `session:${chat.sessionId}` : `chat:${chat.id}`, chat.recordedAt);
    bucket.chatRecordedCost += chat.costTotal;
    if (!chatHasTokens(chat)) {
      bucket.chatEstimated = true;
      bucket.chat.cost += chat.costTotal;
      continue;
    }
    const rate = rateFor(chat.model, chat.recordedAt);
    if (!rate) bucket.rateUnset = true;
    addCost(bucket.chat, priceTokens(chatCounts(chat), rate ?? ZERO_RATE));
  }

  return [...groups.values()]
    .map((bar) => ({
      ...bar,
      totalCost: bar.description.cost + bar.chat.cost,
      totalTokens: bar.description.tokens + bar.chat.tokens,
    }))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
}

export function sessionLabel(recordedAt: string, id: string, bars: { recordedAt: string }[]): string {
  const shared = bars.filter((bar) => bar.recordedAt === recordedAt).length > 1;
  return shared ? `${recordedAt} ${id}` : recordedAt;
}

function emptyCost(): TokenCost {
  return {
    uncachedInput: 0,
    cachedInput: 0,
    output: 0,
    uncachedInputCost: 0,
    cachedInputCost: 0,
    outputCost: 0,
    tokens: 0,
    cost: 0,
  };
}

function addCost(into: TokenCost, extra: TokenCost): void {
  into.uncachedInput += extra.uncachedInput;
  into.cachedInput += extra.cachedInput;
  into.output += extra.output;
  into.uncachedInputCost += extra.uncachedInputCost;
  into.cachedInputCost += extra.cachedInputCost;
  into.outputCost += extra.outputCost;
  into.tokens += extra.tokens;
  into.cost += extra.cost;
}

function priceTokens(counts: { uncachedInput: number; cachedInput: number; output: number }, rate: ModelRate): TokenCost {
  const million = 1_000_000;
  const uncachedInputCost = counts.uncachedInput * rate.input / million;
  const cachedInputCost = counts.cachedInput * rate.cacheRead / million;
  const outputCost = counts.output * rate.output / million;
  return {
    ...counts,
    uncachedInputCost,
    cachedInputCost,
    outputCost,
    tokens: counts.uncachedInput + counts.cachedInput + counts.output,
    cost: uncachedInputCost + cachedInputCost + outputCost,
  };
}

function imageCounts(row: ImagePoint): { uncachedInput: number; cachedInput: number; output: number } | null {
  const input = row.inputTokens;
  const output = row.outputTokens;
  if (input == null || output == null) return null;
  const cached = Math.min(Math.max(row.cachedTokens ?? 0, 0), input);
  return { uncachedInput: input - cached, cachedInput: cached, output };
}

function chatHasTokens(chat: ChatPoint): boolean {
  return chat.inputTokens != null
    || chat.outputTokens != null
    || chat.cacheReadTokens != null
    || chat.cacheWriteTokens != null;
}

function chatCounts(chat: ChatPoint): { uncachedInput: number; cachedInput: number; output: number } {
  return {
    uncachedInput: Math.max(chat.inputTokens ?? 0, 0) + Math.max(chat.cacheWriteTokens ?? 0, 0),
    cachedInput: Math.max(chat.cacheReadTokens ?? 0, 0),
    output: Math.max(chat.outputTokens ?? 0, 0),
  };
}
