import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { describeImages, parseCommandArgs, type DescribeRequest } from "../../src/describe.ts";

const toolParameters = Type.Object({
  dir: Type.String({ description: "Directory of images. Only files directly inside it are included." }),
  model: Type.Optional(Type.String({ description: "Model id. Default deepseek-flash. Also gpt-5.4 or gemini-3.8-flash." })),
  effort: Type.Optional(
    Type.String({ description: "default, none, minimal, low, medium, high, xhigh, or max. Default omits the override." }),
  ),
  prompt: Type.Optional(Type.String({ description: "Replacement instruction used for every image in the run." })),
  language: Type.Optional(Type.String({ description: "Language name for the default instruction. Default English." })),
  timeout: Type.Optional(Type.Number({ description: "Seconds per image request. Default 120." })),
  log: Type.Optional(Type.String({ description: "JSONL run ledger path. Default ./logs/image-runs.jsonl under the working directory." })),
});

export default function (pi: ExtensionAPI) {
  pi.registerCommand("describe-images", {
    description: "Describe each image directly inside a directory",
    handler: async (args, ctx) => {
      try {
        const result = await describeImages(parseCommandArgs(args, ctx.cwd), { signal: ctx.signal });
        if (result.notice) ctx.ui.notify(result.notice, "warning");
        pi.sendMessage(
          {
            customType: "describe-images",
            content: result.text,
            display: true,
          },
          { triggerTurn: false },
        );
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "describe-images failed.", "error");
      }
    },
  });

  pi.registerTool({
    name: "describe_images",
    label: "Describe images",
    description:
      "Describe every eligible image directly inside a directory, one request per file, oldest first. Returns filename-labelled descriptions. Does not describe images already attached to the conversation.",
    promptGuidelines: [
      "Use describe_images when the user asks about a directory of images or a batch of image files on disk.",
      "Do not read those image files yourself. A single image the user already attached can still be read with the read tool.",
      "Pass dir as the directory path. Optional model, effort, prompt, language, timeout, and log match /describe-images.",
    ],
    parameters: toolParameters,
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      try {
        const result = await describeImages(requestFromTool(params, ctx.cwd), { signal });
        return {
          content: [{ type: "text" as const, text: result.text }],
          details: {
            runId: result.record.runId,
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

function requestFromTool(
  params: {
    dir: string;
    model?: string;
    effort?: string;
    prompt?: string;
    language?: string;
    timeout?: number;
    log?: string;
  },
  cwd: string,
): DescribeRequest {
  return {
    dir: params.dir,
    cwd,
    model: params.model,
    effort: params.effort,
    prompt: params.prompt,
    language: params.language,
    timeout: params.timeout,
    log: params.log,
  };
}
