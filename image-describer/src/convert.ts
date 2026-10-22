import path from "node:path";
import sharp from "sharp";

const MAX_EDGE = 2000;
const MAX_BYTES = 4_718_592;

export interface JpegPayload {
  buffer: Buffer;
  bytes: number;
  firstFrame: boolean;
}

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

async function render(filePath: string, quality: number): Promise<Buffer> {
  return sharp(filePath, { pages: 1, animated: false, limitInputPixels: 200_000_000 })
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
}

/** Decode in memory, bake in orientation, and fit the payload inside 2000px and 4.5 MB. Originals are not written. */
export async function toJpegPayload(filePath: string): Promise<JpegPayload> {
  const firstFrame = isFirstFrameType(filePath);
  if (isHeif(filePath) && !heicDecoderAvailable()) {
    const suffixes = heifInputSuffixes();
    const supported = suffixes.length > 0 ? suffixes.join(", ") : "none";
    throw new Error(
      `HEIC/HEIF decode failed for ${path.basename(filePath)}. This sharp build does not decode HEIC/HEIF (heif input suffixes: ${supported}).`,
    );
  }
  let quality = 80;
  let buffer: Buffer;
  try {
    buffer = await render(filePath, quality);
    while (buffer.length > MAX_BYTES && quality > 40) {
      quality -= 10;
      buffer = await render(filePath, quality);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isHeif(filePath)) {
      throw new Error(`HEIC/HEIF decode failed for ${path.basename(filePath)}. ${shortError(message)}`);
    }
    throw new Error(`Could not read ${path.basename(filePath)}. ${shortError(message)}`);
  }
  if (buffer.length > MAX_BYTES) {
    throw new Error(`Converted ${path.basename(filePath)} still exceeds 4.5 MB.`);
  }
  return { buffer, bytes: buffer.length, firstFrame };
}

function shortError(message: string): string {
  return message.replace(/\s+/g, " ").slice(0, 180);
}

/** True only when this sharp build advertises HEIC/HEIF input. AVIF-only heif support does not count. */
export function heicDecoderAvailable(): boolean {
  return heifInputSuffixes().some((suffix) => suffix === ".heic" || suffix === ".heif");
}
