export interface DescribeRequest {
  dir: string;
  cwd: string;
  model?: string;
  effort?: string;
  prompt?: string;
  mode?: string;
  setDefaultImageDescriberMode?: string;
  setDefaultImageDescriberPreset?: string;
  setDefaultImageDescriberDetailed?: string;
  setDefaultImageDescriberCount?: string;
  setDefaultImageDescriberProvider?: string;
  setDefaultImageDescriberModel?: string;
  setDefaultImageDescriberLanguage?: string;
  setDefaultImageDescriberImagesDir?: string;
  language?: string;
  timeout?: number;
  log?: string;
  sessionId?: string;
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

export const DESCRIBE_HELP = `/describe-images [--dir PATH] [--mode MODE] [--effort LEVEL] [--model ID] [--prompt TEXT] [--language NAME] [--timeout SECONDS] [--log PATH]
/describe-images --set-default-image-describer-mode MODE | --set-default-image-describer-preset LEVEL | --set-default-image-describer-detailed LEVEL | --set-default-image-describer-count LEVEL | --set-default-image-describer-provider ID | --set-default-image-describer-model ID | --set-default-image-describer-language NAME | --set-default-image-describer-images-dir PATH
/describe-images --help

Prints this text and does not describe images or write settings. Omit --dir to use images-dir.json.

--dir PATH                                     This run only. Omit to use images-dir.json.
--mode MODE                                    general, leisure, work, financial, venue, detailed, or count. This run only.
--effort LEVEL                                 default, none, minimal, low, medium, high, xhigh, or max. This run only.
--model ID                                     deepseek-flash, gpt-6.1-sol, or gemini-3.8-flash. This run only.
--prompt TEXT                                  Replace the instruction for every image. Ignores --mode.
--language NAME                                Language for this run. Ignored when --prompt is set.
--timeout SECONDS                              Seconds per image. Default 120.
--log PATH                                     Metrics database. Default ./logs/metrics.sqlite.
--set-default-image-describer-mode MODE        Save the default mode. Does not describe images.
--set-default-image-describer-preset LEVEL     Save the shared effort for general, leisure, work, financial, and venue.
--set-default-image-describer-detailed LEVEL   Save the detailed effort. Only when the default mode is detailed.
--set-default-image-describer-count LEVEL      Save the count effort. Only when the default mode is count.
--set-default-image-describer-provider ID      Save the vision provider: deepseek, openai, or gemini.
--set-default-image-describer-model ID         Save the vision model. May be combined with --set-default-image-describer-provider.
--set-default-image-describer-language NAME    Save the default language.
--set-default-image-describer-images-dir PATH  Save the standing inbox. The path must already be a directory.

A save does not describe images. Do not combine save flags, except --set-default-image-describer-provider with --set-default-image-describer-model.`;

export function commandHelp(input: string): string | undefined {
  if (!tokenize(input).includes("--help")) return undefined;
  return DESCRIBE_HELP;
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
      case "--mode":
        request.mode = value;
        break;
      case "--set-default-image-describer-mode":
        request.setDefaultImageDescriberMode = value;
        break;
      case "--set-default-image-describer-preset":
        request.setDefaultImageDescriberPreset = value;
        break;
      case "--set-default-image-describer-detailed":
        request.setDefaultImageDescriberDetailed = value;
        break;
      case "--set-default-image-describer-count":
        request.setDefaultImageDescriberCount = value;
        break;
      case "--set-default-image-describer-provider":
        request.setDefaultImageDescriberProvider = value;
        break;
      case "--set-default-image-describer-model":
        request.setDefaultImageDescriberModel = value;
        break;
      case "--set-default-image-describer-language":
        request.setDefaultImageDescriberLanguage = value;
        break;
      case "--set-default-image-describer-images-dir":
        request.setDefaultImageDescriberImagesDir = value;
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
        throw new Error(`Unknown flag ${token}. Use --help.`);
    }
  }
  assertSingleStandingSave(request);
  return request;
}

const STANDING_SAVE_CONFLICT =
  "Use only one of --set-default-image-describer-mode, --set-default-image-describer-preset, --set-default-image-describer-detailed, --set-default-image-describer-count, --set-default-image-describer-language, and --set-default-image-describer-images-dir. --set-default-image-describer-provider and --set-default-image-describer-model may be used together, and not with those saves.";

type StandingSave = Pick<
  DescribeRequest,
  | "setDefaultImageDescriberMode"
  | "setDefaultImageDescriberPreset"
  | "setDefaultImageDescriberDetailed"
  | "setDefaultImageDescriberCount"
  | "setDefaultImageDescriberProvider"
  | "setDefaultImageDescriberModel"
  | "setDefaultImageDescriberLanguage"
  | "setDefaultImageDescriberImagesDir"
>;

export function assertSingleStandingSave(request: StandingSave): void {
  const modeSaves = [request.setDefaultImageDescriberMode, request.setDefaultImageDescriberPreset, request.setDefaultImageDescriberDetailed, request.setDefaultImageDescriberCount].filter(
    (value) => value !== undefined,
  );
  const providerSaves = [request.setDefaultImageDescriberProvider, request.setDefaultImageDescriberModel].filter((value) => value !== undefined);
  const groups = [
    modeSaves.length > 0,
    providerSaves.length > 0,
    request.setDefaultImageDescriberLanguage !== undefined,
    request.setDefaultImageDescriberImagesDir !== undefined,
  ].filter(Boolean);
  if (modeSaves.length > 1 || groups.length > 1) {
    throw new Error(STANDING_SAVE_CONFLICT);
  }
}

