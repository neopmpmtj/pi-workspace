import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSingleStandingSave, parseCommandArgs, type DescribeRequest } from "./args.ts";
import { toJpegPayload } from "./convert.ts";
import { DEFAULT_LANGUAGE, checkedLanguage, readDefaultLanguage, writeDefaultLanguage } from "./default-language.ts";
import { readDefaultMode, writeDefaultMode } from "./default-mode.ts";
import { readDefaultProvider, writeDefaultSelection, type DefaultProvider } from "./default-provider.ts";
import { DEFAULT_COUNT_EFFORT, readCountEffort, writeCountEffort } from "./count-effort.ts";
import { DEFAULT_DETAILED_EFFORT, readDetailedEffort, writeDetailedEffort } from "./detailed-effort.ts";
import { discoverImages, type DiscoveredImage } from "./discover.ts";
import { loadAgentEnv, requireKey } from "./env.ts";
import { writeFrontAndCenter } from "./front-and-center.ts";
import { IMAGES_DIR_MISSING_MESSAGE, readImagesDir, writeImagesDir } from "./images-dir.ts";
import { DEFAULT_METRICS_FILE, insertImageCalls, type ImageCall } from "./metrics.ts";
import { DEFAULT_MODEL_ID, lookupModel, resolveEffort, type EffortLevel, type ResolvedEffort } from "./models.ts";
import { readPresetEffort, writePresetEffort } from "./preset-effort.ts";
import { buildInstruction, PROMPT_MODES, type PromptMode, type PromptOverrides, type RecordedMode } from "./prompt.ts";
import { readPromptOverrides } from "./prompt-overrides.ts";
import { describeOne, ImageFailure, type UsagePiece } from "./providers.ts";
import { summariesPathForLog, summaryFromDescription, upsertSummaries, type SummaryRow } from "./summaries.ts";

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
  sourcePath?: string;
  apiDurationSeconds?: number;
  usage?: UsagePiece;
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
  apiDurationSeconds?: number;
  descriptionFile?: string;
  usage?: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    reasoningTokens: number | null;
    cachedTokens: number | null;
  };
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
  descriptionFile?: string;
  mode: RecordedMode;
  language: string;
  sessionId?: string;
}

export interface DescribeResult {
  dir: string;
  notice: string | null;
  text: string;
  images: ImageOutcome[];
  record: LedgerRecord;
}

interface Prepared {
  cwd: string;
  dir: string;
  logPath: string;
  modelId: string;
  effort: ResolvedEffort;
  language: string;
  prompt: string | undefined;
  mode: RecordedMode;
  instruction: string;
  timeoutSeconds: number;
  sessionId?: string;
}

