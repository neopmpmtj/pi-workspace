// The CLI is the terminal door to the same store the dashboard's settings page uses,
// so these tests check the two things that matter: it writes what the store accepts and
// it refuses, leaving the file alone, what the store rejects.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { main, type Io } from "./cli.ts";

const GATES = {
  lessThanInputWords: { enabled: true, words: 6, print: true },
  inputContainsPath: { enabled: true, print: true },
  inputContainsUrl: { enabled: true, print: true },
  inputContainsEmail: { enabled: true, print: true },
  calendarNode: { enabled: true, print: true, mode: "route" },
  reminderNode: { enabled: true, print: true, mode: "route", writes: true },
};

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-config-cli-"));
  await writeFile(path.join(root, "config.json"), `${JSON.stringify(GATES, null, 2)}\n`);
  await writeFile(path.join(root, "input-phrase-config.json"), `${JSON.stringify({
    inputPhrase: {
      enabled: true,
      append1: "hello",
      normal: { enabled: false, allowBlank: false, phrase: "one" },
      advanced: { enabled: true, allowBlank: true, phrase: "" },
    },
  }, null, 2)}\n`);
  await writeFile(path.join(root, "prompt-build-config.json"), `${JSON.stringify({
    promptBuild: {
      enabled: true,
      "1-Personal": { enabled: true, prompt: "be kind", config: { a: 1 } },
      "2-Development": { enabled: false, prompt: "dev rules", config: { b: 2 } },
      "3-Work": { enabled: false, prompt: "work rules", config: {} },
      "4-Automatic": { enabled: false, prompt: "", config: {} },
    },
  }, null, 2)}\n`);
  const homes: Record<string, Record<string, unknown>> = {
    "agent/cos-orchestrator-agent": {
      defaultProvider: "deepseek",
      defaultModel: "deepseek-flash",
      defaultThinkingLevel: "high",
      defaultTools: ["read"],
      extensions: ["+extensions/chat/index.ts"],
      theme: "dark",
    },
  };
  for (const home of [
    "agent-image-describer/image-describer",
    "agent-web-master/web-master",
    "agent-keep-agent/keep-agent",
    "agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace",
  ]) {
    homes[home] = { defaultProvider: "deepseek", defaultModel: "deepseek-flash", defaultThinkingLevel: "low", defaultTools: [] };
  }
  for (const [home, settings] of Object.entries(homes)) {
    const dir = path.join(root, home);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  }
  return root;
}

async function run(root: string, argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (line) => out.push(line), err: (line) => err.push(line) };
  const code = await main([...argv, "--root", root], io);
  return { code, out, err };
}

async function readJson(file: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(file, "utf8")) as Record<string, any>;
}

