/**
 * Reconstruction of the request-time injected "Available Subagents" block.
 *
 * WHY THIS EXISTS
 * ---------------
 * `@mjakl/pi-subagent` appends this block in its `before_agent_start` handler:
 *
 *     return { systemPrompt: event.systemPrompt + formatAvailableSubagentsPrompt(...) }
 *
 * Per pi's extension docs, returning `systemPrompt` "replaces the whole prompt
 * for that run while the transcript continues recording the structured
 * sections". The block is therefore NEVER persisted in the session transcript,
 * so a pure transcript replay cannot see it.
 *
 * This module ports the wording from the package's own `contract.ts` so the
 * block can be rebuilt deterministically, with no LLM call. The ported string
 * literals are pinned to the package version below; `dump.mjs --check` will
 * surface drift, and `--verify` compares against a live capture when one exists.
 *
 * Source of truth (pinned):
 *   @mjakl/pi-subagent@3.0.1 -> contract.ts, agents.ts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { oneLine, parseCsv, parseFrontmatter } from "./frontmatter.mjs";

export const SUBAGENT_CONTRACT_VERSION = "3.0.1";

const DEFAULT_MAX_DELEGATION_DEPTH = 3;
const DEFAULT_PREVENT_CYCLE_DELEGATION = true;
const CONFIG_DIR_NAME = ".pi";

const CALL_FIELDS = [
  {
    name: "agent",
    required: true,
    promptDescription: "exact available agent name",
  },
  {
    name: "prompt",
    required: true,
    promptDescription: "non-empty prompt sent verbatim to the subagent",
  },
  {
    name: "model",
    required: false,
    promptDescription:
      "model to use for this call. Overrides the agent file's default model. If omitted, the agent's default model is used when configured; otherwise Pi uses the parent session's current effective model",
  },
  {
    name: "cwd",
    required: false,
    promptDescription: "working directory for this subagent process",
  },
  {
    name: "initialContext",
    required: false,
    promptDescription:
      '`"empty"` (default) starts without parent history; `"parent"` exceptionally clones the current parent session snapshot, which is expensive and carries the parent conversation\'s authority. Prefer empty and pass relevant context deliberately. Existing named sessions ignore this field',
  },
  {
    name: "session",
    required: false,
    promptDescription:
      "durable conversation handle. If present, the call continues or creates a persistent child Pi session. The handle is scoped by parent session, effective cwd, and agent name. The same handle used with different agents resolves to different sessions. Requires a persisted parent Pi session",
  },
  {
    name: "inactivityTimeout",
    required: false,
    promptDescription:
      "positive integer inactivity timeout in seconds. Overrides the agent default; otherwise the agent default applies, or there is no inactivity timeout. It resets only on child RPC stdout activity",
  },
  {
    name: "timeout",
    required: false,
    promptDescription:
      "exceptional positive integer absolute wall-clock deadline in seconds, independent of `inactivityTimeout`. Omit it for ordinary stuck-run protection",
  },
];

const DELEGATION_RULES = [
  "- Do not use the same resolved session in more than one concurrent call. Same handle + same agent + same cwd conflicts; same handle + different agent is allowed. If a stale session lock is reported, remove the lock directory only after confirming no subagent is still running.",
  "- Use `session` for multi-turn specialist work; omit it for one-off delegation, when the parent is running with `--no-session`, or from temporary parent-seeded subagent sessions.",
  "- Agent-specific session preference and hint lines are advisory only. The tool creates or continues a persistent session only when a call includes `session`.",
  '- Prefer `initialContext: "empty"` and pass relevant task context deliberately. Parent cloning is exceptional because it is expensive and carries the parent conversation\'s authority.',
].join("\n");

const USAGE_EXAMPLE = [
  "Use exactly one top-level `calls` array:",
  "```json",
  "{",
  '  "calls": [',
  "    {",
  '      "agent": "agent-name",',
  '      "prompt": "Prompt sent verbatim to the subagent",',
  '      "model": "optional-model",',
  '      "initialContext": "empty",',
  '      "session": "optional-logical-handle"',
  "    }",
  "  ]",
  "}",
  "```",
].join("\n");

function formatCallFieldList() {
  return CALL_FIELDS.map((field) => {
    const requirement = field.required ? "required" : "optional";
    return `- \`${field.name}\` — ${requirement}: ${field.promptDescription}.`;
  }).join("\n");
}

function formatSessionPreference(preference) {
  switch (preference) {
    case "persistent":
      return "Prefer topic-specific named persistent sessions when context should carry across related calls.";
    case "ephemeral":
      return "Prefer ephemeral calls unless the caller explicitly needs continuation.";
    case "either":
      return "Choose ephemeral or persistent sessions based on the task.";
    default:
      return "";
  }
}

export function formatAgentForPrompt(agent) {
  const lines = [`- **${agent.name}** (${agent.source}): ${agent.description}`];
  if (agent.inactivityTimeout) {
    lines.push(`  Inactivity timeout default: ${agent.inactivityTimeout}s (child RPC stdout inactivity).`);
  }
  if (agent.sessionPreference) {
    lines.push(
      `  Session preference: ${agent.sessionPreference} — ${formatSessionPreference(agent.sessionPreference)}`,
    );
  }
  if (agent.sessionHint) {
    lines.push(`  Session hint: ${oneLine(agent.sessionHint)}`);
  }
  return lines.join("\n");
}

/** Rebuild `formatAvailableSubagentsPrompt()` from the package contract. */
export function formatAvailableSubagentsPrompt(agents, guards) {
  const agentList = agents.map((agent) => formatAgentForPrompt(agent)).join("\n");
  const stack = guards.ancestorAgentStack.length > 0 ? guards.ancestorAgentStack.join(" -> ") : "(root)";

  return `## Available Subagents

The following subagents are available via the \`subagent\` tool:

${agentList}

Agent source labels are informational. Project agents come from this repository and can override user agents with the same name.

### How to call the subagent tool

${USAGE_EXAMPLE}

Each call runs in an isolated \`pi\` process. Multiple calls may run concurrently.

Fields:
${formatCallFieldList()}

Rules:
${DELEGATION_RULES}

### Runtime delegation guards

- Max depth: current depth ${guards.currentDepth}, max depth ${guards.maxDepth}
- Cycle prevention: ${guards.preventCycles ? "enabled" : "disabled"}
- Current delegation stack: ${stack}
`;
}