export async function describeImages(request: DescribeRequest, deps: DescribeDeps = {}): Promise<DescribeResult> {
  const baseEnv = deps.env ?? process.env;
  const env = deps.loadEnvFile === false ? baseEnv : await loadAgentEnv(baseEnv);
  assertSingleStandingSave(request);
  if (request.setDefaultImageDescriberMode !== undefined) {
    if (!request.setDefaultImageDescriberMode.trim()) throw new Error("Default mode must not be empty.");
    const saved = await writeDefaultMode(env, request.setDefaultImageDescriberMode);
    return savedDefaultResult(saved);
  }
  if (request.setDefaultImageDescriberPreset !== undefined) {
    return savePresetEffort(env, request.setDefaultImageDescriberPreset);
  }
  if (request.setDefaultImageDescriberDetailed !== undefined) {
    return saveDetailedEffort(env, request.setDefaultImageDescriberDetailed);
  }
  if (request.setDefaultImageDescriberCount !== undefined) {
    return saveCountEffort(env, request.setDefaultImageDescriberCount);
  }
  if (request.setDefaultImageDescriberProvider !== undefined || request.setDefaultImageDescriberModel !== undefined) {
    const saved = await writeDefaultSelection(env, {
      provider: request.setDefaultImageDescriberProvider,
      model: request.setDefaultImageDescriberModel,
    });
    return savedProviderResult(saved);
  }
  if (request.setDefaultImageDescriberLanguage !== undefined) {
    const saved = await writeDefaultLanguage(env, request.setDefaultImageDescriberLanguage);
    return savedLanguageResult(saved);
  }
  if (request.setDefaultImageDescriberImagesDir !== undefined) {
    const saved = await writeImagesDir(env, request.setDefaultImageDescriberImagesDir, request.cwd);
    return savedImagesDirResult(saved);
  }
  let mode = request.mode;
  if (!mode?.trim() && request.prompt === undefined) mode = await readDefaultMode(env);
  const overrides = request.prompt === undefined ? await readPromptOverrides(env) : {};
  const selected = mode?.trim();
  const omittedEffort = request.prompt === undefined && !request.effort?.trim();
  const detailedEffort =
    selected === "detailed" && omittedEffort ? await readDetailedEffort(env) : undefined;
  const countEffort = selected === "count" && omittedEffort ? await readCountEffort(env) : undefined;
  const presetEffort =
    sharesPresetEffort(selected) && omittedEffort ? await readPresetEffort(env) : undefined;
  const savedProvider = request.model?.trim() ? undefined : await readDefaultProvider(env);
  const savedLanguage = request.language === undefined ? await readDefaultLanguage(env) : undefined;
  let dir = request.dir?.trim() ?? "";
  if (!dir) {
    const savedDir = await readImagesDir(env);
    if (!savedDir) throw new Error(IMAGES_DIR_MISSING_MESSAGE);
    dir = savedDir;
  }
  const prepared = prepare(
    {
      ...request,
      dir,
      mode,
      ...(savedProvider ? { model: savedProvider.model } : {}),
      ...(savedLanguage !== undefined ? { language: savedLanguage } : {}),
    },
    overrides,
    detailedEffort,
    countEffort,
    presetEffort,
  );
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
    return finishRun(request, prepared, {
      dir: prepared.dir,
      notice: prepared.effort.notice,
      images: [],
      record,
    });
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
  const result = await finishRun(request, prepared, {
    dir: prepared.dir,
    notice: prepared.effort.notice,
    images: outcomes,
    record,
  });
  await writeFrontAndCenter(env, {
    runId: result.record.runId,
    recordedAt: result.record.endedAt,
    dir: prepared.dir,
    images: outcomes.flatMap((item) =>
      item.status === "succeeded" && item.description
        ? [{ filename: item.filename, description: item.description }]
        : [],
    ),
  });
  return result;
}

async function finishRun(
  request: DescribeRequest,
  prepared: Prepared,
  result: Omit<DescribeResult, "text">,
): Promise<DescribeResult> {
  const logDir = path.dirname(prepared.logPath);
  const saved: string[] = [];
  const summaries: SummaryRow[] = [];
  if (result.record.descriptionFile) {
    const absolute = path.join(logDir, result.record.descriptionFile);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, `${formatRun(result)}\n`, "utf8");
    saved.push(path.relative(request.cwd, absolute));
  }
  for (const item of result.record.images) {
    if (!item.descriptionFile) continue;
    const image = result.images.find((candidate) => candidate.filename === item.filename);
    const absolute = path.resolve(request.cwd, item.descriptionFile);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, `${image?.description ?? ""}\n`, "utf8");
    saved.push(path.relative(request.cwd, absolute));
    const summary = summaryFromDescription(image?.description ?? "");
    if (summary && image?.sourcePath) {
      summaries.push({
        imageDir: path.dirname(image.sourcePath),
        imageFile: path.basename(image.sourcePath),
        summary,
        recordedAt: result.record.endedAt,
        mode: result.record.mode,
        language: result.record.language,
        model: result.record.actualModel || result.record.requestedModel,
        runId: result.record.runId,
      });
    }
  }
  upsertSummaries(summariesPathForLog(prepared.logPath), summaries);
  insertImageCalls(prepared.logPath, imageCallsFrom(result.record));
  const listing = saved.map((file) => `Saved ${file}.`).join("\n");
  const text = formatRun(result);
  return { ...result, text: listing ? `${text}\n\n${listing}` : text };
}

