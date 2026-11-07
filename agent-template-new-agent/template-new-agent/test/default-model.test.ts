import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { readDefaultModel, readStandingModel, writeDefaultModel } from "../src/default-model.ts";

async function withEnv<T>(run: (env: NodeJS.ProcessEnv, agent: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "template-new-agent-"));
  const agent = path.join(root, "template-new-agent");
  try {
    return await run({ PI_CODING_AGENT_DIR: agent }, agent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("default-model.json", () => {
  it("is absent until something is saved", async () => {
    await withEnv(async (env) => {
      assert.equal(await readDefaultModel(env), null);
    });
  });

  it("round-trips provider, model and thinking level", async () => {
    await withEnv(async (env) => {
      const saved = await writeDefaultModel({ provider: "google", model: "gemini-3.8-flash", thinking: "medium" }, env);
      assert.equal(saved.provider, "google");
      const read = await readDefaultModel(env);
      assert.equal(read?.model, "gemini-3.8-flash");
      assert.equal(read?.thinking, "medium");
    });
  });

  it("writes a file the launcher can parse", async () => {
    await withEnv(async (env, agent) => {
      await writeDefaultModel({ provider: "openai", model: "gpt-5.4" }, env);
      const raw = JSON.parse(await readFile(path.join(agent, "default-model.json"), "utf8")) as Record<string, unknown>;
      assert.equal(raw.provider, "openai");
      assert.equal(raw.model, "gpt-5.4");
      assert.equal(raw.thinking, "low");
    });
  });

  it("defaults a missing thinking level to low", async () => {
    await withEnv(async (env) => {
      await writeDefaultModel({ provider: "deepseek", model: "deepseek-flash" }, env);
      assert.equal((await readDefaultModel(env))?.thinking, "low");
    });
  });

  it("rejects an empty model before writing", async () => {
    await withEnv(async (env) => {
      await assert.rejects(writeDefaultModel({ provider: "openai", model: "  " }, env), /cannot be empty/);
      assert.equal(await readDefaultModel(env), null);
    });
  });

  it("rejects an unknown thinking level", async () => {
    await withEnv(async (env) => {
      await assert.rejects(writeDefaultModel({ provider: "openai", model: "gpt-5.4", thinking: "turbo" }, env), /thinking must be one of/);
    });
  });

  it("reports a malformed file instead of silently ignoring it", async () => {
    await withEnv(async (env, agent) => {
      await mkdir(agent, { recursive: true });
      await writeFile(path.join(agent, "default-model.json"), "{ not json", "utf8");
      await assert.rejects(readDefaultModel(env), /not valid JSON/);
    });
  });
});

describe("standing model", () => {
  it("uses settings.json when default-model.json is absent", async () => {
    await withEnv(async (env, agent) => {
      await mkdir(agent, { recursive: true });
      await writeFile(
        path.join(agent, "settings.json"),
        JSON.stringify({ defaultProvider: "deepseek", defaultModel: "deepseek-flash", defaultThinkingLevel: "low" }),
        "utf8",
      );
      const standing = await readStandingModel(env);
      assert.equal(standing?.provider, "deepseek");
      assert.equal(standing?.model, "deepseek-flash");
      assert.equal(standing?.thinking, "low");
    });
  });

  it("lets default-model.json override settings.json", async () => {
    await withEnv(async (env, agent) => {
      await mkdir(agent, { recursive: true });
      await writeFile(
        path.join(agent, "settings.json"),
        JSON.stringify({ defaultProvider: "deepseek", defaultModel: "deepseek-flash", defaultThinkingLevel: "low" }),
        "utf8",
      );
      await writeDefaultModel({ provider: "openai", model: "gpt-5.4", thinking: "high" }, env);
      const standing = await readStandingModel(env);
      assert.equal(standing?.provider, "openai");
      assert.equal(standing?.model, "gpt-5.4");
      assert.equal(standing?.thinking, "high");
    });
  });

  it("is absent when neither file names a model", async () => {
    await withEnv(async (env, agent) => {
      await mkdir(agent, { recursive: true });
      await writeFile(path.join(agent, "settings.json"), JSON.stringify({ defaultTools: ["read"] }), "utf8");
      assert.equal(await readStandingModel(env), null);
    });
  });

  it("reports a malformed settings.json", async () => {
    await withEnv(async (env, agent) => {
      await mkdir(agent, { recursive: true });
      await writeFile(path.join(agent, "settings.json"), "{ not json", "utf8");
      await assert.rejects(readStandingModel(env), /settings\.json is not valid JSON/);
    });
  });

  it("rejects an unknown thinking level in settings.json", async () => {
    await withEnv(async (env, agent) => {
      await mkdir(agent, { recursive: true });
      await writeFile(
        path.join(agent, "settings.json"),
        JSON.stringify({ defaultProvider: "deepseek", defaultModel: "deepseek-flash", defaultThinkingLevel: "turbo" }),
        "utf8",
      );
      await assert.rejects(readStandingModel(env), /settings\.json defaultThinkingLevel must be one of/);
    });
  });
});
