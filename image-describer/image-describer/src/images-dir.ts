import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentDir } from "./env.ts";

export const IMAGES_DIR_LIMIT_MESSAGE = "Images directory must be a single line of at most 4096 characters.";
export const IMAGES_DIR_MISSING_MESSAGE =
  "No images directory configured. Pass --dir or --set-default-image-describer-images-dir.";

export function imagesDirPath(env: NodeJS.ProcessEnv): string {
  return path.join(agentDir(env), "images-dir.json");
}

export async function readImagesDir(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(imagesDirPath(env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return parseImagesDir(text);
}

export async function writeImagesDir(env: NodeJS.ProcessEnv, value: string, cwd: string): Promise<string> {
  const absolute = await checkedImagesDir(value, cwd);
  await mkdir(agentDir(env), { recursive: true });
  await writeFile(imagesDirPath(env), `${JSON.stringify({ dir: absolute }, null, 2)}\n`, "utf8");
  return absolute;
}

export async function checkedImagesDir(value: string, cwd: string): Promise<string> {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096 || /[\r\n]/.test(trimmed)) {
    throw new Error(IMAGES_DIR_LIMIT_MESSAGE);
  }
  const absolute = path.resolve(cwd, trimmed);
  let fileStat;
  try {
    fileStat = await stat(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Images directory not found: ${absolute}`);
    }
    throw error;
  }
  if (!fileStat.isDirectory()) {
    throw new Error(`Not a directory: ${absolute}`);
  }
  return absolute;
}

function parseImagesDir(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("images-dir.json is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("images-dir.json must be an object with a dir string.");
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "dir" || typeof record.dir !== "string") {
    throw new Error("images-dir.json must be an object with a dir string.");
  }
  const dir = record.dir.trim();
  if (!dir || dir.length > 4096 || /[\r\n]/.test(dir)) {
    throw new Error(IMAGES_DIR_LIMIT_MESSAGE);
  }
  return dir;
}
