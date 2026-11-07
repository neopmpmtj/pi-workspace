// The mode switch: the hook above the JEV classifier.
//
// A mode is the enabled promptBuild option in ~/.pi/prompt-build-config.json
// (1-Personal, 2-Development, 3-Work, 4-Automatic). It is the session-level layer: the
// selected option contributes one section to the system prompt. inputPhrase (normal and
// advanced) is a different, per-turn feature and is untouched here.
//
// A message that asks what the mode is, or asks to change it, is answered by control-plane
// CLI calls instead of by the classifier and a reasoning model:
//
//   status -> `pi-config get promptBuild --json`            (~90 ms)
//   change -> the same read to resolve the name,
//             `pi-config use promptBuild.<mode>`, then the read again as a read-back
//
// The user's message is then replaced by an acknowledgement instruction that already
// carries the result, so the model only reports what the CLI did (modeSwitch.answer
// "hook" skips the model entirely).
//
// Failures never become a success message: a non-zero exit, a timeout, unparseable CLI
// output, or a read-back that disagrees with the change all produce an acknowledgement
// that says the mode did NOT change, quoting the CLI's own words.
//
// Detection is deterministic (no classifier, no model). The mode lives in
// prompt-build-config.json, which the web page and `pi-config` edit with the same store.
import { spawn } from "node:child_process";
import path from "node:path";
import { repoRoot } from "../ledger/env.ts";
import { detectModeRequest, isModeQuestion, type ModeRequest } from "./mode-detect.ts";

// The detector lives in its own module so the JEV classifier can call it too; re-exported
// here because callers of the mode switch only need this file.
export { detectModeRequest, isModeQuestion };
export type { ModeRequest };

/** The promptBuild section, as the CLI's `get promptBuild --json` reports it. */
export interface ModeState {
  enabled: boolean;
  /** The option that is on, or null when none is. */
  mode: string | null;
  options: string[];
}

/** One finished CLI call. */
export interface CliResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type CliRunner = (args: readonly string[]) => Promise<CliResult>;

export interface ModeRunOptions {
  env?: NodeJS.ProcessEnv;
  /** The control-plane CLI; defaults to ~/.pi/control/cli.ts. */
  cli?: string;
  /** The node binary; defaults to the one running pi. */
  node?: string;
  timeoutMs?: number;
  /** Tests replace the process with a fake. */
  run?: CliRunner;
}

/** Everything one mode request produced. */
export interface ModeOutcome {
  request: ModeRequest;
  ok: boolean;
  state: ModeState | null;
  /** The decisive call: the read-back on success, the failure on failure. */
  result: CliResult;
  /** Why it failed, one short sentence, or null when ok. */
  reason: string | null;
  calls: number;
  ms: number;
  /** One line for the screen and for hook mode. */
  answer: string;
  /** What the model receives instead of the user's message. */
  ack: string;
  /** One screen line describing what ran. */
  trace: string;
}

/** The project control-plane CLI, beside the agent home's parent. */
export function controlCliPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(repoRoot(env), "..", "control", "cli.ts");
}

/** Runs `pi-config` the way a shell would: the node that runs pi, then the CLI file. */
export function cliRunner(options: ModeRunOptions = {}): CliRunner {
  const env = options.env ?? process.env;
  const cli = options.cli ?? controlCliPath(env);
  const node = options.node ?? process.execPath;
  const timeoutMs = options.timeoutMs ?? 15_000;
  return (args) => new Promise((resolve) => {
    const child = spawn(node, ["--experimental-strip-types", cli, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CliResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error: Error) => finish({ ok: false, code: null, stdout, stderr: error.message, timedOut: false }));
    child.on("close", (code) => finish({ ok: code === 0, code, stdout, stderr, timedOut: false }));
  });
}

/** The promptBuild state in the CLI's JSON, or null when the output is not that shape. */
export function parseModeState(stdout: string): ModeState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.options)) return null;
  const options: string[] = [];
  let mode: string | null = null;
  for (const item of record.options) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const option = item as Record<string, unknown>;
    if (typeof option.name !== "string") return null;
    options.push(option.name);
    if (option.enabled === true) mode = option.name;
  }
  if (options.length === 0) return null;
  return { enabled: record.enabled === true, mode, options };
}

/**
 * Runs the CLI for this message and builds the acknowledgement.
 * Null when the message is not a mode request, so the caller can continue untouched.
 */
