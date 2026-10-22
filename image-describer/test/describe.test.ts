import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { parseCommandArgs } from "../src/args.ts";
import { describeImages } from "../src/describe.ts";
import { resolveEffort, lookupModel } from "../src/models.ts";
import { chatResponse, errorResponse, removeDir, tempDir, writeBytes, writePng } from "./helpers.ts";

const KEY = "sk-test-secret-value";

describe("arguments", () => {
  test("parses flags and quoted prompts", () => {
    const request = parseCommandArgs(
      `--dir ./images --model gpt-5.4 --effort high --timeout 15 --language Portuguese --prompt "keep the date"`,
      "/work",
    );
    assert.equal(request.dir, "./images");
    assert.equal(request.model, "gpt-5.4");
    assert.equal(request.effort, "high");
    assert.equal(request.timeout, 15);
    assert.equal(request.language, "Portuguese");
    assert.equal(request.prompt, "keep the date");
    assert.equal(request.cwd, "/work");
  });

  test("rejects a missing directory, an unknown flag, and a bad timeout", () => {
    assert.throws(() => parseCommandArgs("", "/work"), /--dir/);
    assert.throws(() => parseCommandArgs("--dir ./images --nope 1", "/work"), /Unknown flag/);
    assert.throws(() => parseCommandArgs("--dir ./images --timeout soon", "/work"), /Invalid timeout/);
  });
});

describe("effort", () => {
  test("omits an unsupported level and maps a DeepSeek alias", () => {
    const gemini = lookupModel("gemini-3.8-flash");
    const omitted = resolveEffort(gemini, "max");
    assert.equal(omitted.sent, null);
    assert.equal(omitted.effective, "medium");
    assert.match(omitted.notice ?? "", /not supported/);
    const deepseek = lookupModel("deepseek-flash");
    const mapped = resolveEffort(deepseek, "medium");
    assert.equal(mapped.sent, "high");
    assert.equal(mapped.behaviour, "mapped");
    const untouched = resolveEffort(deepseek, "default");
    assert.equal(untouched.sent, null);
    assert.equal(untouched.effective, "high");
  });
});

