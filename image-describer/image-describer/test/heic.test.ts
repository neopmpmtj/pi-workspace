import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { heicDecoderAvailable, toJpegPayload } from "../src/convert.ts";
import { removeDir, tempDir } from "./helpers.ts";

test("orientation is applied to the converted payload and the original stays put", async () => {
  const dir = await tempDir();
  try {
    const filePath = path.join(dir, "turned.jpg");
    const original = await sharp({
      create: { width: 20, height: 10, channels: 3, background: { r: 200, g: 10, b: 10 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    await writeFile(filePath, original);
    const payload = await toJpegPayload(filePath);
    const meta = await sharp(payload.buffer).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.width, 10);
    assert.equal(meta.height, 20);
    const after = await sharp(filePath).metadata();
    assert.equal(after.width, 20);
    assert.equal(after.height, 10);
  } finally {
    await removeDir(dir);
  }
});

test("HEIC decode matches what this sharp build can actually read", async () => {
  const available = heicDecoderAvailable();
  const suffixes = sharp.format.heif?.input?.fileSuffix ?? [];
  const hevc = sharp.versions.heif;
  console.log(`HEIC input support: ${available}; heif input suffixes: ${JSON.stringify(suffixes)}; libheif ${hevc}`);
  const dir = await tempDir();
  try {
    const filePath = path.join(dir, "sample.heic");
    if (!available) {
      await writeFile(filePath, Buffer.from("not a heic file"));
      await assert.rejects(() => toJpegPayload(filePath), /HEIC\/HEIF decode failed/);
      return;
    }
    await sharp({
      create: { width: 6, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .heif({ compression: "hevc" })
      .toFile(filePath);
    const before = await sharp(filePath).metadata();
    const payload = await toJpegPayload(filePath);
    const after = await sharp(payload.buffer).metadata();
    const original = await sharp(filePath).metadata();
    assert.equal(after.format, "jpeg");
    assert.equal(after.width, before.width);
    assert.equal(original.format, before.format);
  } finally {
    await removeDir(dir);
  }
});

test("an injected HEIF decoder becomes JPEG and leaves the source unchanged", async () => {
  if (heicDecoderAvailable()) return;
  const dir = await tempDir();
  try {
    const filePath = path.join(dir, "sample.heif");
    const source = Buffer.from("not really heif");
    await writeFile(filePath, source);
    const png = await sharp({
      create: { width: 12, height: 8, channels: 3, background: { r: 9, g: 8, b: 7 } },
    })
      .png()
      .toBuffer();
    const payload = await toJpegPayload(filePath, async () => png);
    const meta = await sharp(payload.buffer).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.width, 12);
    assert.equal(meta.height, 8);
    assert.deepEqual(await readFile(filePath), source);
    assert.deepEqual(await readdir(dir), ["sample.heif"]);
    await assert.rejects(
      () => toJpegPayload(filePath, async () => Promise.reject(new Error("decoder missing"))),
      /HEIC\/HEIF decode failed for sample\.heif/,
    );
    assert.deepEqual(await readdir(dir), ["sample.heif"]);
  } finally {
    await removeDir(dir);
  }
});
