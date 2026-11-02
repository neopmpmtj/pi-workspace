import type { EffortLevel, ModelCapability } from "./models.ts";

export interface UsagePiece {
  input: number | null;
  output: number | null;
  total: number | null;
  reasoning: number | null;
  cached: number | null;
}

export interface ProviderSuccess {
  description: string;
  actualModel: string | null;
  usage: UsagePiece;
  durationSeconds: number;
}

export type FailureKind = "authentication" | "quota" | "rate_limit" | "timeout" | "provider" | "aborted" | "local";

export class ImageFailure extends Error {
  kind: FailureKind;
  durationSeconds: number;
  stop: boolean;

  constructor(message: string, kind: FailureKind, durationSeconds: number, stop: boolean) {
    super(message);
    this.name = "ImageFailure";
    this.kind = kind;
    this.durationSeconds = durationSeconds;
    this.stop = stop;
  }
}

export interface CallInput {
  model: ModelCapability;
  apiKey: string;
  prompt: string;
  jpeg: Buffer;
  sentEffort: EffortLevel | null;
  timeoutSeconds: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function describeOne(input: CallInput): Promise<ProviderSuccess> {
  const timeoutSignal = AbortSignal.timeout(Math.round(input.timeoutSeconds * 1000));
  const signal = input.signal ? AbortSignal.any([timeoutSignal, input.signal]) : timeoutSignal;
  const started = process.hrtime.bigint();
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(input.model.endpoint, {
      method: "POST",
      headers: headers(input.model, input.apiKey),
      body: JSON.stringify(body(input)),
      signal,
    });
  } catch (error) {
    const durationSeconds = elapsed(started);
    if (timeoutSignal.aborted) {
      throw new ImageFailure(`Timed out after ${input.timeoutSeconds}s.`, "timeout", durationSeconds, false);
    }
    if (input.signal?.aborted) {
      throw new ImageFailure("Aborted.", "aborted", durationSeconds, true);
    }
    const message = error instanceof Error ? error.message : "Request failed.";
    throw new ImageFailure(sanitise(message), "provider", durationSeconds, false);
  }
  const text = await response.text();
  const durationSeconds = elapsed(started);
  if (!response.ok) {
    const failure = classifyHttp(response.status, text);
    throw new ImageFailure(failure.message, failure.kind, durationSeconds, failure.stop);
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new ImageFailure("Response was not JSON.", "provider", durationSeconds, false);
  }
  const parsed = parseSuccess(input.model, json);
  if (!parsed.description) {
    throw new ImageFailure("The model returned an empty description.", "provider", durationSeconds, false);
  }
  return { ...parsed, durationSeconds };
}