function savedProviderResult(saved: DefaultProvider): DescribeResult {
  const now = new Date().toISOString();
  const model = lookupModel(saved.model);
  return {
    dir: "",
    notice: null,
    text: `Saved default provider ${saved.provider} and model ${saved.model}.`,
    images: [],
    record: {
      schemaVersion: SCHEMA_VERSION,
      runId: randomUUID(),
      startedAt: now,
      endedAt: now,
      status: "ok",
      provider: model.provider,
      requestedModel: model.id,
      actualModel: null,
      requestedEffort: "default",
      effectiveEffort: model.documentedDefault,
      effortBehaviour: "omitted_documented_default",
      timeoutSeconds: 120,
      framePolicy: "first-frame-gif-tiff",
      processingDurationBoundary: DURATION_BOUNDARY,
      images: [],
      imageCount: 0,
      succeeded: 0,
      failed: 0,
      unprocessed: 0,
      totalOriginalBytes: 0,
      apiDurationSeconds: 0,
      processingDurationSeconds: 0,
      usage: emptyUsage("unknown"),
      mode: "general",
      language: "English",
    },
  };
}

function savedLanguageResult(saved: string): DescribeResult {
  const now = new Date().toISOString();
  const model = lookupModel(DEFAULT_MODEL_ID);
  return {
    dir: "",
    notice: null,
    text: `Saved default language ${saved}.`,
    images: [],
    record: {
      schemaVersion: SCHEMA_VERSION,
      runId: randomUUID(),
      startedAt: now,
      endedAt: now,
      status: "ok",
      provider: model.provider,
      requestedModel: model.id,
      actualModel: null,
      requestedEffort: "default",
      effectiveEffort: "none",
      effortBehaviour: "omitted_documented_default",
      timeoutSeconds: 120,
      framePolicy: "first-frame-gif-tiff",
      processingDurationBoundary: DURATION_BOUNDARY,
      images: [],
      imageCount: 0,
      succeeded: 0,
      failed: 0,
      unprocessed: 0,
      totalOriginalBytes: 0,
      apiDurationSeconds: 0,
      processingDurationSeconds: 0,
      usage: emptyUsage("unknown"),
      mode: "general",
      language: saved,
    },
  };
}

function savedImagesDirResult(saved: string): DescribeResult {
  const now = new Date().toISOString();
  const model = lookupModel(DEFAULT_MODEL_ID);
  return {
    dir: saved,
    notice: null,
    text: `Saved images directory ${saved}.`,
    images: [],
    record: {
      schemaVersion: SCHEMA_VERSION,
      runId: randomUUID(),
      startedAt: now,
      endedAt: now,
      status: "ok",
      provider: model.provider,
      requestedModel: model.id,
      actualModel: null,
      requestedEffort: "default",
      effectiveEffort: "none",
      effortBehaviour: "omitted_documented_default",
      timeoutSeconds: 120,
      framePolicy: "first-frame-gif-tiff",
      processingDurationBoundary: DURATION_BOUNDARY,
      images: [],
      imageCount: 0,
      succeeded: 0,
      failed: 0,
      unprocessed: 0,
      totalOriginalBytes: 0,
      apiDurationSeconds: 0,
      processingDurationSeconds: 0,
      usage: emptyUsage("unknown"),
      mode: "general",
      language: "English",
    },
  };
}

function savedDefaultResult(saved: PromptMode): DescribeResult {
  const now = new Date().toISOString();
  const model = lookupModel(DEFAULT_MODEL_ID);
  return {
    dir: "",
    notice: null,
    text: `Saved default mode ${saved}.`,
    images: [],
    record: {
      schemaVersion: SCHEMA_VERSION,
      runId: randomUUID(),
      startedAt: now,
      endedAt: now,
      status: "ok",
      provider: model.provider,
      requestedModel: model.id,
      actualModel: null,
      requestedEffort: "default",
      effectiveEffort: "none",
      effortBehaviour: "omitted_documented_default",
      timeoutSeconds: 120,
      framePolicy: "first-frame-gif-tiff",
      processingDurationBoundary: DURATION_BOUNDARY,
      images: [],
      imageCount: 0,
      succeeded: 0,
      failed: 0,
      unprocessed: 0,
      totalOriginalBytes: 0,
      apiDurationSeconds: 0,
      processingDurationSeconds: 0,
      usage: emptyUsage("unknown"),
      mode: saved,
      language: "English",
    },
  };
}

