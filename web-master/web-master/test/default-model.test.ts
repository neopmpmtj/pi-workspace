import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { readDefaultModel, writeDefaultModel } from "../src/default-model.ts";

async function withEnv<T>(run: (env: NodeJS.ProcessEnv, agent: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "web-master-"));
  const agent = path.join(root, "web-master");
  try {
    return await run({ PI_CODING_AGENT_DIR: agent }, agent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("default-web-master-model.json", () => {
  it("is absent until something is saved", async () => {
    await withEnv(async (env) => {
      assert.equal(await readDefaultModel(env), null);
    });
  });

  it("round-trips provider, model and effort", async () => {
    await withEnv(async (env) => {
      const saved = await writeDefaultModel({ provider: "google", model: "gemini-3.8-flash", effort: "medium" }, env);
      assert.equal(saved.provider, "google");
      const read = await readDefaultModel(env);
      assert.equal(read?.model, "gemini-3.8-flash");
      assert.equal(read?.effort, "medium");
    });
  });

  it("writes a file the launcher can parse", async () => {
    await withEnv(async (env, agent) => {
      await writeDefaultModel({ provider: "openai", model: "gpt-5.4" }, env);
      const raw = JSON.parse(await readFile(path.join(agent, "default-web-master-model.json"), "utf8")) as Record<string, unknown>;
      assert.equal(raw.provider, "openai");
      assert.equal(raw.model, "gpt-5.4");
      assert.equal(raw.effort, "low");
    });
  });

  it("defaults a missing effort to low", async () => {
    await withEnv(async (env) => {
      await writeDefaultModel({ provider: "deepseek", model: "deepseek-flash" }, env);
      assert.equal((await readDefaultModel(env))?.effort, "low");
    });
  });

  it("rejects an empty model before writing", async () => {
    await withEnv(async (env) => {
      await assert.rejects(writeDefaultModel({ provider: "openai", model: "  " }, env), /cannot be empty/);
      assert.equal(await readDefaultModel(env), null);
    });
  });

  it("rejects an unknown effort", async () => {
    await withEnv(async (env) => {
      await assert.rejects(writeDefaultModel({ provider: "openai", model: "gpt-5.4", effort: "turbo" }, env), /effort must be one of/);
    });
  });

  it("reports a malformed file instead of silently ignoring it", async () => {
    await withEnv(async (env, agent) => {
      await mkdir(agent, { recursive: true });
      await writeFile(path.join(agent, "default-web-master-model.json"), "{ not json", "utf8");
      await assert.rejects(readDefaultModel(env), /not valid JSON/);
    });
  });
});