function headers(model: ModelCapability, apiKey: string): Record<string, string> {
  if (model.provider === "gemini") {
    return {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    };
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
}

function body(input: CallInput): unknown {
  const b64 = input.jpeg.toString("base64");
  if (input.model.provider === "gemini") {
    const generation =
      input.sentEffort && input.sentEffort !== "none"
        ? { generationConfig: { thinkingConfig: { thinkingLevel: input.sentEffort } } }
        : {};
    return {
      contents: [
        {
          role: "user",
          parts: [
            { text: input.prompt },
            { inline_data: { mime_type: "image/jpeg", data: b64 } },
          ],
        },
      ],
      ...generation,
    };
  }
  const message = {
    role: "user",
    content: [
      { type: "text", text: input.prompt },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
    ],
  };
  const effort = chatEffort(input.model, input.sentEffort);
  return {
    model: input.model.id,
    messages: [message],
    stream: false,
    ...effort,
  };
}

function chatEffort(model: ModelCapability, sent: EffortLevel | null): Record<string, unknown> {
  if (sent === null) return {};
  if (model.provider === "deepseek" && sent === "none") {
    return { thinking: { type: "disabled" } };
  }
  if (model.provider === "deepseek") {
    return { reasoning_effort: sent, thinking: { type: "enabled" } };
  }
  return { reasoning_effort: sent };
}

function parseSuccess(model: ModelCapability, json: unknown): Omit<ProviderSuccess, "durationSeconds"> {
  if (model.provider === "gemini") return parseGemini(json);
  return parseChat(json);
}

function parseChat(json: unknown): Omit<ProviderSuccess, "durationSeconds"> {
  const root = asRecord(json);
  const choice = asRecord(arrayAt(root.choices, 0));
  const message = asRecord(choice.message);
  return {
    description: contentText(message.content).trim(),
    actualModel: typeof root.model === "string" ? root.model : null,
    usage: chatUsage(asRecord(root.usage)),
  };
}

function parseGemini(json: unknown): Omit<ProviderSuccess, "durationSeconds"> {
  const root = asRecord(json);
  const candidate = asRecord(arrayAt(root.candidates, 0));
  const content = asRecord(candidate.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const description = parts
    .map((part) => {
      const record = asRecord(part);
      return typeof record.text === "string" ? record.text : "";
    })
    .join("")
    .trim();
  const usage = asRecord(root.usageMetadata);
  return {
    description,
    actualModel: typeof root.modelVersion === "string" ? root.modelVersion : null,
    usage: {
      input: numberOrNull(usage.promptTokenCount),
      output: numberOrNull(usage.candidatesTokenCount),
      total: numberOrNull(usage.totalTokenCount),
      reasoning: numberOrNull(usage.thoughtsTokenCount),
      cached: numberOrNull(usage.cachedContentTokenCount),
    },
  };
}

function chatUsage(usage: Record<string, unknown>): UsagePiece {
  const completion = asRecord(usage.completion_tokens_details);
  const prompt = asRecord(usage.prompt_tokens_details);
  return {
    input: numberOrNull(usage.prompt_tokens),
    output: numberOrNull(usage.completion_tokens),
    total: numberOrNull(usage.total_tokens),
    reasoning: numberOrNull(completion.reasoning_tokens),
    cached: numberOrNull(prompt.cached_tokens),
  };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const record = asRecord(part);
      return typeof record.text === "string" ? record.text : "";
    })
    .join("");
}

function classifyHttp(status: number, bodyText: string): { kind: FailureKind; message: string; stop: boolean } {
  const info = errorInfo(bodyText);
  const blob = `${info.code} ${info.status} ${info.message}`.toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    blob.includes("invalid_api_key") ||
    blob.includes("api key") ||
    blob.includes("unauthorized") ||
    blob.includes("permission_denied")
  ) {
    return { kind: "authentication", message: `HTTP ${status} authentication.`, stop: true };
  }
  if (
    status === 402 ||
    blob.includes("insufficient_quota") ||
    blob.includes("billing") ||
    blob.includes("credit") ||
    (blob.includes("quota") && !blob.includes("rate"))
  ) {
    return { kind: "quota", message: `HTTP ${status} quota or credit.`, stop: true };
  }
  if (status === 429 || blob.includes("rate_limit") || blob.includes("rate limit") || blob.includes("resource_exhausted")) {
    return { kind: "rate_limit", message: `HTTP ${status} rate limit.`, stop: false };
  }
  return { kind: "provider", message: `HTTP ${status} ${sanitise(info.code || info.status || "provider error")}.`, stop: false };
}

function errorInfo(bodyText: string): { code: string; status: string; message: string } {
  try {
    const root = asRecord(JSON.parse(bodyText) as unknown);
    const error = asRecord(root.error);
    return {
      code: stringField(error.code) || stringField(root.code),
      status: stringField(error.status) || stringField(root.status),
      message: stringField(error.message) || stringField(root.message),
    };
  } catch {
    return { code: "", status: "", message: "" };
  }
}

function sanitise(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

function elapsed(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1e9;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function arrayAt(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : undefined;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}
