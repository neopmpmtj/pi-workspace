/**
 * The VPS side of the switch page: read and write the Telegram speech switches
 * on the host that runs the bridge, over ssh.
 *
 * Why ssh and not an API on the VPS: the page runs on whichever machine the
 * user opened it on, and the VPS is the machine that owns the bot. A small
 * allowlisted command (`scripts/speech/host-toggle.sh`) keeps both ends
 * honest — the same script, the same JSON, no free-form shell.
 *
 * Everything here is pure except `runSsh`, which is injectable so the tests
 * never touch the network.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { telegramVoicePath } from "../agent/src/telegram-voice-switch.ts";

export const DEFAULT_SSH = "ssh";
export const DEFAULT_VPS_HOST = "neopmpmtj";
export const VPS_AGENT_UNIT = "pi-vps-agent.service";

/** Batch: fail instead of prompting, never hang the page, trust a first connection. */
export const SSH_OPTIONS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=4",
  "-o",
  "StrictHostKeyChecking=accept-new",
];

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (file: string, args: string[]) => Promise<ExecResult>;

export interface VpsOptions {
  host?: string;
  ssh?: string;
  exec?: Exec;
  /** local when the page runs on the host that owns the bot; decided per call by default. */
  mode?: "local" | "remote";
}

/** What `host-toggle.sh status` prints on the remote host. */
export interface ToggleSnapshot {
  host: string;
  file: string;
  tui: boolean;
  telegram: boolean;
  speak: string;
  mode: string | null;
}

export interface VpsSpeech {
  host: string;
  reachable: boolean;
  /** PI_SPEECH_TELEGRAM on the VPS: the live switch for voice notes. */
  notes: { on: boolean };
  /** voice.replyMode as the bridge has it; changing it needs a bridge restart. */
  mode: string | null;
  /** active | inactive | failed | unknown */
  bridge: string;
  engine: string;
  /** Why it is unreachable or degraded, in one line, when there is a reason. */
  detail?: string;
}

export const defaultExec: Exec = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 15_000 }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : error ? 1 : 0;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });

export type ToggleAction =
  | { action: "status" }
  | { action: "set"; key: "tui" | "telegram"; value: "on" | "off" };

/** The exact remote command; the only two shapes the site is allowed to send. */
export function toggleCommand(request: ToggleAction): string {
  const base = 'exec "$HOME/.pi/agent/scripts/speech/host-toggle.sh"';
  if (request.action === "status") return `${base} status`;
  const { key, value } = request;
  if (key !== "tui" && key !== "telegram") throw new Error(`unknown switch: ${String(key)}`);
  if (value !== "on" && value !== "off") throw new Error(`unknown value: ${String(value)}`);
  return `${base} set ${key} ${value}`;
}

/** Parses the last JSON line of the script's stdout; undefined when it is not one. */
export function parseSnapshot(stdout: string): ToggleSnapshot | undefined {
  const line = stdout
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("{"))
    .pop();
  if (!line) return undefined;
  try {
    const parsed = JSON.parse(line) as Partial<ToggleSnapshot> & { error?: unknown };
    if (typeof parsed.error === "string") return undefined;
    if (typeof parsed.telegram !== "boolean" || typeof parsed.tui !== "boolean") return undefined;
    return {
      host: typeof parsed.host === "string" ? parsed.host : "unknown",
      file: typeof parsed.file === "string" ? parsed.file : "",
      tui: parsed.tui,
      telegram: parsed.telegram,
      speak: typeof parsed.speak === "string" ? parsed.speak : "unknown",
      mode: typeof parsed.mode === "string" ? parsed.mode : null,
    };
  } catch {
    return undefined;
  }
}

async function runSsh(command: string, options: VpsOptions): Promise<ExecResult> {
  const host = options.host ?? process.env.PI_SITE_VPS_HOST ?? DEFAULT_VPS_HOST;
  const ssh = options.ssh ?? process.env.PI_SITE_SSH ?? DEFAULT_SSH;
  const exec = options.exec ?? defaultExec;
  return exec(ssh, [...SSH_OPTIONS, host, command]);
}

