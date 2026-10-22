export interface DescribeRequest {
  dir: string;
  cwd: string;
  model?: string;
  effort?: string;
  prompt?: string;
  language?: string;
  timeout?: number;
  log?: string;
}

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

export function parseCommandArgs(input: string, cwd: string): DescribeRequest {
  const tokens = tokenize(input);
  const request: DescribeRequest = { dir: "", cwd };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument "${token}".`);
    const value = tokens[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${token}.`);
    i += 1;
    switch (token) {
      case "--dir":
        request.dir = value;
        break;
      case "--model":
        request.model = value;
        break;
      case "--effort":
        request.effort = value;
        break;
      case "--prompt":
        request.prompt = value;
        break;
      case "--language":
        request.language = value;
        break;
      case "--timeout":
        request.timeout = Number(value);
        if (!Number.isFinite(request.timeout)) throw new Error(`Invalid timeout "${value}".`);
        break;
      case "--log":
        request.log = value;
        break;
      default:
        throw new Error(`Unknown flag ${token}.`);
    }
  }
  if (!request.dir) throw new Error("Missing required flag --dir.");
  return request;
}