describe("describeImages", () => {
  test("returns four labelled descriptions and one ledger line", async () => {
    const dir = await tempDir();
    try {
      const names = ["one.png", "two.png", "three.png", "four.png"];
      for (const name of names) await writePng(path.join(dir, name));
      const before = await Promise.all(names.map(async (name) => (await stat(path.join(dir, name))).size));
      let calls = 0;
      const seenPrompts: string[] = [];
      const result = await describeImages(
        {
          dir,
          cwd: dir,
          prompt: "PROMPT_SENTINEL_should_not_be_logged",
          log: "logs/image-runs.jsonl",
        },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY },
          fetchImpl: async (_url, init) => {
            calls += 1;
            const body = JSON.parse(String(init?.body)) as {
              messages: Array<{ content: Array<{ text?: string }> }>;
            };
            seenPrompts.push(body.messages[0].content[0].text ?? "");
            const headers = init?.headers as Record<string, string>;
            assert.equal(headers.authorization, `Bearer ${KEY}`);
            return chatResponse(`DESCRIPTION_SENTINEL_${calls}`);
          },
        },
      );
      assert.equal(calls, 4);
      assert.deepEqual(seenPrompts, Array(4).fill("PROMPT_SENTINEL_should_not_be_logged"));
      for (const name of names) assert.match(result.text, new RegExp(`## ${name}`));
      assert.match(result.text, /DESCRIPTION_SENTINEL_4/);
      assert.equal(result.record.imageCount, 4);
      assert.equal(result.record.succeeded, 4);
      assert.equal(result.record.status, "ok");
      const ledger = await readFile(path.join(dir, "logs", "image-runs.jsonl"), "utf8");
      const lines = ledger.trim().split("\n");
      assert.equal(lines.length, 1);
      assert.equal(ledger.includes("DESCRIPTION_SENTINEL"), false);
      assert.equal(ledger.includes("PROMPT_SENTINEL"), false);
      assert.equal(ledger.includes(KEY), false);
      const record = JSON.parse(lines[0]) as { images: Array<{ bytes: number }>; totalOriginalBytes: number };
      assert.deepEqual(
        record.images.map((image) => image.bytes),
        before,
      );
      assert.equal(record.totalOriginalBytes, before.reduce((sum, size) => sum + size, 0));
      const after = await Promise.all(names.map(async (name) => (await stat(path.join(dir, name))).size));
      assert.deepEqual(after, before);
    } finally {
      await removeDir(dir);
    }
  });

  test("uses the configured language in the default instruction", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      let prompt = "";
      await describeImages(
        { dir, cwd: dir, language: "Portuguese", log: "runs.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY },
          fetchImpl: async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: Array<{ text?: string }> }> };
            prompt = body.messages[0].content[0].text ?? "";
            return chatResponse("vista");
          },
        },
      );
      assert.match(prompt, /^Describe this image in Portuguese\./);
    } finally {
      await removeDir(dir);
    }
  });

  test("omits an unsupported effort and maps a supported alias", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      let geminiBody: Record<string, unknown> = {};
      const gemini = await describeImages(
        { dir, cwd: dir, model: "gemini-3.8-flash", effort: "max", log: "gemini.jsonl" },
        {
          loadEnvFile: false,
          env: { GEMINI_API_KEY: KEY },
          fetchImpl: async (_url, init) => {
            geminiBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
            const headers = init?.headers as Record<string, string>;
            assert.equal(headers["x-goog-api-key"], KEY);
            assert.equal(headers.authorization, undefined);
            return new Response(
              JSON.stringify({
                modelVersion: "gemini-3.8-flash",
                candidates: [{ content: { parts: [{ text: "gemini text" }] } }],
                usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6 },
              }),
              { status: 200 },
            );
          },
        },
      );
      assert.equal(geminiBody.generationConfig, undefined);
      assert.match(gemini.notice ?? "", /not supported/);
      assert.match(gemini.text, /not supported/);
      assert.equal(gemini.record.effortBehaviour, "omitted_unsupported");
      assert.equal(gemini.record.effectiveEffort, "medium");

      let deepseekBody: { reasoning_effort?: string } = {};
      const deepseek = await describeImages(
        { dir, cwd: dir, effort: "medium", log: "deepseek.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY },
          fetchImpl: async (_url, init) => {
            deepseekBody = JSON.parse(String(init?.body)) as { reasoning_effort?: string };
            return chatResponse("mapped");
          },
        },
      );
      assert.equal(deepseekBody.reasoning_effort, "high");
      assert.match(deepseek.notice ?? "", /sent as "high"/);
    } finally {
      await removeDir(dir);
    }
  });

  test("rejects an unknown model and an invalid timeout before any request", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      let calls = 0;
      const deps = {
        loadEnvFile: false,
        env: { DEEPSEEK_API_KEY: KEY },
        fetchImpl: async () => {
          calls += 1;
          return chatResponse("nope");
        },
      };
      await assert.rejects(() => describeImages({ dir, cwd: dir, model: "gpt-5.4-mini" }, deps), /Unknown model/);
      await assert.rejects(() => describeImages({ dir, cwd: dir, timeout: 0 }, deps), /positive number/);
      await assert.rejects(() => describeImages({ dir, cwd: dir, timeout: Number.NaN }, deps), /positive number/);
      assert.equal(calls, 0);
    } finally {
      await removeDir(dir);
    }
  });

  test("writes a no-images record and does not call the provider", async () => {
    const dir = await tempDir();
    try {
      let calls = 0;
      const result = await describeImages(
        { dir, cwd: dir, log: "empty.jsonl" },
        {
          loadEnvFile: false,
          env: {},
          fetchImpl: async () => {
            calls += 1;
            return chatResponse("nope");
          },
        },
      );
      assert.equal(calls, 0);
      assert.equal(result.record.status, "no-images");
      assert.match(result.text, /No eligible images/);
      const ledger = JSON.parse(await readFile(path.join(dir, "empty.jsonl"), "utf8")) as { imageCount: number };
      assert.equal(ledger.imageCount, 0);
    } finally {
      await removeDir(dir);
    }
  });

  test("continues after a corrupt file and a timeout", async () => {
    const dir = await tempDir();
    try {
      await writeBytes(path.join(dir, "bad.jpg"), "this is not a jpeg");
      await writePng(path.join(dir, "slow.png"));
      await writePng(path.join(dir, "ok.png"));
      let calls = 0;
      const result = await describeImages(
        { dir, cwd: dir, timeout: 0.05, log: "mixed.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY },
          readExif: async () => null,
          fetchImpl: async (_url, init) => {
            calls += 1;
            if (calls === 1) {
              await new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => {
                  reject(new DOMException("The operation was aborted.", "TimeoutError"));
                });
              });
            }
            return chatResponse("visible");
          },
        },
      );
      assert.equal(result.record.failed, 2);
      assert.equal(result.record.succeeded, 1);
      assert.equal(result.record.status, "partial");
      assert.match(result.text, /FAILED \(local\): Could not read bad.jpg/);
      assert.match(result.text, /FAILED \(timeout\)/);
      assert.match(result.text, /visible/);
      assert.equal(result.record.usage.completeness, "partial");
    } finally {
      await removeDir(dir);
    }
  });

  test("stops before a request when the key is missing", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      let calls = 0;
      await assert.rejects(
        () =>
          describeImages(
            { dir, cwd: dir, log: "missing.jsonl" },
            {
              loadEnvFile: false,
              env: {},
              fetchImpl: async () => {
                calls += 1;
                return chatResponse("nope");
              },
            },
          ),
        /Missing DEEPSEEK_API_KEY/,
      );
      assert.equal(calls, 0);
      await assert.rejects(() => readFile(path.join(dir, "missing.jsonl"), "utf8"));
    } finally {
      await removeDir(dir);
    }
  });

  test("continues after a rate limit", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      await writePng(path.join(dir, "b.png"));
      let calls = 0;
      const result = await describeImages(
        { dir, cwd: dir, log: "rate.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY },
          readExif: async () => null,
          fetchImpl: async () => {
            calls += 1;
            if (calls === 1) return errorResponse(429, { message: "Rate limit reached", code: "rate_limit_exceeded" });
            return chatResponse("after limit");
          },
        },
      );
      assert.equal(calls, 2);
      assert.equal(result.record.failed, 1);
      assert.equal(result.record.succeeded, 1);
      assert.match(result.text, /FAILED \(rate_limit\)/);
      assert.match(result.text, /after limit/);
    } finally {
      await removeDir(dir);
    }
  });

  test("stops further paid calls after an authentication failure", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      await writePng(path.join(dir, "b.png"));
      let calls = 0;
      const result = await describeImages(
        { dir, cwd: dir, log: "auth.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY },
          readExif: async () => null,
          fetchImpl: async () => {
            calls += 1;
            return errorResponse(401, { message: "Incorrect API key", code: "invalid_api_key" });
          },
        },
      );
      assert.equal(calls, 1);
      assert.equal(result.record.failed, 1);
      assert.equal(result.record.unprocessed, 1);
      assert.equal(result.record.status, "failed");
      assert.match(result.text, /UNPROCESSED: skipped after authentication failure/);
      const ledger = await readFile(path.join(dir, "auth.jsonl"), "utf8");
      assert.equal(ledger.includes(KEY), false);
      assert.equal(ledger.includes("Incorrect API key"), false);
    } finally {
      await removeDir(dir);
    }
  });

  test("labels a partial token sum when a response omits usage", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      await writePng(path.join(dir, "b.png"));
      let calls = 0;
      const result = await describeImages(
        { dir, cwd: dir, log: "usage.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY },
          readExif: async () => null,
          fetchImpl: async () => {
            calls += 1;
            if (calls === 1) {
              return chatResponse("first", {
                prompt_tokens: 10,
                completion_tokens: 4,
                total_tokens: 14,
                completion_tokens_details: { reasoning_tokens: 1 },
                prompt_tokens_details: { cached_tokens: 0 },
              });
            }
            return chatResponse("second", null);
          },
        },
      );
      assert.equal(result.record.usage.completeness, "partial");
      assert.equal(result.record.usage.responsesReportingUsage, 1);
      assert.equal(result.record.usage.inputTokens, 10);
      assert.equal(result.record.usage.totalTokens, 14);
      assert.equal(result.record.usage.reasoningTokens, 1);
    } finally {
      await removeDir(dir);
    }
  });

  test("keeps concurrent ledger appends on separate lines", async () => {
    const dir = await tempDir();
    try {
      const left = path.join(dir, "left");
      const right = path.join(dir, "right");
      await writePng(path.join(left, "a.png"));
      await writePng(path.join(right, "b.png"));
      const log = path.join(dir, "logs", "image-runs.jsonl");
      const deps = {
        loadEnvFile: false as const,
        env: { DEEPSEEK_API_KEY: KEY },
        fetchImpl: async () => chatResponse("text"),
      };
      await Promise.all([
        describeImages({ dir: left, cwd: dir, log }, deps),
        describeImages({ dir: right, cwd: dir, log }, deps),
      ]);
      const lines = (await readFile(log, "utf8")).trim().split("\n");
      assert.equal(lines.length, 2);
      for (const line of lines) JSON.parse(line);
    } finally {
      await removeDir(dir);
    }
  });
});