async function savePresetEffort(env: NodeJS.ProcessEnv, effort: string): Promise<DescribeResult> {
  const selected = effort.trim();
  if (!selected) throw new Error("Preset effort must not be empty.");
  const mode = await readDefaultMode(env);
  if (mode === "detailed" || mode === "count") {
    throw new Error(
      "Preset effort can be saved only when the default mode is general, leisure, work, financial, or venue.",
    );
  }
  const saved = await writePresetEffort(env, selected);
  return savedEffortResult("preset", saved, mode);
}

async function saveDetailedEffort(env: NodeJS.ProcessEnv, effort: string): Promise<DescribeResult> {
  const selected = effort.trim();
  if (!selected) throw new Error("Detailed effort must not be empty.");
  const mode = await readDefaultMode(env);
  if (mode !== "detailed") {
    throw new Error("Detailed effort can be saved only when the default mode is detailed.");
  }
  const saved = await writeDetailedEffort(env, selected);
  return savedEffortResult("detailed", saved, mode);
}

async function saveCountEffort(env: NodeJS.ProcessEnv, effort: string): Promise<DescribeResult> {
  const selected = effort.trim();
  if (!selected) throw new Error("Count effort must not be empty.");
  const mode = await readDefaultMode(env);
  if (mode !== "count") {
    throw new Error("Count effort can be saved only when the default mode is count.");
  }
  const saved = await writeCountEffort(env, selected);
  return savedEffortResult("count", saved, mode);
}

function savedEffortResult(kind: "preset" | "detailed" | "count", effort: EffortLevel, mode: PromptMode): DescribeResult {
  const now = new Date().toISOString();
  const model = lookupModel(DEFAULT_MODEL_ID);
  return {
    dir: "",
    notice: null,
    text: `Saved ${kind} effort ${effort}.`,
    images: [],
    record: {
      schemaVersion: SCHEMA_VERSION,
      runId: randomUUID(),
      startedAt: now,
      endedAt: now,
      status: "ok",
      provider: model.provider,
      requestedModel: model.id,
      actualModel: null,
      requestedEffort: effort,
      effectiveEffort: effort,
      effortBehaviour: "sent",
      timeoutSeconds: 120,
      framePolicy: "first-frame-gif-tiff",
      processingDurationBoundary: DURATION_BOUNDARY,
      images: [],
      imageCount: 0,
      succeeded: 0,
      failed: 0,
      unprocessed: 0,
      totalOriginalBytes: 0,
      apiDurationSeconds: 0,
      processingDurationSeconds: 0,
      usage: emptyUsage("unknown"),
      mode,
      language: "English",
    },
  };
}

function sharesPresetEffort(mode: string | undefined): boolean {
  return mode !== undefined && mode !== "detailed" && mode !== "count" && (PROMPT_MODES as readonly string[]).includes(mode);
}

