import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseCommandArgs, type DescribeRequest } from "./args.ts";
import { toJpegPayload } from "./convert.ts";
import { discoverImages, type DiscoveredImage } from "./discover.ts";
import { loadAgentEnv, requireKey } from "./env.ts";
import { appendJsonLine } from "./log.ts";
import { DEFAULT_MODEL_ID, lookupModel, resolveEffort, type ResolvedEffort } from "./models.ts";
import { buildInstruction } from "./prompt.ts";
import { describeOne, ImageFailure, type UsagePiece } from "./providers.ts";

export { parseCommandArgs };

const SCHEMA_VERSION = 1;
const DURATION_BOUNDARY = "after-argument-validation-through-last-image-before-ledger-append";

export interface DescribeDeps {
  fetchImpl?: typeof fetch;
  readExif?: (filePath: string) => Promise<number | null>;
  env?: NodeJS.ProcessEnv;
  loadEnvFile?: boolean;
  signal?: AbortSignal;
}

export interface ImageOutcome {
  filename: string;
  bytes: number;
  status: "succeeded" | "failed" | "unprocessed";
  kind?: string;
  error?: string;
  description?: string;
}

export interface UsageSummary {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  completeness: "complete" | "partial" | "unknown";
  responsesReportingUsage: number;
}

export interface LedgerImage {
  filename: string;
  bytes: number;
  status: ImageOutcome["status"];
  kind?: string;
  error?: string;
}

export interface LedgerRecord {
  schemaVersion: number;
  runId: string;
  startedAt: string;
  endedAt: string;
  status: "ok" | "partial" | "failed" | "no-images";
  provider: string;
  requestedModel: string;
  actualModel: string | null;
  requestedEffort: string;
  effectiveEffort: string;
  effortBehaviour: ResolvedEffort["behaviour"];
  timeoutSeconds: number;
  framePolicy: "first-frame-gif-tiff";
  processingDurationBoundary: typeof DURATION_BOUNDARY;
  images: LedgerImage[];
  imageCount: number;
  succeeded: number;
  failed: number;
  unprocessed: number;
  totalOriginalBytes: number;
  apiDurationSeconds: number;
  processingDurationSeconds: number;
  usage: UsageSummary;
}

export interface DescribeResult {
  dir: string;
  notice: string | null;
  text: string;
  images: ImageOutcome[];
  record: LedgerRecord;
}

interface Prepared {
  dir: string;
  logPath: string;
  modelId: string;
  effort: ResolvedEffort;
  language: string;
  prompt: string | undefined;
  instruction: string;
  timeoutSeconds: number;
}

export async function describeImages(request: DescribeRequest, deps: DescribeDeps = {}): Promise<DescribeResult> {
  const prepared = prepare(request);
  const baseEnv = deps.env ?? process.env;
  const env = deps.loadEnvFile === false ? baseEnv : await loadAgentEnv(baseEnv);
  const startedAt = new Date();
  const startedHr = process.hrtime.bigint();
  const images = await discoverImages(prepared.dir, deps.readExif);
  if (images.length === 0) {
    const record = buildRecord({
      prepared,
      startedAt,
      startedHr,
      outcomes: [],
      apiDurationSeconds: 0,
      actualModel: null,
      usage: emptyUsage("unknown"),
      status: "no-images",
    });
    await appendJsonLine(prepared.logPath, record);
    const result = { dir: prepared.dir, notice: prepared.effort.notice, images: [], record };
    return { ...result, text: formatRun(result) };
  }
  const model = lookupModel(prepared.modelId);
  const apiKey = requireKey(env, model.keyEnv);
  const outcomes: ImageOutcome[] = [];
  const usages: UsagePiece[] = [];
  let apiDurationSeconds = 0;
  let actualModel: string | null = null;
  let timedOut = false;
  let stopMessage: string | null = null;

  for (const image of images) {
    if (stopMessage) {
      outcomes.push({
        filename: image.filename,
        bytes: image.bytes,
        status: "unprocessed",
        error: stopMessage,
      });
      continue;
    }
    const outcome = await runOne(image, prepared, apiKey, deps);
    apiDurationSeconds += outcome.durationSeconds;
    if (outcome.usage) usages.push(outcome.usage);
    if (outcome.actualModel) actualModel = outcome.actualModel;
    if (outcome.timedOut) timedOut = true;
    outcomes.push(outcome.image);
    if (outcome.stopMessage) stopMessage = outcome.stopMessage;
  }

  const succeeded = outcomes.filter((item) => item.status === "succeeded").length;
  const usage = summariseUsage(usages, succeeded, timedOut);
  const record = buildRecord({
    prepared,
    startedAt,
    startedHr,
    outcomes,
    apiDurationSeconds,
    actualModel,
    usage,
    status: runStatus(outcomes),
  });
  await appendJsonLine(prepared.logPath, record);
  const result = { dir: prepared.dir, notice: prepared.effort.notice, images: outcomes, record };
  return { ...result, text: formatRun(result) };
}

