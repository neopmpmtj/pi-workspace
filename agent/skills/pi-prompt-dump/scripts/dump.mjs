#!/usr/bin/env node
/**
 * pi-prompt-dump — deterministic reproduction of the live pi system prompt.
 *
 * Design contract:
 *   - Zero LLM calls, zero network. Identical inputs -> byte-identical output.
 *   - Sections come from the session transcript, which is the same structured
 *     state pi replays. Rendering mirrors pi-ai's getSystemMessageText():
 *         [content, ...Object.values(sections).filter(v => v !== null)]
 *           .filter(p => p.length > 0).join("\n\n")
 *   - Request-time injected blocks (currently only the subagent list) are not
 *     persisted by pi, so they are rebuilt by code from their pinned source.
 *   - Redaction affects display only; hashing/baseline always use raw text.
 *
 * The only optional LLM use is `--triage`, which pipes a diff to `pi --print`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { redact } from "./lib/redact.mjs";
import { renderSubagentBlock, SUBAGENT_CONTRACT_VERSION } from "./lib/subagent-block.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.dirname(HERE);
const PARTS_FILE = path.join(HERE, "parts.json");
const BASELINE_DIR = path.join(SKILL_DIR, "baseline");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `pi-prompt-dump — reproduce the live pi system prompt, deterministically.

Usage: dump.mjs [options]

Output modes (pick one; --print is the default)
  --print              Annotated markdown dump to stdout
  --exact              Raw concatenated prompt only (byte-faithful, no headers)
  --json               Machine-readable JSON, including attribution
  --list               Section inventory: name, size, origin, source
  --hash               Per-section and overall sha256
  --save <path>        Write the annotated markdown dump to a file

Comparison
  --baseline save      Snapshot the current prompt into baseline/
  --check              Diff current vs baseline; exit 1 when drifted
  --triage             Explain a --check diff using one LLM call (pi --print)

Input
  --session <path>     Explicit session .jsonl (default: $PI_SESSION_FILE, else newest)
  --cwd <path>         Override cwd used for agent discovery and the <cwd> section

Behaviour
  --no-reconstruct     Do not rebuild request-time injected blocks
  --no-redact          Disable secret redaction for display output
  --quiet              Suppress the header block
  --help               Show this help
`;

function parseArgs(argv) {
  const opts = {
    mode: "print",
    session: null,
    cwd: process.cwd(),
    reconstruct: true,
    redact: true,
    quiet: false,
    savePath: null,
    parts: null,
    includeRuntime: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];

    if (arg === "--help" || arg === "-h") opts.mode = "help";
    else if (arg === "--print") opts.mode = "print";
    else if (arg === "--exact") opts.mode = "exact";
    else if (arg === "--json") opts.mode = "json";
    else if (arg === "--list") opts.mode = "list";
    else if (arg === "--hash") opts.mode = "hash";
    else if (arg === "--check") opts.mode = "check";
    else if (arg === "--triage") opts.mode = "triage";
    else if (arg === "--baseline") {
      const value = next();
      if (value !== "save") fail(`--baseline expects "save", got ${value ?? "(nothing)"}`);
      opts.mode = "baseline-save";
    } else if (arg === "--save") {
      opts.savePath = next();
      if (!opts.savePath) fail("--save requires a path");
    } else if (arg === "--session") {
      opts.session = next();
      if (!opts.session) fail("--session requires a path");
    } else if (arg === "--cwd") {
      opts.cwd = next();
      if (!opts.cwd) fail("--cwd requires a path");
    } else if (arg === "--parts") {
      opts.parts = next();
      if (!opts.parts) fail("--parts requires a comma-separated list");
    } else if (arg === "--no-reconstruct") opts.reconstruct = false;
    else if (arg === "--no-redact") opts.redact = false;
    else if (arg === "--quiet") opts.quiet = true;
    else if (arg.startsWith("--parts=")) opts.parts = arg.slice("--parts=".length);
    else fail(`Unknown option: ${arg}`);
  }

  return opts;
}

function fail(message) {
  process.stderr.write(`pi-prompt-dump: ${message}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Session discovery + transcript replay
// ---------------------------------------------------------------------------

function configDir() {
  return process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
}

function findNewestSession() {
  const root = path.join(configDir(), "sessions");
  const found = [];

  const walk = (dir, depth) => {
    if (depth > 2) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.endsWith(".jsonl")) {
        try {
          found.push({ file: full, mtime: fs.statSync(full).mtimeMs });
        } catch {
          /* ignore */
        }
      }
    }
  };

  walk(root, 0);
  if (found.length === 0) return null;
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0].file;
}

