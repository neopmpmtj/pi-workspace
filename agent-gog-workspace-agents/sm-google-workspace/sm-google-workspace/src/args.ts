export const EFFORT_LEVELS = ["off", "default", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export interface AskRequest {
  /** The positional text: everything that is not a flag. */
  question: string;
  provider?: string;
  model?: string;
  effort?: EffortLevel;
  timeoutSeconds?: number;
  setDefaultProvider?: string;
  setDefaultModel?: string;
  setDefaultEffort?: EffortLevel;
}

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

export const ASK_HELP = `/ask "question" [--provider ID] [--model ID] [--effort LEVEL] [--timeout SECONDS]
/ask --set-default-provider ID | --set-default-model ID | --set-default-effort LEVEL
/ask --help

Prints this text and does not send a request or write default-model.json.

--provider ID                  deepseek, openai, or google.
--model ID                     Model id, or provider/id.
--effort LEVEL                 off, default, minimal, low, medium, high, xhigh, or max.
--timeout SECONDS              Seconds before the request is aborted.
--set-default-provider ID      Save the default provider. No request. May be combined with --set-default-model.
--set-default-model ID         Save the default model. No request. May be combined with --set-default-provider.
--set-default-effort LEVEL     Save the default effort. No request. Use it alone.

A save cannot be combined with a question or a run flag.`;

export function askHelp(input: string): string | undefined {
  if (!tokenize(input).includes("--help")) return undefined;
  return ASK_HELP;
}

const CONFLICT =
  "Use only one of --set-default-provider and --set-default-model (together is allowed), or --set-default-effort alone. A save flag cannot be combined with a question, --model, --provider, --effort, or --timeout.";

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
    if (value === undefined) throw new Error(`Missing value for ${token}.`);
    index += 1;
    switch (token) {
      case "--provider":
        request.provider = value;
        break;
      case "--model":
        request.model = value;
        break;
      case "--effort":
        request.effort = effort(value);
        break;
      case "--timeout":
        request.timeoutSeconds = seconds(value);
        break;
      case "--set-default-provider":
        request.setDefaultProvider = value;
        break;
      case "--set-default-model":
        request.setDefaultModel = value;
        break;
      case "--set-default-effort":
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

export function hasStandingSave(request: AskRequest): boolean {
  return (
    request.setDefaultProvider !== undefined ||
    request.setDefaultModel !== undefined ||
    request.setDefaultEffort !== undefined
  );
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

function seconds(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid timeout "${value}".`);
  return parsed;
}