function prepare(request: DescribeRequest): Prepared {
  if (!request.dir?.trim()) throw new Error("Missing required flag --dir.");
  const modelId = request.model?.trim() || DEFAULT_MODEL_ID;
  const model = lookupModel(modelId);
  const effort = resolveEffort(model, request.effort?.trim() || "default");
  const timeoutSeconds = request.timeout === undefined ? 120 : request.timeout;
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error("Timeout must be a positive number of seconds.");
  }
  const language = (request.language ?? "English").trim();
  if (!language || language.length > 80 || /[\r\n]/.test(language)) {
    throw new Error("Language must be a single line of at most 80 characters.");
  }
  if (request.prompt !== undefined && !request.prompt.trim()) {
    throw new Error("Prompt must not be empty.");
  }
  const dir = path.resolve(request.cwd, request.dir);
  const logPath = path.resolve(request.cwd, request.log ?? path.join("logs", "image-runs.jsonl"));
  return {
    dir,
    logPath,
    modelId,
    effort,
    language,
    prompt: request.prompt,
    instruction: buildInstruction(language, request.prompt),
    timeoutSeconds,
  };
}

async function runOne(
  image: DiscoveredImage,
  prepared: Prepared,
  apiKey: string,
  deps: DescribeDeps,
): Promise<{
  image: ImageOutcome;
  durationSeconds: number;
  usage?: UsagePiece;
  actualModel?: string | null;
  timedOut: boolean;
  stopMessage: string | null;
}> {
  let jpeg;
  try {
    jpeg = await toJpegPayload(image.path);
  } catch (error) {
    return {
      image: {
        filename: image.filename,
        bytes: image.bytes,
        status: "failed",
        kind: "local",
        error: messageOf(error),
      },
      durationSeconds: 0,
      timedOut: false,
      stopMessage: null,
    };
  }
  try {
    const success = await describeOne({
      model: lookupModel(prepared.modelId),
      apiKey,
      prompt: prepared.instruction,
      jpeg: jpeg.buffer,
      sentEffort: prepared.effort.sent,
      timeoutSeconds: prepared.timeoutSeconds,
      signal: deps.signal,
      fetchImpl: deps.fetchImpl,
    });
    return {
      image: {
        filename: image.filename,
        bytes: image.bytes,
        status: "succeeded",
        description: success.description,
      },
      durationSeconds: success.durationSeconds,
      usage: success.usage,
      actualModel: success.actualModel,
      timedOut: false,
      stopMessage: null,
    };
  } catch (error) {
    if (error instanceof ImageFailure) {
      const stopMessage = error.stop
        ? error.kind === "authentication"
          ? "skipped after authentication failure"
          : error.kind === "aborted"
            ? "skipped after abort"
            : "skipped after quota or credit failure"
        : null;
      return {
        image: {
          filename: image.filename,
          bytes: image.bytes,
          status: "failed",
          kind: error.kind,
          error: error.message,
        },
        durationSeconds: error.durationSeconds,
        timedOut: error.kind === "timeout",
        stopMessage,
      };
    }
    return {
      image: {
        filename: image.filename,
        bytes: image.bytes,
        status: "failed",
        kind: "local",
        error: messageOf(error),
      },
      durationSeconds: 0,
      timedOut: false,
      stopMessage: null,
    };
  }
}