function getUserAgentsDir(env) {
  const configDir = env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
  return path.join(configDir, "agents");
}

function findNearestProjectAgentsDir(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, CONFIG_DIR_NAME, "agents");
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function parseAgentFile(filePath, source) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const { data } = parseFrontmatter(text);
  if (!data.name || !data.description) return null;
  return {
    name: String(data.name),
    description: oneLine(data.description),
    source,
    filePath,
    model: data.model ? String(data.model) : undefined,
    tools: parseCsv(data.tools),
    inactivityTimeout: typeof data.inactivityTimeout === "number" ? data.inactivityTimeout : undefined,
    sessionPreference: data.sessionPreference ? String(data.sessionPreference) : undefined,
    sessionHint: data.sessionHint ? String(data.sessionHint) : undefined,
  };
}

function loadAgentsFromDir(dir, source) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const agents = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const agent = parseAgentFile(path.join(dir, entry.name), source);
    if (agent) agents.push(agent);
  }
  return agents;
}

function mergeAgents(...groups) {
  const map = new Map();
  for (const group of groups) for (const agent of group) map.set(agent.name, agent);
  return Array.from(map.values());
}

function parseNonNegativeInt(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseBool(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

export function readGuardSummary(env = process.env) {
  const stackRaw = env.PI_SUBAGENT_STACK?.trim();
  const ancestorAgentStack = stackRaw
    ? stackRaw.split(/[,>]/).map((s) => s.trim()).filter(Boolean)
    : [];
  return {
    currentDepth: parseNonNegativeInt(env.PI_SUBAGENT_DEPTH, ancestorAgentStack.length),
    maxDepth: parseNonNegativeInt(env.PI_SUBAGENT_MAX_DEPTH, DEFAULT_MAX_DELEGATION_DEPTH),
    preventCycles: parseBool(env.PI_SUBAGENT_PREVENT_CYCLES, DEFAULT_PREVENT_CYCLE_DELEGATION),
    ancestorAgentStack,
  };
}

/**
 * Discover agents exactly as the extension does (user dir, then nearest project
 * dir; project entries override user entries with the same name).
 */
export function discoverAgents({ cwd = process.cwd(), env = process.env, includeProject = true } = {}) {
  const userAgentsDir = getUserAgentsDir(env);
  const projectAgentsDir = includeProject ? findNearestProjectAgentsDir(cwd) : null;

  const userAgents = loadAgentsFromDir(userAgentsDir, "user");
  const projectAgents = projectAgentsDir ? loadAgentsFromDir(projectAgentsDir, "project") : [];
  const agents = mergeAgents(userAgents, projectAgents);

  return { agents, userAgentsDir, projectAgentsDir };
}

/** Render the request-time injected block, or null when nothing would be injected. */
export function renderSubagentBlock(options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const { agents, userAgentsDir, projectAgentsDir } = discoverAgents({ cwd, env });

  if (agents.length === 0) {
    return { text: null, agents: [], userAgentsDir, projectAgentsDir, guards: readGuardSummary(env) };
  }

  const guards = readGuardSummary(env);
  const text = formatAvailableSubagentsPrompt(agents, guards).replace(/^\n+/, "");

  return { text, agents, userAgentsDir, projectAgentsDir, guards };
}
