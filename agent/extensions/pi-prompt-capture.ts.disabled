/**
 * pi-prompt-capture — capture the system prompt for pi-prompt-dump.
 *
 * TWO HOOKS, TWO DIFFERENT THINGS
 * ------------------------------
 * pi's extension load order is fixed (verified in the loader source):
 *
 *   1. project-local   <cwd>/.pi/extensions/
 *   2. global          <agent-dir>/extensions/     <-- THIS extension lives here
 *   3. configured paths (settings extensions / npm packages)  <-- pi-agent-browser-native, pi-subagent
 *
 * A global-dir extension therefore ALWAYS runs before package extensions in
 * `before_agent_start`, so it can never observe their appends. A capture taken
 * there is the BASE prompt: real, useful, but missing every
 * extension-injected section. It is recorded and labelled as such, and is
 * valuable precisely because it independently verifies pi's core sections.
 *
 * `before_provider_request` fires after the whole request payload is assembled,
 * so the prompt it contains is the authoritative final text — extension
 * appends included. That is the capture used for exact verification.
 *
 * The provider payload shape differs per provider, so extraction is defensive:
 * on failure the record stores the payload's top-level keys for diagnosis
 * instead of writing a plausible-looking wrong value.
 *
 * This extension never mutates anything and always returns undefined.
 *
 * Installation: symlink into <agent-dir>/extensions/, then run /reload.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SCHEMA_VERSION = 1;

const MARKERS = [
  "## Available Subagents",
  "<agent_browser>",
  "<project_context>",
  "<addendum>",
  "<skills>",
];

function captureDir() {
  const explicit = process.env.PI_PROMPT_CAPTURE_DIR?.trim();
  if (explicit) return explicit;
  const configDir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
  return path.join(configDir, "state", "prompt-capture");
}

/** Flatten a provider-shaped text container into a single string. */
function collectText(value, out) {
  if (typeof value === "string") {
    if (value.length > 0) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
    return;
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") {
      out.push(value.text);
      return;
    }
    if (typeof value.content === "string") {
      out.push(value.content);
      return;
    }
    if (value.content !== undefined) {
      collectText(value.content, out);
      return;
    }
    if (value.parts !== undefined) collectText(value.parts, out);
  }
}

/**
 * Locate the leading system prompt in a provider request payload.
 * Returns { text, path } or null. `path` names the shape that matched so a
 * successful extraction is auditable rather than assumed.
 */
function extractSystemPrompt(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload;

  const attempt = (source, container, label) => {
    const out = [];
    collectText(container, out);
    const text = out.join("\n\n");
    return text ? { text, path: label ?? source } : null;
  };

  // Anthropic Messages: { system: string | TextBlock[] }
  if (p.system !== undefined) {
    const hit = attempt("system", p.system, "payload.system");
    if (hit) return hit;
  }

  // OpenAI Responses API: { instructions: string }
  if (typeof p.instructions === "string" && p.instructions.length > 0) {
    return { text: p.instructions, path: "payload.instructions" };
  }

  // Google Generative AI / Vertex: { systemInstruction | system_instruction }
  for (const key of ["systemInstruction", "system_instruction"]) {
    if (p[key] !== undefined) {
      const hit = attempt(key, p[key], `payload.${key}`);
      if (hit) return hit;
    }
  }

  // OpenAI-compatible chat completions: { messages: [{ role: "system", ... }] }
  if (Array.isArray(p.messages)) {
    for (const role of ["system", "developer"]) {
      for (const message of p.messages) {
        if (message && message.role === role) {
          const hit = attempt(role, message.content, `payload.messages[role=${role}]`);
          if (hit) return hit;
        }
      }
    }
  }

  // Bedrock Converse: { system: [{ text }] } is handled above; this covers
  // shapes that nest under a `system` array of objects without a text field.
  return null;
}

function safeCall(fn, fallback = null) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function sessionIdentity(ctx) {
  const manager = ctx?.sessionManager;
  const id = safeCall(() => manager?.getSessionId?.(), null) || process.env.PI_SESSION_ID?.trim() || null;
  const file = safeCall(() => manager?.getSessionFile?.(), null) || process.env.PI_SESSION_FILE || null;
  const cwd = safeCall(() => manager?.getCwd?.(), null) || ctx?.cwd || process.cwd();
  return { id: id || "unknown", file, cwd };
}

export default function (pi) {
  // In-memory per-session accumulator. Both hooks contribute; each write
  // persists the merged record so nothing is lost between them.
  const state = new Map();

  const write = (identity, patch) => {
    const key = identity.id;
    const previous = state.get(key) ?? { captures: {} };
    const next = {
      ...previous,
      ...patch,
      sessionId: identity.id,
      sessionFile: identity.file,
      cwd: identity.cwd,
      updatedAt: new Date().toISOString(),
      captures: { ...previous.captures, ...(patch.captures ?? {}) },
    };

    // Prefer the authoritative provider-request capture, then the base capture.
    const final = next.captures.before_provider_request;
    const base = next.captures.before_agent_start;
    const chosen = final ?? base;

    if (chosen) {
      next.systemPrompt = chosen.text;
      next.captureSource = final ? "before_provider_request" : "before_agent_start";
      next.complete = Boolean(final);
      next.length = chosen.text.length;
      const markers = {};
      for (const marker of MARKERS) markers[marker] = chosen.text.includes(marker);
      next.markers = markers;
    }

    state.set(key, next);

    const dir = captureDir();
    fs.mkdirSync(dir, { recursive: true });

    // Strip the bulky prompt text from the capture records before persisting;
    // it is re-attached at the top level as `systemPrompt`.
    const persist = JSON.parse(JSON.stringify(next, (k, v) => (k === "text" ? undefined : v)));
    const payload = JSON.stringify(persist, null, 2);

    const targets = [path.join(dir, `${key}.json`), path.join(dir, "latest.json")];
    for (const target of targets) {
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, payload, "utf8");
      fs.renameSync(tmp, target);
    }
  };

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const text = event?.systemPrompt;
      if (typeof text !== "string" || text.length === 0) return undefined;
      write(sessionIdentity(ctx), {
        captures: {
          before_agent_start: {
            capturedAt: new Date().toISOString(),
            length: text.length,
            note: "BASE prompt: taken before package extensions append their sections.",
            text,
          },
        },
      });
    } catch {
      // best-effort only
    }
    return undefined;
  });

  pi.on("before_provider_request", async (event, ctx) => {
    try {
      const payload = event?.payload;
      const identity = sessionIdentity(ctx);
      const hit = extractSystemPrompt(payload);

      if (!hit) {
        write(identity, {
          captures: {
            before_provider_request: {
              capturedAt: new Date().toISOString(),
              extractionFailed: true,
              payloadKeys:
                payload && typeof payload === "object" && !Array.isArray(payload)
                  ? Object.keys(payload).slice(0, 40)
                  : null,
              payloadType: Array.isArray(payload) ? "array" : typeof payload,
            },
          },
        });
        return undefined;
      }

      write(identity, {
        captures: {
          before_provider_request: {
            capturedAt: new Date().toISOString(),
            length: hit.text.length,
            extractedFrom: hit.path,
            note: "AUTHORITATIVE final prompt, after all before_agent_start handlers.",
            text: hit.text,
          },
        },
      });
    } catch {
      // best-effort only
    }
    return undefined;
  });
}
