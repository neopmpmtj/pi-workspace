import { spawn } from "node:child_process";
import path from "node:path";
import sharp from "sharp";

const MAX_EDGE = 2000;
const MAX_BYTES = 4_718_592;

export interface JpegPayload {
  buffer: Buffer;
  bytes: number;
  firstFrame: boolean;
}

/** In-memory HEIF decode. Production uses heif-thumbnailer; tests can pass a buffer. */
export type HeifDecoder = (filePath: string) => Promise<Buffer>;

function isFirstFrameType(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".gif" || ext === ".tif" || ext === ".tiff";
}

function isHeif(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".heic" || ext === ".heif";
}

function heifInputSuffixes(): string[] {
  const suffixes = sharp.format.heif?.input?.fileSuffix;
  return Array.isArray(suffixes) ? suffixes : [];
}

async function render(input: string | Buffer, quality: number): Promise<Buffer> {
  return sharp(input, { pages: 1, animated: false, limitInputPixels: 200_000_000 })
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
}

async function jpegFrom(input: string | Buffer, firstFrame: boolean, filename: string): Promise<JpegPayload> {
  let quality = 80;
  let buffer = await render(input, quality);
  while (buffer.length > MAX_BYTES && quality > 40) {
    quality -= 10;
    buffer = await render(input, quality);
  }
  if (buffer.length > MAX_BYTES) {
    throw new Error(`Converted ${filename} still exceeds 4.5 MB.`);
  }
  return { buffer, bytes: buffer.length, firstFrame };
}

/** Decode in memory, bake in orientation, and fit the payload inside 2000px and 4.5 MB. Originals are not written. */
export async function toJpegPayload(
  filePath: string,
  decodeHeif: HeifDecoder = decodeHeifWithThumbnailer,
): Promise<JpegPayload> {
  const firstFrame = isFirstFrameType(filePath);
  const filename = path.basename(filePath);
  if (isHeif(filePath) && !heicDecoderAvailable()) {
    let decoded: Buffer;
    try {
      decoded = await decodeHeif(filePath);
    } catch (error) {
      throw heifError(filename, error);
    }
    try {
      return await jpegFrom(decoded, firstFrame, filename);
    } catch (error) {
      if (isSizeError(error)) throw error;
      throw heifError(filename, error);
    }
  }
  try {
    return await jpegFrom(filePath, firstFrame, filename);
  } catch (error) {
    if (isSizeError(error)) throw error;
    if (isHeif(filePath)) throw heifError(filename, error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${filename}. ${shortError(message)}`);
  }
}

function isSizeError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Converted ");
}

function heifError(filename: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`HEIC/HEIF decode failed for ${filename}. ${shortError(message)}`);
}

function shortError(message: string): string {
  return message.replace(/\s+/g, " ").slice(0, 180);
}

/** True only when this sharp build advertises HEIC/HEIF input. AVIF-only heif support does not count. */
export function heicDecoderAvailable(): boolean {
  return heifInputSuffixes().some((suffix) => suffix === ".heic" || suffix === ".heif");
}

/**
 * PNG on stdout from the system decoder. Does not write a sibling JPEG.
 * Node's stdio pipe is a socket, and heif-thumbnailer opens /dev/stdout with O_TRUNC, which fails on a socket.
 * bash gives the decoder a real pipe; cat copies that pipe into the socket.
 */
function decodeHeifWithThumbnailer(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "bash",
      ["-o", "pipefail", "-c", 'heif-thumbnailer -s "$2" -p "$1" /dev/stdout | cat', "bash", filePath, String(MAX_EDGE)],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const ok = (buffer: Buffer) => {
      if (settled) return;
      settled = true;
      resolve(buffer);
    };
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => fail(error));
    child.on("close", (code) => {
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        fail(new Error(detail || `heif-thumbnailer exited ${code ?? "null"}.`));
        return;
      }
      const buffer = Buffer.concat(stdout);
      if (buffer.length === 0) {
        fail(new Error("heif-thumbnailer produced no output."));
        return;
      }
      ok(buffer);
    });
  });
}
