export const EFFORT_LEVELS = ["off", "default", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export interface AskRequest {
  /** The positional text: everything that is not a flag. */
  question: string;
  provider?: string;
  model?: string;
  effort?: EffortLevel;
  prompt?: string;
  timeoutSeconds?: number;
  setDefaultProvider?: string;
  setDefaultModel?: string;
  setDefaultEffort?: EffortLevel;
}

export type UsageSelection =
  | { kind: "last" }
  | { kind: "all" }
  | { kind: "session" }
  | { kind: "web-search" }
  | { kind: "run"; prefix: string };

export const ASK_HELP = `/ask "question" [--web-master-model ID] [--web-master-provider ID] [--web-master-effort LEVEL] [--web-master-prompt TEXT] [--web-master-timeout SECONDS]
/ask --set-default-web-master-provider ID | --set-default-web-master-model ID | --set-default-web-master-effort LEVEL
/ask --help

Looks the question up on the configured web route, then sends one provider request. No chat turn.

Prints this text and does not call a provider or write a file.

--web-master-model ID                  Model id, or provider/id. This run only. A bare id does not keep the saved provider.
--web-master-provider ID               deepseek, openai, or google. Needs --web-master-model.
--web-master-effort LEVEL              off, default, minimal, low, medium, high, xhigh, or max. This run only.
--web-master-prompt TEXT               Replaces the /ask system prompt for this run. Does not write prompts.json.
--web-master-timeout SECONDS           Seconds for one request. No default.
--set-default-web-master-provider ID   Save the provider in default-web-master-model.json. May be combined with --set-default-web-master-model.
--set-default-web-master-model ID      Save the model in default-web-master-model.json. May be combined with --set-default-web-master-provider.
--set-default-web-master-effort LEVEL  Save the effort in default-web-master-model.json. Use it alone.

A save does not ask. Do not combine save flags, except --set-default-web-master-provider with --set-default-web-master-model.`;

export const USAGE_HELP = `/usage
/usage --usage-totals | --this-session | --web-search | <run-id>
/usage --help

Prints this text and does not read the ledger.

--usage-totals   Totals per provider and model.
--this-session   This session only.
--web-search     Web searches per provider, with cost.
<run-id>         One run by id prefix.

With no selector, /usage shows the last run.`;

/** Splits on whitespace, honouring single and double quotes. */
export function tokenize(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === " " || char === "\t" || char === "\n") {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("Unclosed quote in arguments.");
  if (current) out.push(current);
  return out;
}

export function commandHelp(command: "ask" | "usage", input: string): string | undefined {
  if (!tokenize(input).includes("--help")) return undefined;
  return command === "ask" ? ASK_HELP : USAGE_HELP;
}

const CONFLICT =
  "Use only one of --set-default-web-master-effort, or --set-default-web-master-provider with --set-default-web-master-model. A save flag cannot be combined with a question or a run flag.";

export function parseAskArgs(input: string): AskRequest {
  const tokens = tokenize(input);
  const request: AskRequest = { question: "" };
  const words: string[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      words.push(token);
      continue;
    }
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${token}.`);
    index += 1;
    switch (token) {
      case "--web-master-provider":
        request.provider = value;
        break;
      case "--web-master-model":
        request.model = value;
        break;
      case "--web-master-effort":
        request.effort = effort(value);
        break;
      case "--web-master-prompt":
        request.prompt = promptText(value);
        break;
      case "--web-master-timeout":
        request.timeoutSeconds = seconds(value);
        break;
      case "--set-default-web-master-provider":
        request.setDefaultProvider = value;
        break;
      case "--set-default-web-master-model":
        request.setDefaultModel = value;
        break;
      case "--set-default-web-master-effort":
        request.setDefaultEffort = effort(value);
        break;
      default:
        throw new Error(`Unknown flag ${token}. Use --help.`);
    }
  }

  request.question = words.join(" ").trim();
  assertShape(request);
  return request;
}

export function parseUsageArgs(input: string): UsageSelection {
  const tokens = tokenize(input);
  if (tokens.length === 0) return { kind: "last" };
  if (tokens.length !== 1) {
    throw new Error("Use one of --usage-totals, --this-session, --web-search, or a run id. Use --help.");
  }
  switch (tokens[0]) {
    case "--usage-totals":
      return { kind: "all" };
    case "--this-session":
      return { kind: "session" };
    case "--web-search":
      return { kind: "web-search" };
    default:
      if (tokens[0].startsWith("--")) throw new Error(`Unknown flag ${tokens[0]}. Use --help.`);
      return { kind: "run", prefix: tokens[0] };
  }
}

export function hasStandingSave(request: AskRequest): boolean {
  return request.setDefaultProvider !== undefined || request.setDefaultModel !== undefined || request.setDefaultEffort !== undefined;
}

function assertShape(request: AskRequest): void {
  if (!hasStandingSave(request)) {
    if (!request.question) throw new Error('Missing question. Example: /ask "What is a vector database?"');
    return;
  }
  const paired = request.setDefaultProvider !== undefined || request.setDefaultModel !== undefined;
  const groups = [paired, request.setDefaultEffort !== undefined].filter(Boolean).length;
  const mixed =
    request.question !== "" ||
    request.model !== undefined ||
    request.provider !== undefined ||
    request.effort !== undefined ||
    request.prompt !== undefined ||
    request.timeoutSeconds !== undefined;
  if (groups > 1 || mixed) throw new Error(CONFLICT);
}

function effort(value: string): EffortLevel {
  const level = value as EffortLevel;
  if (!EFFORT_LEVELS.includes(level)) {
    throw new Error(`Unknown effort "${value}". Use ${EFFORT_LEVELS.join(", ")}.`);
  }
  return level;
}

function promptText(value: string): string {
  const text = value.trim();
  if (!text) throw new Error("--web-master-prompt needs text.");
  return text;
}

function seconds(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid timeout "${value}".`);
  return parsed;
}
