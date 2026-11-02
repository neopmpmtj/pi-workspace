// Pi extension. /describe-images and the describe_images tool are two ways in.
// Both call describeImages in src/describe.ts.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { commandHelp, DESCRIBE_HELP } from "../../src/args.ts";
import { writeSync } from "node:fs";
import { describeImages, failLines, parseCommandArgs, stdoutLines, type DescribeRequest } from "../../src/describe.ts";
import { recordCommandIfUnsaved, slashCommand } from "../../src/session-command.ts";

// Fields the agent may pass. The slash command does not use this object; it parses its own flags.
const toolParameters = Type.Object({
  dir: Type.Optional(Type.String({ description: "Parent directory for this run only. Includes files directly inside it, and images in an immediate subfolder with fewer than two files. A subfolder with two or more files is skipped. Omit to use the path in images-dir.json. Required only when that file is missing, unless a save field is set." })),
  model: Type.Optional(Type.String({ description: "Model id for this run. Overrides the saved default. Default deepseek-flash when no default is saved. Also gpt-6.1-sol or gemini-3.8-flash." })),
  effort: Type.Optional(
    Type.String({ description: "default, none, minimal, low, medium, high, xhigh, or max. When omitted, general, leisure, work, financial, and venue use the saved preset effort if preset-effort.json exists; otherwise deepseek-flash sends none (thinking off) and other models omit the override. detailed uses its own saved level, medium until its settings dropdown changes it. count does the same with count-effort.json. Deepseek sends medium as high. An explicit effort overrides the saved level for one run. A custom prompt ignores every saved level." }),
  ),
  prompt: Type.Optional(Type.String({ description: "Replacement instruction used for every image in the run." })),
  mode: Type.Optional(
    Type.String({ description: "Preset for this run: general, leisure, work, financial, venue, detailed, or count. detailed is an exhaustive description and uses its saved effort (medium by default) unless effort is set. count singles out each recurring shape and gives its count, and uses its own saved effort (medium by default) unless effort is set. The other presets share one saved effort when preset-effort.json exists. Overrides the saved default and does not change it. Ignored when prompt is set." }),
  ),
  setDefaultImageDescriberMode: Type.Optional(
    Type.String({ description: "Save this mode as the default for later runs. Exactly one mode stays on. Does not describe images. Do not combine with setDefaultImageDescriberPreset, setDefaultImageDescriberDetailed, setDefaultImageDescriberCount, setDefaultImageDescriberProvider, setDefaultImageDescriberModel, setDefaultImageDescriberLanguage, or setDefaultImageDescriberImagesDir." }),
  ),
  setDefaultImageDescriberPreset: Type.Optional(
    Type.String({ description: "Save the shared effort for general, leisure, work, financial, and venue. Allowed only when the saved default is one of those modes. Does not describe images. none, minimal, low, medium, high, xhigh, or max." }),
  ),
  setDefaultImageDescriberDetailed: Type.Optional(
    Type.String({ description: "Save the detailed-mode effort. Allowed only when the saved default mode is already detailed. Does not describe images. none, minimal, low, medium, high, xhigh, or max." }),
  ),
  setDefaultImageDescriberCount: Type.Optional(
    Type.String({ description: "Save the count-mode effort. Allowed only when the saved default mode is already count. Does not describe images. none, minimal, low, medium, high, xhigh, or max." }),
  ),
  setDefaultImageDescriberProvider: Type.Optional(
    Type.String({ description: "Save the default vision provider and its model. deepseek, openai, or gemini. Does not describe images. May be combined with setDefaultImageDescriberModel when that model belongs to the provider. Do not combine with setDefaultImageDescriberMode, setDefaultImageDescriberPreset, setDefaultImageDescriberDetailed, setDefaultImageDescriberCount, setDefaultImageDescriberLanguage, or setDefaultImageDescriberImagesDir." }),
  ),
  setDefaultImageDescriberModel: Type.Optional(
    Type.String({ description: "Save the default vision model and the provider that owns it. deepseek-flash, gpt-6.1-sol, or gemini-3.8-flash. Does not describe images. May be combined with setDefaultImageDescriberProvider when the model belongs to that provider. Do not combine with setDefaultImageDescriberMode, setDefaultImageDescriberPreset, setDefaultImageDescriberDetailed, setDefaultImageDescriberCount, setDefaultImageDescriberLanguage, or setDefaultImageDescriberImagesDir." }),
  ),
  setDefaultImageDescriberLanguage: Type.Optional(
    Type.String({ description: "Save this language name as the default for later runs that omit language. Does not describe images. A missing save still uses English. language on a describe run overrides the save for that run and does not write it. Do not combine with setDefaultImageDescriberMode, setDefaultImageDescriberPreset, setDefaultImageDescriberDetailed, setDefaultImageDescriberCount, setDefaultImageDescriberProvider, setDefaultImageDescriberModel, or setDefaultImageDescriberImagesDir." }),
  ),
  setDefaultImageDescriberImagesDir: Type.Optional(
    Type.String({ description: "Save this directory as the standing inbox in images-dir.json. Does not describe images. Later runs that omit dir use this path. Relative paths resolve from the session working directory and are stored absolute. The path must already exist and be a directory. Do not combine with setDefaultImageDescriberMode, setDefaultImageDescriberPreset, setDefaultImageDescriberDetailed, setDefaultImageDescriberCount, setDefaultImageDescriberProvider, setDefaultImageDescriberModel, or setDefaultImageDescriberLanguage." }),
  ),
  language: Type.Optional(Type.String({ description: "Language name for this run. Overrides the saved default and does not change it. Default English when no default is saved. Ignored when prompt is set." })),
  timeout: Type.Optional(Type.Number({ description: "Seconds per image request. Default 120." })),
  log: Type.Optional(Type.String({ description: "Metrics database path. Default ./logs/metrics.sqlite under the working directory." })),
});