export async function runModeRequest(text: string, options: ModeRunOptions = {}): Promise<ModeOutcome | null> {
  const request = detectModeRequest(text);
  if (!request) return null;

  const run = options.run ?? cliRunner(options);
  const started = Date.now();
  let calls = 0;
  const call = async (args: readonly string[]): Promise<CliResult> => {
    calls += 1;
    return run(args);
  };
  const finish = (ok: boolean, state: ModeState | null, result: CliResult, reason: string | null): ModeOutcome =>
    buildOutcome(request, ok, state, result, reason, calls, Date.now() - started);

  if (request.kind === "status") {
    const result = await call(["get", "promptBuild", "--json"]);
    if (!result.ok) return finish(false, null, result, failureReason(result, "status"));
    const state = parseModeState(result.stdout);
    if (!state) return finish(false, null, result, "the CLI printed no mode state");
    return finish(true, state, result, null);
  }

  // Resolve what the speaker said against the names the CLI reports, so "development"
  // finds "2-Development" and unknown words never reach `use`.
  const before = await call(["get", "promptBuild", "--json"]);
  if (!before.ok) return finish(false, null, before, failureReason(before, "status"));
  const known = parseModeState(before.stdout);
  if (!known) return finish(false, null, before, "the CLI printed no mode state");
  const mode = resolveModeOption(request.mode, known.options);
  if (!mode) {
    return finish(false, known, before, `no mode "${request.mode}" · promptBuild has ${known.options.join(", ")}`);
  }

  const change = await call(["use", `promptBuild.${mode}`]);
  if (!change.ok) return finish(false, known, change, failureReason(change, `change to ${mode}`));
  const read = await call(["get", "promptBuild", "--json"]);
  if (!read.ok) return finish(false, null, read, failureReason(read, "read-back"));
  const state = parseModeState(read.stdout);
  if (!state) return finish(false, null, read, "the CLI printed no mode state");
  if (state.mode !== mode) {
    return finish(false, state, read, `the CLI reported success but the mode reads back as ${state.mode ?? "none"}`);
  }
  return finish(true, state, read, null);
}

/**
 * The option name the speaker meant, or null.
 * Exact case-insensitive name first, then the name without its leading number, then the
 * number alone, then a unique prefix of the name without its number.
 */
export function resolveModeOption(token: string, options: readonly string[]): string | null {
  const want = token.trim().toLowerCase();
  if (!want) return null;
  const exact = options.find((name) => name.toLowerCase() === want);
  if (exact) return exact;
  const bare = (name: string): string => name.replace(/^\d+[-_.]?\s*/, "").toLowerCase();
  const byBare = options.filter((name) => bare(name) === want);
  if (byBare.length === 1) return byBare[0];
  const byNumber = options.filter((name) => (name.match(/^\d+/) ?? [""])[0] === want);
  if (byNumber.length === 1) return byNumber[0];
  if (want.length < 3) return null;
  const prefixes = options.filter((name) => bare(name).startsWith(want));
  return prefixes.length === 1 ? prefixes[0] : null;
}

function failureReason(result: CliResult, what: string): string {
  if (result.timedOut) return `the ${what} CLI call timed out`;
  const said = (result.stderr || result.stdout).trim().replace(/\s+/g, " ").slice(0, 300);
  if (said) return said;
  return `the ${what} CLI call exited ${result.code === null ? "without a status" : result.code}`;
}

function buildOutcome(
  request: ModeRequest,
  ok: boolean,
  state: ModeState | null,
  result: CliResult,
  reason: string | null,
  calls: number,
  ms: number,
): ModeOutcome {
  const mode = state?.mode ?? (request.kind === "change" ? request.mode : null);
  const section = state ? (state.enabled ? "promptBuild on" : "promptBuild off") : "";
  const subject = request.kind === "change" ? `change to "${request.mode}"` : "status";
  const trace = `[mode]  ${subject} → ${ok ? "ok" : "FAILED"}${mode && ok ? ` ${mode}` : ""} · ${calls} cli · ${ms} ms`;
  return {
    request,
    ok,
    state,
    result,
    reason,
    calls,
    ms,
    trace,
    answer: ok ? answerLine(mode, section, request.kind) : `[mode]  ${failureHead(request)}: ${reason}`,
    ack: ok ? ackSuccess(request, mode, section) : ackFailure(request, reason),
  };
}

function answerLine(mode: string | null, section: string, kind: ModeRequest["kind"]): string {
  const tail = section ? ` · ${section}` : "";
  return kind === "change" ? `[mode]  mode is now ${mode ?? "none"}${tail}` : `[mode]  mode: ${mode ?? "none"}${tail}`;
}

function failureHead(request: ModeRequest): string {
  return request.kind === "change" ? `change to ${request.mode} did not happen` : "status not read";
}

function ackSuccess(request: ModeRequest, mode: string | null, section: string): string {
  const state = section ? ` (${section})` : "";
  if (request.kind === "change") {
    return [
      `Already executed by the pi-config CLI, which succeeded: the agent's mode is now "${mode}"${state}.`,
      `Reply in one short line, for example: Done — mode is now ${mode}.`,
      "Do not run a tool, do not verify, do not explain.",
    ].join("\n");
  }
  return [
    `Already executed by the pi-config CLI, which succeeded: the agent's mode is "${mode}"${state}.`,
    `Reply in one short line, for example: Mode: ${mode}.`,
    "Do not run a tool, do not explain.",
  ].join("\n");
}

function ackFailure(request: ModeRequest, reason: string | null): string {
  const what = request.kind === "change" ? `the change to "${request.mode}"` : "reading the mode";
  return [
    `Already executed by the pi-config CLI, which FAILED: ${what} did not happen.`,
    `What the CLI said: ${reason ?? "no output"}`,
    "Reply in one short line saying it did not change, quoting that reason. " +
      "Do not claim success, do not retry, do not run a tool.",
  ].join("\n");
}