function runStatus(outcomes: ImageOutcome[]): LedgerRecord["status"] {
  const succeeded = outcomes.filter((item) => item.status === "succeeded").length;
  if (succeeded === outcomes.length) return "ok";
  if (succeeded === 0) return "failed";
  return "partial";
}

function buildRecord(input: {
  prepared: Prepared;
  startedAt: Date;
  startedHr: bigint;
  outcomes: ImageOutcome[];
  apiDurationSeconds: number;
  actualModel: string | null;
  usage: UsageSummary;
  status: LedgerRecord["status"];
}): LedgerRecord {
  const model = lookupModel(input.prepared.modelId);
  const succeeded = input.outcomes.filter((item) => item.status === "succeeded").length;
  const failed = input.outcomes.filter((item) => item.status === "failed").length;
  const unprocessed = input.outcomes.filter((item) => item.status === "unprocessed").length;
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: randomUUID(),
    startedAt: input.startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status: input.status,
    provider: model.provider,
    requestedModel: model.id,
    actualModel: input.actualModel,
    requestedEffort: input.prepared.effort.requested,
    effectiveEffort: input.prepared.effort.effective,
    effortBehaviour: input.prepared.effort.behaviour,
    timeoutSeconds: input.prepared.timeoutSeconds,
    framePolicy: "first-frame-gif-tiff",
    processingDurationBoundary: DURATION_BOUNDARY,
    images: input.outcomes.map((item) => ({
      filename: item.filename,
      bytes: item.bytes,
      status: item.status,
      ...(item.kind ? { kind: item.kind } : {}),
      ...(item.error ? { error: item.error } : {}),
    })),
    imageCount: input.outcomes.length,
    succeeded,
    failed,
    unprocessed,
    totalOriginalBytes: input.outcomes.reduce((sum, item) => sum + item.bytes, 0),
    apiDurationSeconds: roundSeconds(input.apiDurationSeconds),
    processingDurationSeconds: roundSeconds(Number(process.hrtime.bigint() - input.startedHr) / 1e9),
    usage: input.usage,
  };
}

function summariseUsage(pieces: UsagePiece[], succeeded: number, timedOut: boolean): UsageSummary {
  const reported = pieces.filter((piece) => piece.input != null || piece.output != null || piece.total != null);
  if (reported.length === 0) return emptyUsage("unknown");
  const sum = (pick: (piece: UsagePiece) => number | null) => {
    const values = reported.map(pick).filter((value): value is number => value != null);
    if (values.length === 0) return null;
    return values.reduce((total, value) => total + value, 0);
  };
  const complete = reported.length === succeeded && !timedOut && pieces.length === succeeded;
  return {
    inputTokens: sum((piece) => piece.input),
    outputTokens: sum((piece) => piece.output),
    totalTokens: sum((piece) => piece.total),
    reasoningTokens: sum((piece) => piece.reasoning),
    cachedTokens: sum((piece) => piece.cached),
    completeness: complete ? "complete" : "partial",
    responsesReportingUsage: reported.length,
  };
}

function emptyUsage(completeness: UsageSummary["completeness"]): UsageSummary {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    reasoningTokens: null,
    cachedTokens: null,
    completeness,
    responsesReportingUsage: 0,
  };
}

export function formatRun(result: Omit<DescribeResult, "text">): string {
  const lines: string[] = [];
  if (result.notice) lines.push(result.notice, "");
  if (result.record.status === "no-images") {
    lines.push(`No eligible images in ${result.dir}.`);
    return lines.join("\n");
  }
  for (const image of result.images) {
    lines.push(`## ${image.filename}`);
    if (image.status === "succeeded") lines.push(image.description ?? "");
    else if (image.status === "failed") lines.push(`FAILED (${image.kind}): ${image.error}`);
    else lines.push(`UNPROCESSED: ${image.error}`);
    lines.push("");
  }
  const { succeeded, failed, unprocessed, runId } = result.record;
  lines.push(`Run ${runId}: ${succeeded} succeeded, ${failed} failed, ${unprocessed} unprocessed.`);
  return lines.join("\n").trimEnd();
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Local file error.";
}