function resolveSession(explicit) {
  if (explicit) {
    if (!fs.existsSync(explicit)) fail(`session file not found: ${explicit}`);
    return explicit;
  }
  const fromEnv = process.env.PI_SESSION_FILE?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const newest = findNewestSession();
  if (!newest) fail("no session file found (looked in $PI_CODING_AGENT_DIR/sessions and $PI_SESSION_FILE)");
  return newest;
}

/**
 * Replay the transcript's system messages.
 *
 * pi stores the prompt as structured `sections` and later sends PATCHES
 * (see diffSystemPromptSections): changed sections carry new text, removed
 * sections carry null. Plain key assignment reproduces JS object semantics,
 * which is exactly pi's merge behaviour — updated keys keep their position and
 * new keys append.
 */
function replayTranscript(sessionFile) {
  const raw = fs.readFileSync(sessionFile, "utf8");
  const records = [];
  const warnings = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      warnings.push(`skipped unparsable transcript line (${trimmed.length} bytes)`);
      continue;
    }
    records.push(record);
  }

  const sessionRecord = records.find((r) => r.type === "session");
  const systemMessages = records.filter(
    (r) => r.type === "message" && r.message && r.message.role === "system",
  );

  if (systemMessages.length === 0) fail(`no system message found in ${sessionFile}`);

  const sections = {};
  let content = "";
  let forced = false;

  for (const { message } of systemMessages) {
    if (typeof message.content === "string" && message.content.length > 0) {
      content = message.content;
      forced = true;
    }
    for (const [name, value] of Object.entries(message.sections ?? {})) {
      sections[name] = value;
    }
  }

  return {
    sessionFile,
    sessionId: sessionRecord?.id ?? null,
    sessionVersion: sessionRecord?.version ?? null,
    cwd: sessionRecord?.cwd ?? null,
    sections,
    content,
    forced,
    systemMessageCount: systemMessages.length,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function loadPartsManifest() {
  try {
    return JSON.parse(fs.readFileSync(PARTS_FILE, "utf8"));
  } catch (error) {
    fail(`cannot read parts.json: ${error.message}`);
  }
}

function buildParts(opts) {
  const replay = replayTranscript(resolveSession(opts.session));
  const manifest = loadPartsManifest();
  const parts = [];
  const warnings = [...replay.warnings];

  // Lead content (only non-empty when forceSystemPrompt is in play).
  if (replay.content) {
    parts.push({
      name: "content",
      text: replay.content,
      kind: "generated",
      origin: "pi core",
      source: "forceSystemPrompt",
      detail: "Opaque prompt; sections are not used when this is present.",
      runtime: false,
    });
  }

  for (const [name, value] of Object.entries(replay.sections)) {
    if (value === null) {
      warnings.push(`section "${name}" was removed by a later transcript patch`);
      continue;
    }
    const meta = manifest.sections?.[name] ?? {
      kind: "unknown",
      origin: "unknown",
      source: "not in parts.json",
      detail: "Unmapped section. Add it to scripts/parts.json.",
    };
    parts.push({
      name,
      text: value,
      kind: meta.kind,
      origin: meta.origin,
      source: meta.source,
      detail: meta.detail,
      runtime: false,
    });
  }

  // Request-time injections: appended to the rendered string, never persisted.
  if (opts.reconstruct) {
    const block = renderSubagentBlock({ cwd: opts.cwd, env: process.env });
    if (block.text) {
      const meta = manifest.runtimeInjections?.find((r) => r.id === "available_subagents");
      parts.push({
        name: "available_subagents",
        text: block.text,
        kind: meta?.kind ?? "extension-request-time",
        origin: meta?.origin ?? "extension",
        source: meta?.source ?? "@mjakl/pi-subagent",
        detail: `Reconstructed (not persisted by pi). Pinned to contract v${SUBAGENT_CONTRACT_VERSION}.`,
        runtime: true,
        reconstructed: true,
      });
    }
    if (block.agents.length === 0) {
      warnings.push("no subagents discovered; the injected subagent block would be empty and is omitted");
    }
  }

  const filtered = opts.parts
    ? (() => {
        const wanted = new Set(
          opts.parts.split(",").map((s) => s.trim()).filter(Boolean),
        );
        return parts.filter((p) => wanted.has(p.name));
      })()
    : parts;

  return { parts: filtered, allParts: parts, replay, manifest, warnings };
}

/** Mirror of pi-ai getSystemMessageText(). */
function renderPrompt(parts) {
  return parts
    .map((p) => p.text)
    .filter((t) => typeof t === "string" && t.length > 0)
    .join("\n\n");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Baseline + diff
// ---------------------------------------------------------------------------

function safeName(name) {
  return `${name.replace(/[^a-zA-Z0-9._-]/g, "_")}.txt`;
}

function baselinePaths() {
  return {
    dir: BASELINE_DIR,
    meta: path.join(BASELINE_DIR, "meta.json"),
    sections: path.join(BASELINE_DIR, "sections"),
  };
}

function baselineSave(built, prompt) {
  const paths = baselinePaths();
  fs.rmSync(paths.sections, { recursive: true, force: true });
  fs.mkdirSync(paths.sections, { recursive: true });

  const hashes = {};
  for (const part of built.parts) {
    fs.writeFileSync(path.join(paths.sections, safeName(part.name)), part.text, "utf8");
    hashes[part.name] = sha256(part.text);
  }

  fs.writeFileSync(
    paths.meta,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        sessionFile: built.replay.sessionFile,
        sessionId: built.replay.sessionId,
        sessionVersion: built.replay.sessionVersion,
        cwd: built.replay.cwd,
        promptHash: sha256(prompt),
        promptLength: prompt.length,
        sectionOrder: built.parts.map((p) => p.name),
        hashes,
        parts: built.parts.map((p) => ({
          name: p.name,
          kind: p.kind,
          origin: p.origin,
          source: p.source,
          runtime: p.runtime,
          length: p.text.length,
        })),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  return paths.meta;
}

function unifiedDiff(leftText, rightText, leftLabel, rightLabel) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-prompt-dump-"));
  const leftFile = path.join(tmp, "baseline");
  const rightFile = path.join(tmp, "current");
  fs.writeFileSync(leftFile, leftText, "utf8");
  fs.writeFileSync(rightFile, rightText, "utf8");

  const result = spawnSync("diff", ["-u", "--label", leftLabel, "--label", rightLabel, leftFile, rightFile], {
    encoding: "utf8",
  });

  fs.rmSync(tmp, { recursive: true, force: true });

  if (result.error) return `(diff unavailable: ${result.error.message})\n`;
  return result.stdout ?? "";
}

function baselineCheck(built, prompt) {
  const paths = baselinePaths();
  if (!fs.existsSync(paths.meta)) {
    return {
      ok: false,
      reason: "no baseline",
      message: `No baseline found at ${paths.meta}. Run: dump.mjs --baseline save`,
      diffs: [],
    };
  }

  const meta = JSON.parse(fs.readFileSync(paths.meta, "utf8"));
  const currentHashes = {};
  for (const part of built.parts) currentHashes[part.name] = sha256(part.text);

  const diffs = [];
  const baselineNames = new Set(meta.sectionOrder ?? []);
  const currentNames = new Set(built.parts.map((p) => p.name));

  for (const part of built.parts) {
    const basePath = path.join(paths.sections, safeName(part.name));
    if (!baselineNames.has(part.name) || !fs.existsSync(basePath)) {
      diffs.push({ name: part.name, status: "added", text: `+ section added (${part.text.length} chars)` });
      continue;
    }
    const previous = fs.readFileSync(basePath, "utf8");
    if (meta.hashes?.[part.name] === currentHashes[part.name]) continue;
    diffs.push({
      name: part.name,
      status: "changed",
      text: unifiedDiff(
        previous,
        part.text,
        `baseline/${safeName(part.name)}`,
        `current/${safeName(part.name)}`,
      ),
    });
  }

  for (const name of baselineNames) {
    if (!currentNames.has(name)) diffs.push({ name, status: "removed", text: `- section removed` });
  }

  const orderChanged = JSON.stringify(meta.sectionOrder ?? []) !== JSON.stringify(built.parts.map((p) => p.name));

  return {
    ok: diffs.length === 0 && !orderChanged,
    reason: diffs.length === 0 && !orderChanged ? "clean" : "drift",
    meta,
    promptHash: sha256(prompt),
    promptChanged: meta.promptHash !== sha256(prompt),
    orderChanged,
    baselineOrder: meta.sectionOrder ?? [],
    currentOrder: built.parts.map((p) => p.name),
    diffs,
  };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function header(built, prompt, redaction) {
  const lines = [];
  lines.push("# pi prompt dump");
  lines.push("");
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Session: ${built.replay.sessionFile}`);
  lines.push(`- Session id: ${built.replay.sessionId ?? "(unknown)"} · pi version: ${built.replay.sessionVersion ?? "(unknown)"}`);
  lines.push(`- Session cwd: ${built.replay.cwd ?? "(unknown)"} · discovery cwd: ${process.cwd()}`);
  lines.push(`- Transcript system messages: ${built.replay.systemMessageCount}`);
  lines.push(`- Parts: ${built.parts.length} (${built.parts.filter((p) => p.runtime).length} reconstructed)`);
  lines.push(`- Total prompt: ${prompt.length} chars · sha256 ${sha256(prompt)}`);
  if (redaction && redaction.total > 0) {
    lines.push(`- Redaction: ${redaction.total} replacement(s) — ${Object.entries(redaction.counts).map(([k, v]) => `${k}:${v}`).join(", ")}`);
  } else if (redaction) {
    lines.push("- Redaction: enabled, 0 matches");
  }
  if (built.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of [...new Set(built.warnings)]) lines.push(`- ${warning}`);
  }
  return lines.join("\n");
}

function annotated(built, prompt, redaction) {
  const out = [];
  out.push(header(built, prompt, redaction));
  out.push("");
  out.push("---");
  out.push("");

  built.parts.forEach((part, index) => {
    const flags = [part.kind, part.origin, part.source].filter(Boolean).join(" · ");
    out.push(`## ${index + 1}. ${part.name}  (${part.text.length} chars)`);
    out.push(`_${flags}_`);
    if (part.detail) out.push(`_${part.detail}_`);
    out.push("");
    out.push(part.text);
    out.push("");
    out.push("---");
    out.push("");
  });

  return out.join("\n");
}

function listMode(built, prompt) {
  const rows = built.parts.map((part) => ({
    name: part.name,
    chars: part.text.length,
    kind: part.kind,
    origin: part.origin,
    source: part.source,
    runtime: part.runtime,
    sha256: sha256(part.text).slice(0, 12),
  }));

  const width = Math.max(...rows.map((r) => r.name.length), 4);
  const lines = [`TOTAL ${prompt.length} chars · ${built.parts.length} parts`, ""];
  for (const row of rows) {
    lines.push(
      `${row.name.padEnd(width)}  ${String(row.chars).padStart(7)}  ${row.sha256}  ${row.runtime ? "RUNTIME" : "section"}  ${row.source}`,
    );
  }
  return lines.join("\n");
}

function hashMode(built, prompt) {
  const lines = built.parts.map((part) => `${sha256(part.text)}  ${part.name}`);
  lines.push(`${sha256(prompt)}  TOTAL`);
  return lines.join("\n");
}

function runTriage(diffText) {
  const triageScript = path.join(HERE, "triage.sh");
  if (!fs.existsSync(triageScript)) fail(`triage script missing: ${triageScript}`);
  const result = spawnSync("bash", [triageScript], {
    input: diffText,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.error) fail(`triage failed: ${result.error.message}`);
  process.exit(result.status ?? 0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.mode === "help") {
    process.stdout.write(USAGE);
    return;
  }

  if (opts.mode === "triage") {
    const built = buildParts(opts);
    const prompt = renderPrompt(built.parts);
    const check = baselineCheck(built, prompt);
    if (check.ok) {
      process.stdout.write("No drift against baseline; nothing to triage.\n");
      return;
    }
    if (check.reason === "no baseline") fail(check.message);
    runTriage(check.diffs.map((d) => `### ${d.name} (${d.status})\n${d.text}`).join("\n"));
    return;
  }

  const built = buildParts(opts);
  const prompt = renderPrompt(built.parts);
  const redaction = opts.redact ? redact(prompt) : null;

  switch (opts.mode) {
    case "exact": {
      process.stdout.write(opts.redact ? redaction.text : prompt);
      if (!opts.redact ? prompt.endsWith("\n") : redaction.text.endsWith("\n")) break;
      process.stdout.write("\n");
      break;
    }
    case "json": {
      const payload = {
        generatedAt: new Date().toISOString(),
        session: {
          file: built.replay.sessionFile,
          id: built.replay.sessionId,
          version: built.replay.sessionVersion,
          cwd: built.replay.cwd,
          systemMessageCount: built.replay.systemMessageCount,
        },
        prompt: {
          length: prompt.length,
          sha256: sha256(prompt),
          redactedLength: redaction ? redaction.text.length : null,
          redactionCounts: redaction?.counts ?? {},
        },
        parts: built.parts.map((part) => ({
          name: part.name,
          length: part.text.length,
          sha256: sha256(part.text),
          kind: part.kind,
          origin: part.origin,
          source: part.source,
          detail: part.detail,
          runtime: part.runtime,
          reconstructed: Boolean(part.reconstructed),
          text: opts.redact ? redact(part.text).text : part.text,
        })),
        warnings: [...new Set(built.warnings)],
      };
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      break;
    }
    case "list":
      process.stdout.write(listMode(built, prompt) + "\n");
      break;
    case "hash":
      process.stdout.write(hashMode(built, prompt) + "\n");
      break;
    case "baseline-save": {
      const metaPath = baselineSave(built, prompt);
      process.stdout.write(`Baseline saved: ${metaPath}\n`);
      process.stdout.write(`  parts: ${built.parts.length} · prompt ${prompt.length} chars · sha256 ${sha256(prompt)}\n`);
      break;
    }
    case "check": {
      const check = baselineCheck(built, prompt);
      if (check.reason === "no baseline") fail(check.message);
      if (check.ok) {
        process.stdout.write(`No drift. ${built.parts.length} parts · sha256 ${sha256(prompt)}\n`);
        process.stdout.write(`Baseline from ${check.meta.savedAt}\n`);
        return;
      }
      process.stdout.write(`DRIFT DETECTED (baseline ${check.meta.savedAt})\n`);
      if (check.promptChanged) {
        process.stdout.write(`  prompt sha256: ${check.meta.promptHash} -> ${sha256(prompt)}\n`);
      }
      if (check.orderChanged) {
        process.stdout.write(`  section order changed:\n    was: ${check.baselineOrder.join(", ")}\n    now: ${check.currentOrder.join(", ")}\n`);
      }
      process.stdout.write("\n");
      for (const diff of check.diffs) {
        process.stdout.write(`### ${diff.name} (${diff.status})\n`);
        process.stdout.write(diff.text.endsWith("\n") ? diff.text : `${diff.text}\n`);
      }
      process.exit(1);
      break;
    }
    default: {
      const text = annotated(built, prompt, redaction);
      if (opts.savePath) {
        const target = path.resolve(opts.savePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `${text}\n`, "utf8");
        process.stdout.write(`Wrote ${target} (${text.length} chars)\n`);
      } else {
        process.stdout.write(`${text}\n`);
      }
    }
  }
}

main();