describe("pi-config", () => {
  it("writes a gate field and refuses a value the store rejects", async () => {
    const root = await fixture();
    try {
      const ok = await run(root, ["set", "lessThanInputWords.words", "12"]);
      assert.equal(ok.code, 0);
      assert.equal((await readJson(path.join(root, "config.json"))).lessThanInputWords.words, 12);
      assert.equal((await run(root, ["set", "calendarNode.mode", "dry"])).code, 0);
      assert.equal((await readJson(path.join(root, "config.json"))).calendarNode.mode, "dry");

      const before = await readFile(path.join(root, "config.json"), "utf8");
      const bad = await run(root, ["set", "lessThanInputWords.words", "0"]);
      assert.equal(bad.code, 1);
      assert.match(bad.err.join("\n"), /integer of 1 or more/);
      assert.equal(await readFile(path.join(root, "config.json"), "utf8"), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps exactly one input phrase option on and stores the phrase as given", async () => {
    const root = await fixture();
    try {
      const both = await run(root, ["set", "inputPhrase.normal.enabled", "on"]);
      assert.equal(both.code, 1);
      assert.match(both.err.join("\n"), /exactly one option/);
      assert.match(both.err.join("\n"), /pi-config use/);

      // Switching the option that is on is one write, not two that each fail in between.
      assert.equal((await run(root, ["use", "inputPhrase.normal"])).code, 0);
      const phrase = await run(root, ["set", "inputPhrase.normal.phrase", "answer", "in", "one", "sentence"]);
      assert.equal(phrase.code, 0);
      const section = (await readJson(path.join(root, "input-phrase-config.json"))).inputPhrase;
      assert.deepEqual(section.normal, { enabled: true, allowBlank: false, phrase: "answer in one sentence" });
      assert.equal(section.advanced.enabled, false);
      assert.equal(section.append1, "hello");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes a prompt build prompt and a config object", async () => {
    const root = await fixture();
    try {
      assert.equal((await run(root, ["set", "promptBuild.3-Work.prompt", "two words"])).code, 0);
      assert.equal((await run(root, ["set", "promptBuild.3-Work.config", '{"tone":"warm","n":2}'])).code, 0);
      assert.equal((await run(root, ["set", "promptBuild.3-Work.enabled", "on"])).code, 1);
      const promptBuild = (await readJson(path.join(root, "prompt-build-config.json"))).promptBuild;
      assert.equal(promptBuild["3-Work"].prompt, "two words");
      assert.deepEqual(promptBuild["3-Work"].config, { tone: "warm", n: 2 });
      assert.equal(promptBuild["3-Work"].enabled, false);
      assert.equal(promptBuild["1-Personal"].enabled, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("switches a prompt build option in one write", async () => {
    const root = await fixture();
    try {
      assert.equal((await run(root, ["use", "promptBuild", "4-Automatic"])).code, 0);
      const promptBuild = (await readJson(path.join(root, "prompt-build-config.json"))).promptBuild;
      assert.equal(promptBuild["4-Automatic"].enabled, true);
      assert.equal(promptBuild["1-Personal"].enabled, false);
      assert.equal(promptBuild.enabled, true);
      assert.equal((await run(root, ["use", "promptBuild.nope"])).code, 1);
      assert.equal((await run(root, ["use", "calendarNode"])).code, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("switching a prompt build option keeps every other prompt and config", async () => {
    const root = await fixture();
    try {
      assert.equal((await run(root, ["use", "promptBuild", "3-Work"])).code, 0);
      const promptBuild = (await readJson(path.join(root, "prompt-build-config.json"))).promptBuild;
      assert.equal(promptBuild["1-Personal"].prompt, "be kind");
      assert.deepEqual(promptBuild["1-Personal"].config, { a: 1 });
      assert.equal(promptBuild["2-Development"].prompt, "dev rules");
      assert.deepEqual(promptBuild["2-Development"].config, { b: 2 });
      assert.equal(promptBuild["3-Work"].enabled, true);
      assert.equal(promptBuild["3-Work"].prompt, "work rules");
      assert.equal(promptBuild["1-Personal"].enabled, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes an agent model setting into settings.json, and into default-model.json when that exists", async () => {
    const root = await fixture();
    try {
      const home = path.join(root, "agent/cos-orchestrator-agent");
      assert.equal((await run(root, ["set", "agent.cos.thinking", "medium"])).code, 0);
      assert.equal((await run(root, ["set", "agent.cos.tools", "read,bash , grep"])).code, 0);
      const settings = await readJson(path.join(home, "settings.json"));
      assert.equal(settings.defaultThinkingLevel, "medium");
      assert.deepEqual(settings.defaultTools, ["read", "bash", "grep"]);

      await writeFile(path.join(home, "default-model.json"), `${JSON.stringify({ provider: "deepseek", model: "deepseek-flash", thinking: "medium" }, null, 2)}\n`);
      assert.equal((await run(root, ["set", "agent.cos.model", "deepseek-v4-pro"])).code, 0);
      const model = await readJson(path.join(home, "default-model.json"));
      assert.equal(model.model, "deepseek-v4-pro");
      assert.equal(model.provider, "deepseek");
      assert.ok(typeof model.updatedAt === "string" && model.updatedAt.length > 0);

      const bad = await run(root, ["set", "agent.cos.thinking", "turbo"]);
      assert.equal(bad.code, 1);
      assert.match(bad.err.join("\n"), /thinking must be one of/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads a value back, and lists everything as JSON", async () => {
    const root = await fixture();
    try {
      const mode = await run(root, ["get", "calendarNode.mode"]);
      assert.equal(mode.code, 0);
      assert.equal(mode.out.join("\n"), '"route"');

      const config = await run(root, ["get", "promptBuild.1-Personal.config", "--json"]);
      assert.deepEqual(JSON.parse(config.out.join("\n")), { a: 1 });

      const all = await run(root, ["list", "--json"]);
      assert.equal(all.code, 0);
      const plane = JSON.parse(all.out.join("\n")) as Record<string, any>;
      assert.equal(plane.gates.length, 6);
      assert.equal(plane.inputPhrase.append1, "hello");
      assert.equal(plane.promptBuild.options.length, 4);
      assert.equal(plane.agents.length, 5);

      const text = await run(root, ["list"]);
      assert.match(text.out.join("\n"), /reminderNode\s+enabled=true/);
      assert.equal((await run(root, ["get", "nope.enabled"])).code, 1);
      const gates = await run(root, ["get", "gates", "--json"]);
      assert.equal((JSON.parse(gates.out.join("\n")) as unknown[]).length, 6);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes nothing with --dry-run", async () => {
    const root = await fixture();
    try {
      const before = await readFile(path.join(root, "input-phrase-config.json"), "utf8");
      const dry = await run(root, ["set", "inputPhrase.append1", "later", "--dry-run"]);
      assert.equal(dry.code, 0);
      assert.match(dry.out.join("\n"), /\[dry-run\]/);
      assert.equal(await readFile(path.join(root, "input-phrase-config.json"), "utf8"), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
