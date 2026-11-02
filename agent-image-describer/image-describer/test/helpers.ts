import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

export async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "image-describer-"));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function writePng(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 40, b: 60 } },
  })
    .png()
    .toFile(filePath);
}

export async function writeBytes(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

export function chatResponse(content: string, usage?: Record<string, unknown> | null, model = "deepseek-flash"): Response {
  const body: Record<string, unknown> = {
    model,
    choices: [{ message: { role: "assistant", content } }],
  };
  if (usage !== null) {
    body.usage = usage ?? {
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
      completion_tokens_details: { reasoning_tokens: 3 },
      prompt_tokens_details: { cached_tokens: 2 },
    };
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function errorResponse(status: number, error: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
}
