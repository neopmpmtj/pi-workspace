import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";

const EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".tif",
  ".tiff",
  ".bmp",
  ".heic",
  ".heif",
]);

export interface ImageStamp {
  filename: string;
  takenMs: number | null;
  birthMs: number | null;
  mtimeMs: number;
}

export interface DiscoveredImage extends ImageStamp {
  path: string;
  bytes: number;
  timeSource: "exif" | "birth" | "mtime";
}

export function isEligibleName(filename: string): boolean {
  return EXTENSIONS.has(path.extname(filename).toLowerCase());
}

/** EXIF dates have no timezone. exifr reads them as local time, and every file in a run uses that rule. */
export async function readTakenMs(filePath: string): Promise<number | null> {
  try {
    const data = (await exifr.parse(filePath, {
      pick: ["DateTimeOriginal", "CreateDate", "DateTime"],
    })) as { DateTimeOriginal?: unknown; CreateDate?: unknown; DateTime?: unknown } | undefined;
    const value = data?.DateTimeOriginal ?? data?.CreateDate ?? data?.DateTime;
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
    return null;
  } catch {
    return null;
  }
}

export function orderKey(image: ImageStamp): { time: number; source: "exif" | "birth" | "mtime" } {
  if (image.takenMs != null && Number.isFinite(image.takenMs)) {
    return { time: image.takenMs, source: "exif" };
  }
  if (image.birthMs != null && Number.isFinite(image.birthMs) && image.birthMs > 0) {
    return { time: image.birthMs, source: "birth" };
  }
  return { time: image.mtimeMs, source: "mtime" };
}

export function compareImages(a: ImageStamp, b: ImageStamp): number {
  const left = orderKey(a);
  const right = orderKey(b);
  if (left.time !== right.time) return left.time - right.time;
  return a.filename.localeCompare(b.filename, "en");
}

export async function discoverImages(
  dir: string,
  readExif: (filePath: string) => Promise<number | null> = readTakenMs,
): Promise<DiscoveredImage[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`Directory not found: ${dir}`);
    if (code === "ENOTDIR") throw new Error(`Not a directory: ${dir}`);
    throw error;
  }
  const found: DiscoveredImage[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    let fileStat;
    try {
      fileStat = await stat(full);
    } catch {
      continue;
    }
    if (!fileStat.isFile()) continue;
    if (!isEligibleName(entry.name)) continue;
    const takenMs = await readExif(full);
    const birthMs = fileStat.birthtimeMs > 0 ? fileStat.birthtimeMs : null;
    const image: DiscoveredImage = {
      filename: entry.name,
      path: full,
      bytes: fileStat.size,
      takenMs,
      birthMs,
      mtimeMs: fileStat.mtimeMs,
      timeSource: "mtime",
    };
    image.timeSource = orderKey(image).source;
    found.push(image);
  }
  found.sort(compareImages);
  return found;
}
