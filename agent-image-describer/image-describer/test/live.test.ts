import assert from "node:assert/strict";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { describeImages } from "../src/describe.ts";
import { removeDir, tempDir } from "./helpers.ts";

const key = process.env.DEEPSEEK_API_KEY;

test("live deepseek-flash smoke", { skip: key ? false : "DEEPSEEK_API_KEY is not in the environment" }, async () => {
  const dir = await tempDir();
  try {
    await copyFile(
      path.join(import.meta.dirname, "..", "02test_image-vision-model.jpeg"),
      path.join(dir, "02test_image-vision-model.jpeg"),
    );
    const result = await describeImages(
      { dir, cwd: dir, model: "deepseek-flash", timeout: 120, log: "live.jsonl" },
      { loadEnvFile: false, env: { DEEPSEEK_API_KEY: key } },
    );
    assert.equal(result.record.succeeded, 1);
    assert.equal(result.record.provider, "deepseek");
    assert.match(result.text, /## 02test_image-vision-model.jpeg/);
    assert.ok((result.images[0]?.description ?? "").length > 20);
    console.log(`Live deepseek-flash smoke succeeded. actualModel=${result.record.actualModel ?? "unreported"}`);
  } finally {
    await removeDir(dir);
  }
});