/** Reads both live facts: the switch file and whether the bridge is up. */
export function localTogglePath(): string {
  return join(homedir(), ".pi", "agent", "scripts", "speech", "host-toggle.sh");
}

/**
 * True when this machine owns the bot: its telegram.json exists. That is the
 * VPS itself, so its own page reads the switches directly instead of ssh-ing
 * to its own address. The laptop has no such file and always goes remote.
 * PI_SITE_VPS_LOCAL=1|0 forces the answer.
 */
export function bridgeIsLocal(): boolean {
  const forced = process.env.PI_SITE_VPS_LOCAL;
  if (forced === "1") return true;
  if (forced === "0") return false;
  return existsSync(telegramVoicePath());
}

export function localToggleArgs(request: ToggleAction, script: string = localTogglePath()): string[] {
  if (request.action === "status") return [script, "status"];
  return [script, "set", request.key, request.value];
}

async function readState(options: VpsOptions): Promise<{
  mode: "local" | "remote";
  toggle: ExecResult;
  bridge: ExecResult | undefined;
}> {
  const mode = options.mode ?? (bridgeIsLocal() ? "local" : "remote");
  const exec = options.exec ?? defaultExec;
  if (mode === "local") {
    const [toggle, bridge] = await Promise.all([
      exec("bash", localToggleArgs({ action: "status" })),
      exec("systemctl", ["--user", "is-active", VPS_AGENT_UNIT]).catch(() => undefined),
    ]);
    return { mode, toggle, bridge };
  }
  const [toggle, bridge] = await Promise.all([
    runSsh(toggleCommand({ action: "status" }), options),
    runSsh(`systemctl --user is-active ${VPS_AGENT_UNIT}`, options).catch(() => undefined),
  ]);
  return { mode, toggle, bridge };
}

export async function readVpsSpeech(options: VpsOptions = {}): Promise<VpsSpeech> {
  const host = options.host ?? process.env.PI_SITE_VPS_HOST ?? DEFAULT_VPS_HOST;
  const { mode, toggle, bridge } = await readState(options);
  const snapshot = toggle.code === 0 ? parseSnapshot(toggle.stdout) : undefined;
  if (!snapshot) {
    const detail = (toggle.stderr || toggle.stdout || `ssh exited ${toggle.code}`).trim().split("\n")[0];
    return {
      host: mode === "local" ? hostname() : host,
      reachable: false,
      notes: { on: false },
      mode: null,
      bridge: "unknown",
      engine: "unknown",
      detail: detail || (mode === "local" ? "host-toggle.sh did not answer" : "the VPS did not answer"),
    };
  }
  const unit = (bridge?.stdout ?? "").trim().split("\n")[0] || "unknown";
  return {
    host: mode === "local" ? snapshot.host || hostname() : host,
    reachable: true,
    notes: { on: snapshot.telegram },
    mode: snapshot.mode,
    bridge: /^(active|inactive|failed|activating|deactivating|unknown)$/.test(unit) ? unit : "unknown",
    engine: snapshot.speak,
    ...(snapshot.speak === "missing" ? { detail: "speak.sh is missing on the VPS" } : {}),
  };
}

/** Writes the live voice-notes switch, then reports what the VPS now says. */
export async function writeVpsNotes(on: boolean, options: VpsOptions = {}): Promise<VpsSpeech> {
  const mode = options.mode ?? (bridgeIsLocal() ? "local" : "remote");
  const exec = options.exec ?? defaultExec;
  const request: ToggleAction = { action: "set", key: "telegram", value: on ? "on" : "off" };
  const written = mode === "local"
    ? await exec("bash", localToggleArgs(request))
    : await runSsh(toggleCommand(request), options);
  if (written.code !== 0) {
    const snapshot = parseSnapshot(written.stdout);
    const detail = snapshot ? undefined : (written.stderr || written.stdout || `ssh exited ${written.code}`).trim().split("\n")[0];
    const state = await readVpsSpeech(options);
    return { ...state, reachable: false, detail: detail || state.detail || "the switch was not written" };
  }
  return readVpsSpeech(options);
}