function prepare(
  request: DescribeRequest,
  overrides: PromptOverrides,
  detailedEffort?: EffortLevel,
  countEffort?: EffortLevel,
  presetEffort?: EffortLevel,
): Prepared {
  if (!request.dir?.trim()) throw new Error("Missing required flag --dir.");
  const modelId = request.model?.trim() || DEFAULT_MODEL_ID;
  const model = lookupModel(modelId);
  const timeoutSeconds = request.timeout === undefined ? 120 : request.timeout;
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error("Timeout must be a positive number of seconds.");
  }
  const language = checkedLanguage(request.language ?? DEFAULT_LANGUAGE);
  if (request.prompt !== undefined && !request.prompt.trim()) {
    throw new Error("Prompt must not be empty.");
  }
  const built = buildInstruction(language, request.mode, request.prompt, overrides);
  const requestedEffort =
    request.effort?.trim() ||
    (built.mode === "detailed"
      ? detailedEffort ?? DEFAULT_DETAILED_EFFORT
      : built.mode === "count"
        ? countEffort ?? DEFAULT_COUNT_EFFORT
        : presetEffort ?? (model.id === "deepseek-flash" ? "none" : "default"));
  const effort = resolveEffort(model, requestedEffort);
  const dir = path.resolve(request.cwd, request.dir);
  const logPath = path.resolve(request.cwd, request.log ?? DEFAULT_METRICS_FILE);
  const sessionId = request.sessionId?.trim();
  return {
    cwd: request.cwd,
    dir,
    logPath,
    modelId,
    effort,
    language,
    prompt: request.prompt,
    mode: built.mode,
    instruction: built.instruction,
    timeoutSeconds,
    ...(sessionId ? { sessionId } : {}),
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
        sourcePath: image.path,
        apiDurationSeconds: success.durationSeconds,
        usage: success.usage,
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
          apiDurationSeconds: error.durationSeconds,
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
  const runId = randomUUID();
  const model = lookupModel(input.prepared.modelId);
  const succeeded = input.outcomes.filter((item) => item.status === "succeeded").length;
  const failed = input.outcomes.filter((item) => item.status === "failed").length;
  const unprocessed = input.outcomes.filter((item) => item.status === "unprocessed").length;
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
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
      ...(item.apiDurationSeconds !== undefined ? { apiDurationSeconds: roundSeconds(item.apiDurationSeconds) } : {}),
      ...(item.description && item.sourcePath
        ? { descriptionFile: path.relative(input.prepared.cwd, `${item.sourcePath}.md`) }
        : {}),
      ...(item.usage ? { usage: ledgerUsage(item.usage) } : {}),
    })),
    imageCount: input.outcomes.length,
    succeeded,
    failed,
    unprocessed,
    totalOriginalBytes: input.outcomes.reduce((sum, item) => sum + item.bytes, 0),
    apiDurationSeconds: roundSeconds(input.apiDurationSeconds),
    processingDurationSeconds: roundSeconds(Number(process.hrtime.bigint() - input.startedHr) / 1e9),
    usage: input.usage,
    ...(input.outcomes.length === 0 ? { descriptionFile: path.join("descriptions", `${runId}.md`) } : {}),
    mode: input.prepared.mode,
    language: input.prepared.language,
    ...(input.prepared.sessionId ? { sessionId: input.prepared.sessionId } : {}),
  };
}

function imageCallsFrom(record: LedgerRecord): ImageCall[] {
  const model = record.actualModel || record.requestedModel;
  return record.images.map((image) => ({
    runId: record.runId,
    recordedAt: record.endedAt,
    filename: image.filename,
    mode: record.mode,
    effort: record.requestedEffort,
    language: record.language,
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    model,
    provider: record.provider,
    status: image.status,
    apiDurationSeconds: image.apiDurationSeconds ?? null,
    inputTokens: image.usage?.inputTokens ?? null,
    outputTokens: image.usage?.outputTokens ?? null,
    totalTokens: image.usage?.totalTokens ?? null,
    reasoningTokens: image.usage?.reasoningTokens ?? null,
    cachedTokens: image.usage?.cachedTokens ?? null,
  }));
}

function ledgerUsage(usage: UsagePiece): NonNullable<LedgerImage["usage"]> {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.total,
    reasoningTokens: usage.reasoning,
    cachedTokens: usage.cached,
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

/** Stdout lines for print mode: the run line and the saved paths, or the whole text of a run with no images. */
export function stdoutLines(result: DescribeResult): string[] {
  if (result.images.length === 0) return [result.text];
  const lines = result.text.split("\n");
  const run = lines.findIndex((line) => line.startsWith(`Run ${result.record.runId}:`));
  return lines.slice(run).filter((line) => line !== "");
}

/** Stderr lines for print mode. Successful descriptions stay off the terminal. */
export function failLines(result: { images: ImageOutcome[] }): string[] {
  return result.images
    .filter((image) => image.status !== "succeeded")
    .map((image) => `[FAIL] ${image.filename}: ${image.error ?? image.status}`);
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Local file error.";
}
