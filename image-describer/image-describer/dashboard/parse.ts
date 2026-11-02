export interface ImagePoint {
  runId: string;
  recordedAt: string;
  filename: string;
  mode: string;
  effort: string;
  language: string;
  sessionId?: string;
  model: string;
  provider: string;
  status: string;
  apiDurationSeconds: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
}

export interface ChatPoint {
  id: string;
  recordedAt: string;
  sessionId?: string;
  model: string;
  provider: string;
  costTotal: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
}

export function imageKey(point: ImagePoint): string {
  return `${point.runId}\n${point.filename}`;
}

export function chatKey(point: ChatPoint): string {
  return point.id || `${point.recordedAt}\n${point.costTotal}`;
}

export function completeLines(text: string): string[] {
  if (!text.endsWith("\n")) {
    const end = text.lastIndexOf("\n");
    text = end === -1 ? "" : text.slice(0, end + 1);
  }
  return text.split("\n").filter((line) => line.trim() !== "");
}

export function sessionChatPoints(text: string): ChatPoint[] {
  let sessionId = "";
  const points: ChatPoint[] = [];
  for (const line of completeLines(text)) {
    const row = objectOf(line);
    if (row?.type === "session" && typeof row.id === "string" && row.id) sessionId = row.id;
    const point = parseSessionLine(line);
    if (!point) continue;
    points.push(sessionId ? { ...point, sessionId } : point);
  }
  return points;
}

export function parseSessionLine(line: string): ChatPoint | null {
  const row = objectOf(line);
  if (!row || row.type !== "message") return null;
  const message = objectOfValue(row.message);
  if (!message || message.role !== "assistant") return null;
  const usage = objectOfValue(message.usage);
  if (!usage) return null;
  const cost = objectOfValue(usage.cost);
  if (typeof cost?.total !== "number" || !Number.isFinite(cost.total)) return null;
  const recordedAt = typeof row.timestamp === "string"
    ? row.timestamp
    : typeof message.timestamp === "number" && Number.isFinite(message.timestamp)
      ? new Date(message.timestamp).toISOString()
      : "";
  return {
    id: typeof row.id === "string" ? row.id : "",
    recordedAt,
    model: typeof message.model === "string" ? message.model : "",
    provider: typeof message.provider === "string" ? message.provider : "",
    costTotal: cost.total,
    inputTokens: countOf(usage, "input"),
    outputTokens: countOf(usage, "output"),
    cacheReadTokens: countOf(usage, "cacheRead"),
    cacheWriteTokens: countOf(usage, "cacheWrite"),
    reasoningTokens: countOf(usage, "reasoning"),
  };
}

function countOf(usage: Record<string, unknown>, key: string): number | null {
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function objectOf(line: string): Record<string, unknown> | null {
  try {
    return objectOfValue(JSON.parse(line));
  } catch {
    return null;
  }
}

function objectOfValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
