import { randomUUID } from "node:crypto";
import {
  contentText,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Api,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
import { labelOf } from "../ledger/labels.ts";
import type { RatesSnapshot } from "../ledger/rate-table.ts";
import type { Ledger } from "../ledger/store.ts";
import { estimateCost, tokensOf, type TokenTotals } from "../ledger/tokens.ts";
import { readAskSystemPrompt } from "./prompt.ts";

/** The slice of Pi's ModelRegistry this agent needs. Tests pass a stand-in. */
export interface RegistryLike {
  find(provider: string, modelId: string): Model<Api> | undefined;
  getAll?(): Model<Api>[];
  getAvailable(): Model<Api>[];
  hasConfiguredAuth(model: Model<Api>): boolean;
  streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
}

export interface AskInput {
  question: string;
  provider?: string;
  model?: string;
  effort?: string;
  timeoutSeconds?: number;
  sessionId?: string;
}

export interface AskOutcome {
  runId: string;
  status: "ok" | "failed";
  text: string;
  failure: string | null;
  provider: string;
  modelRequested: string;
  modelReturned: string | null;
  effortRequested: string | null;
  effortEffective: string | null;
  tokens: TokenTotals | null;
  /** Our card's figure. Null when the model is not rated at that moment. */
  costEstimated: number | null;
  /** Pi's figure for the same call, kept as a cross-check. */
  costPi: number | null;
  durationMs: number | null;
  ratesVersion: string;
  ratesSource: RatesSnapshot["source"];
  startedAt: string;
}

export interface AskDeps {
  registry: RegistryLike;
  ledger: Ledger;
  rates: RatesSnapshot;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  now?: () => Date;
  newId?: () => string;
}

const THINKING: readonly string[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

export async function runAsk(input: AskInput, deps: AskDeps): Promise<AskOutcome> {
  const now = deps.now ?? (() => new Date());
  const runId = (deps.newId ?? randomUUID)();
  const started = now();
  const model = resolveModel(deps.registry, input.provider, input.model);

  if (!deps.registry.hasConfiguredAuth(model)) {
    // Rejected before any request: a missing key must never look like a paid run.
    throw new Error(`No API key configured for provider "${model.provider}". Add it to ~/.pi/agent-tasks-agent/.env.`);
  }

  const systemPrompt = await readAskSystemPrompt(deps.env);
  const context: Context = {
    systemPrompt,
    messages: [{ role: "user", content: input.question, timestamp: started.getTime() }],
  };
  const options: SimpleStreamOptions = { signal: signalFor(input.timeoutSeconds, deps.signal) };
  const reasoning = thinkingLevel(input.effort);
  if (reasoning) options.reasoning = reasoning;

  deps.ledger.upsertRun({
    runId,
    sessionId: input.sessionId ?? null,
    startedAt: started.toISOString(),
    label: labelOf(input.question),
    origin: "command",
    provider: model.provider,
    model: model.id,
  });

  let message: AssistantMessage | null = null;
  let failure: string | null = null;
  try {
    message = await deps.registry.streamSimple(model, context, options).result();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  const ended = now();
  const tokens = tokensOf(message?.usage);
  const usage = message?.usage;
  const costPi = typeof usage?.cost?.total === "number" ? usage.cost.total : null;
  const text = message ? contentText(message.content).trim() : "";
  if (!failure && message && (message.stopReason === "error" || message.errorMessage)) {
    failure = message.errorMessage ?? `Provider stopped with "${message.stopReason}".`;
  }

  const estimated = tokens ? estimateCost(tokens, model.id, deps.rates, started.toISOString()) : null;
  const durationMs =
    typeof message?.durationMs === "number" ? Math.round(message.durationMs) : ended.getTime() - started.getTime();

  deps.ledger.insertCall({
    callId: runId,
    runId,
    origin: "command",
    source: "registry",
    sessionId: input.sessionId ?? null,
    sessionFile: null,
    startedAt: started.toISOString(),
    durationMs,
    provider: message?.provider ?? model.provider,
    modelRequested: model.id,
    modelReturned: message?.responseModel ?? message?.model ?? null,
    effortRequested: input.effort ?? null,
    effortEffective: message?.thinkingLevel ?? message?.providerThinkingLevel ?? null,
    input: tokens?.input ?? 0,
    output: tokens?.output ?? 0,
    cacheRead: tokens?.cacheRead ?? 0,
    cacheWrite: tokens?.cacheWrite ?? 0,
    reasoning: tokens?.reasoning ?? null,
    totalTokens: tokens?.total ?? 0,
    costPi,
    ratesVersion: deps.rates.version,
    status: failure ? "failed" : "ok",
    failureKind: failure ? "provider_error" : null,
  });

  return {
    runId,
    status: failure ? "failed" : "ok",
    text,
    failure,
    provider: message?.provider ?? model.provider,
    modelRequested: model.id,
    modelReturned: message?.responseModel ?? message?.model ?? null,
    effortRequested: input.effort ?? null,
    effortEffective: message?.thinkingLevel ?? message?.providerThinkingLevel ?? null,
    tokens,
    costEstimated: estimated?.total ?? null,
    costPi,
    durationMs,
    ratesVersion: deps.rates.version,
    ratesSource: deps.rates.source,
    startedAt: started.toISOString(),
  };
}

/** `provider/id`, an explicit provider, or a bare id that is unique in the catalog. */
export function resolveModel(
  registry: RegistryLike,
  provider: string | undefined,
  modelId: string | undefined,
): Model<Api> {
  if (modelId) {
    const [wantedProvider, wantedId] = provider
      ? [provider, modelId]
      : modelId.includes("/")
        ? [modelId.slice(0, modelId.indexOf("/")), modelId.slice(modelId.indexOf("/") + 1)]
        : [undefined, modelId];
    if (wantedProvider && wantedId) {
      const found = registry.find(wantedProvider, wantedId);
      if (!found) {
        throw new Error(
          `Unknown model "${wantedProvider}/${wantedId}". Available: ${catalogIds(registry, wantedProvider).join(", ") || "none"}.`,
        );
      }
      return found;
    }
    const matches = catalog(registry).filter((model) => model.id === wantedId);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `"${wantedId}" exists on ${matches.map((model) => model.provider).join(", ")}. Pass --provider to choose one.`,
      );
    }
    throw new Error(`Unknown model "${wantedId}". Available: ${catalogIds(registry).join(", ")}.`);
  }
  if (provider) throw new Error("--provider needs --model.");
  throw new Error(
    "No model chosen. Pass --model, save one with --set-default-model, or set defaultProvider and defaultModel in settings.json.",
  );
}

function catalog(registry: RegistryLike): Model<Api>[] {
  const available = registry.getAvailable();
  if (available.length > 0) return available;
  return registry.getAll?.() ?? [];
}

function catalogIds(registry: RegistryLike, provider?: string): string[] {
  return catalog(registry)
    .filter((model) => !provider || model.provider === provider)
    .map((model) => model.id);
}

function thinkingLevel(effort: string | undefined): ThinkingLevel | undefined {
  if (!effort || effort === "off" || effort === "default") return undefined;
  return THINKING.includes(effort) ? (effort as ThinkingLevel) : undefined;
}

function signalFor(seconds: number | undefined, outer: AbortSignal | undefined): AbortSignal | undefined {
  if (!seconds) return outer;
  const timer = AbortSignal.timeout(Math.round(seconds * 1000));
  return outer ? AbortSignal.any([outer, timer]) : timer;
}