// Help text per slash command, read by scripts/publish.ts.
export const HELP: Record<string, string> = { "describe-images": DESCRIBE_HELP };

export default function (pi: ExtensionAPI) {
  // /describe-images receives the flag text, turns it into a request, and posts the
  // descriptions into the session. A new TUI session is saved only after a user message,
  // so the command line is recorded first when the file is not on disk yet.
  // triggerTurn: false means the chat model is not asked to answer. A problem is shown as a
  // notice, posted in the session, and printed as [FAIL] so print mode is not empty.
  pi.registerCommand("describe-images", {
    description: "Describe images in a directory and in immediate subfolders with fewer than two files",
    handler: async (args, ctx) => {
      try {
        const help = commandHelp(args);
        if (help !== undefined) {
          console.log(help);
          recordCommandIfUnsaved(ctx.sessionManager, slashCommand(args));
          pi.sendMessage(
            {
              customType: "describe-images",
              content: help,
              display: true,
            },
            { triggerTurn: false },
          );
          return;
        }
        const request = parseCommandArgs(args, ctx.cwd);
        const sessionId = ctx.sessionManager.getSessionId();
        if (sessionId.trim()) request.sessionId = sessionId.trim();
        const result = await describeImages(request, { signal: ctx.signal });
        if (result.notice) ctx.ui.notify(result.notice, "warning");
        for (const line of failLines(result)) console.error(line);
        if (!ctx.hasUI) toStdout(stdoutLines(result).join("\n"));
        recordCommandIfUnsaved(ctx.sessionManager, slashCommand(args));
        pi.sendMessage(
          {
            customType: "describe-images",
            content: result.text,
            display: true,
            details: {
            runId: result.record.runId,
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          },
          },
          { triggerTurn: false },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "describe-images failed.";
        ctx.ui.notify(message, "error");
        console.error(`[FAIL] ${message}`);
        pi.sendMessage(
          {
            customType: "describe-images",
            content: message,
            display: true,
          },
          { triggerTurn: false },
        );
      }
    },
  });

  // describe_images takes the same fields as a tool call and returns the same text to the
  // agent, plus a short run summary. sequential means one call finishes before another starts.
  pi.registerTool({
    name: "describe_images",
    label: "Describe images",
    description:
      "Describe eligible images in a directory and in immediate subfolders that contain fewer than two files, one request per file, oldest first. Skips a subfolder that already has two or more files, and skips a file whose description is already beside it. Returns filename-labelled descriptions. Does not describe images already attached to the conversation.",
    promptGuidelines: [
      "Use describe_images when the user asks about a directory of images or a batch of image files on disk.",
      "Do not read those image files yourself. A single image the user already attached can still be read with the read tool.",
      "Omit dir to use the standing inbox in images-dir.json. Pass dir only when the user names another folder for this run. Optional model, effort, prompt, mode, language, timeout, and log match /describe-images. Omit language to use the saved default, which is English until setDefaultImageDescriberLanguage changes it.",
      "Pass mode leisure for personal photographs and diary entries, work for notices and workplace images, financial for invoices and receipts, venue for a calendar entry with title, location, and date or time, detailed for an exhaustive description, or count to single out each recurring shape and give its count. detailed and count each use their saved effort, medium unless changed in settings, unless effort is given. The other modes share the saved preset effort when that level has been saved; otherwise deepseek-flash keeps thinking off. Deepseek sends medium as high. Omit mode to use the saved default.",
      "Pass setDefaultImageDescriberMode only when the user asks to change the standing default mode. That turns the chosen mode on and the others off for later runs.",
      "Pass setDefaultImageDescriberProvider only when the user asks to save the default vision provider. Pass setDefaultImageDescriberModel only when the user asks to save the default vision model. Those two may be passed together when the model belongs to that provider. Do not combine them with setDefaultImageDescriberMode, setDefaultImageDescriberPreset, setDefaultImageDescriberDetailed, setDefaultImageDescriberCount, setDefaultImageDescriberLanguage, or setDefaultImageDescriberImagesDir. A missing save still uses deepseek-flash. model on a describe run overrides the save for that run and does not write it.",
      "Pass setDefaultImageDescriberLanguage only when the user asks to save the default language. A missing save still uses English. language on a describe run overrides the save for that run and does not write it. Do not combine it with setDefaultImageDescriberMode, setDefaultImageDescriberPreset, setDefaultImageDescriberDetailed, setDefaultImageDescriberCount, setDefaultImageDescriberProvider, setDefaultImageDescriberModel, or setDefaultImageDescriberImagesDir. An empty, multiline, or overlong name is an error and does not write the file.",
      "Pass setDefaultImageDescriberImagesDir only when the user asks to change the standing images inbox. That writes images-dir.json. Do not combine it with setDefaultImageDescriberMode, setDefaultImageDescriberPreset, setDefaultImageDescriberDetailed, setDefaultImageDescriberCount, setDefaultImageDescriberProvider, setDefaultImageDescriberModel, or setDefaultImageDescriberLanguage. The path must exist and be a directory.",
      "Pass setDefaultImageDescriberPreset only when the user asks to save the shared effort for general, leisure, work, financial, and venue, and only when the saved default is one of those. Pass setDefaultImageDescriberDetailed only when the user asks to save the detailed effort, and only when the saved default is already detailed. Pass setDefaultImageDescriberCount only when the user asks to save the count effort, and only when the saved default is already count. Levels are none, minimal, low, medium, high, xhigh, or max. Do not combine those fields with setDefaultImageDescriberMode, setDefaultImageDescriberLanguage, setDefaultImageDescriberImagesDir, or with each other. If the tool returns an unknown mode or effort, report that error. effort still changes one run only.",
    ],
    parameters: toolParameters,
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      try {
        const request = requestFromTool(params, ctx.cwd);
        const sessionId = ctx.sessionManager.getSessionId().trim();
        if (sessionId) request.sessionId = sessionId;
        const result = await describeImages(request, { signal });
        return {
          content: [{ type: "text" as const, text: result.text }],
          details: {
            runId: result.record.runId,
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
            status: result.record.status,
            succeeded: result.record.succeeded,
            failed: result.record.failed,
            unprocessed: result.record.unprocessed,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "describe_images failed.";
        return {
          content: [{ type: "text" as const, text: message }],
          details: { error: message },
          isError: true,
        };
      }
    },
  });
}

// Copies the tool fields and adds the session folder as cwd.
// The slash-command path gets that folder from ctx.cwd instead.
function requestFromTool(
  params: {
    dir?: string;
    model?: string;
    setDefaultImageDescriberMode?: string;
    setDefaultImageDescriberPreset?: string;
    setDefaultImageDescriberDetailed?: string;
    setDefaultImageDescriberCount?: string;
    setDefaultImageDescriberProvider?: string;
    setDefaultImageDescriberModel?: string;
    setDefaultImageDescriberLanguage?: string;
    setDefaultImageDescriberImagesDir?: string;
    effort?: string;
    prompt?: string;
    mode?: string;
    language?: string;
    timeout?: number;
    log?: string;
  },
  cwd: string,
): DescribeRequest {
  return {
    dir: params.dir ?? "",
    cwd,
    model: params.model,
    setDefaultImageDescriberMode: params.setDefaultImageDescriberMode,
    setDefaultImageDescriberPreset: params.setDefaultImageDescriberPreset,
    setDefaultImageDescriberDetailed: params.setDefaultImageDescriberDetailed,
    setDefaultImageDescriberCount: params.setDefaultImageDescriberCount,
    setDefaultImageDescriberProvider: params.setDefaultImageDescriberProvider,
    setDefaultImageDescriberModel: params.setDefaultImageDescriberModel,
    setDefaultImageDescriberLanguage: params.setDefaultImageDescriberLanguage,
    setDefaultImageDescriberImagesDir: params.setDefaultImageDescriberImagesDir,
    effort: params.effort,
    prompt: params.prompt,
    mode: params.mode,
    language: params.language,
    timeout: params.timeout,
    log: params.log,
  };
}

// Pi patches console to write to stderr in print mode, so stdout is written to fd 1 directly.
function toStdout(text: string): void {
  writeSync(1, `${text}\n`);
}
