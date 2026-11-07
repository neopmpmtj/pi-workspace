import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { SettingsError, readControlPlane, writeGate, writeInputPhrase, writePromptBuild, writeAgentSettings } from "./store.ts";

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "project-dashboard-"));
  await writeFile(path.join(root, "config.json"), `${JSON.stringify({
    lessThanInputWords: { enabled: true, words: 6, print: true },
    calendarNode: { enabled: true, print: true, mode: "route" },
  }, null, 2)}\n`);
  await writeFile(path.join(root, "input-phrase-config.json"), `${JSON.stringify({
    inputPhrase: {
      enabled: true,
      append1: "hello",
      normal: { enabled: true, allowBlank: false, phrase: "one" },
      advanced: { enabled: false, allowBlank: true, phrase: "" },
    },
  }, null, 2)}\n`);
  await writeFile(path.join(root, "prompt-build-config.json"), `${JSON.stringify({
    promptBuild: {
      enabled: true,
      "1-Personal": { enabled: false, prompt: "", config: {} },
      "2-Development": { enabled: true, prompt: "", config: {} },
      "3-Work": { enabled: false, prompt: "", config: {} },
      "4-Automatic": { enabled: false, prompt: "", config: {} },
    },
  }, null, 2)}\n`);
  const home = path.join(root, "agent/cos-orchestrator-agent");
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, "settings.json"), `${JSON.stringify({
    defaultProvider: "deepseek",
    defaultModel: "deepseek-flash",
    defaultThinkingLevel: "high",
    defaultTools: ["read"],
    extensions: ["+extensions/chat/index.ts"],
    theme: "dark",
  }, null, 2)}\n`);
  for (const homePath of [
    "agent-image-describer/image-describer",
    "agent-web-master/web-master",
    "agent-keep-agent/keep-agent",
    "agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace",
  ]) {
    const dir = path.join(root, homePath);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "settings.json"), `${JSON.stringify({
      defaultProvider: "deepseek",
      defaultModel: "deepseek-flash",
      defaultThinkingLevel: "low",
      defaultTools: [],
    }, null, 2)}\n`);
  }
  return root;
}

describe("project dashboard store", () => {
  it("rejects a word limit that is not a positive integer and leaves the file", async () => {
    const root = await fixture();
    try {
      const before = await readFile(path.join(root, "config.json"), "utf8");
      await assert.rejects(
        () => writeGate("lessThanInputWords", { fields: { words: 0 } }, root),
        SettingsError,
      );
      assert.equal(await readFile(path.join(root, "config.json"), "utf8"), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an enabled input phrase with both options on", async () => {
    const root = await fixture();
    try {
      await assert.rejects(
        () => writeInputPhrase({
          enabled: true,
          append1: "",
          options: [
            { name: "normal", enabled: true, allowBlank: false, phrase: "one" },
            { name: "advanced", enabled: true, allowBlank: true, phrase: "" },
          ],
        }, root),
        /exactly one option/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a prompt build that is on with two options, and a config that is not an object", async () => {
    const root = await fixture();
    try {
      const before = await readFile(path.join(root, "prompt-build-config.json"), "utf8");
      const options = ["1-Personal", "2-Development", "3-Work", "4-Automatic"].map((name) => ({
        name,
        enabled: name === "1-Personal" || name === "2-Development",
        prompt: "",
        config: "{}",
      }));
      await assert.rejects(() => writePromptBuild({ enabled: true, options }, root), /exactly one option/);
      options[0].enabled = false;
      options[1].config = "[]";
      await assert.rejects(() => writePromptBuild({ enabled: true, options }, root), /JSON object/);
      assert.equal(await readFile(path.join(root, "prompt-build-config.json"), "utf8"), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes an extension as unload without dropping other settings", async () => {
    const root = await fixture();
    try {
      await writeAgentSettings("cos", {
        provider: "deepseek",
        model: "deepseek-flash",
        thinking: "high",
        tools: ["read", "bash"],
        enabledModels: null,
        extensions: [{ path: "extensions/chat/index.ts", enabled: false }],
        packages: null,
      }, root);
      const settings = JSON.parse(await readFile(path.join(root, "agent/cos-orchestrator-agent/settings.json"), "utf8"));
      assert.deepEqual(settings.extensions, ["-extensions/chat/index.ts"]);
      assert.equal(settings.theme, "dark");
      assert.deepEqual(settings.defaultTools, ["read", "bash"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("a store file that is missing (per-machine files, seeded from the sample)", () => {
  const SAMPLE = {
    lessThanInputWords: { enabled: true, words: 4, print: true },
    calendarNode: { enabled: true, print: true, mode: "dry" },
  };

  /** fixture() with its three store files replaced by sample copies. */
  async function sampleOnly(): Promise<string> {
    const root = await fixture();
    for (const name of ["config", "input-phrase-config", "prompt-build-config"]) {
      const file = path.join(root, `${name}.json`);
      await writeFile(path.join(root, `${name}.sample.json`), await readFile(file, "utf8"));
      await rm(file);
    }
    await writeFile(path.join(root, "config.sample.json"), `${JSON.stringify(SAMPLE, null, 2)}\n`);
    return root;
  }

  it("creates the missing files from their samples and reads them", async () => {
    const root = await sampleOnly();
    try {
      const plane = await readControlPlane(root);
      const gates = plane.gates.find((gate) => gate.name === "lessThanInputWords");
      assert.equal(gates?.fields.find((field) => field.key === "words")?.value, 4);
      const seeded = JSON.parse(await readFile(path.join(root, "config.json"), "utf8"));
      assert.deepEqual(seeded, SAMPLE);
      assert.equal(JSON.parse(await readFile(path.join(root, "input-phrase-config.json"), "utf8")).inputPhrase.enabled, true);
      // the samples are only read, never rewritten
      assert.deepEqual(JSON.parse(await readFile(path.join(root, "config.sample.json"), "utf8")), SAMPLE);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("seeds and then applies a write to the missing file", async () => {
    const root = await sampleOnly();
    try {
      await writeGate("lessThanInputWords", { fields: { words: 9 } }, root);
      const written = JSON.parse(await readFile(path.join(root, "config.json"), "utf8"));
      assert.equal(written.lessThanInputWords.words, 9);
      assert.equal(written.calendarNode.mode, "dry");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prefers an existing file over its sample", async () => {
    const root = await sampleOnly();
    try {
      const own = { lessThanInputWords: { enabled: false, words: 2, print: false } };
      await writeFile(path.join(root, "config.json"), `${JSON.stringify(own, null, 2)}\n`);
      await readControlPlane(root);
      assert.deepEqual(JSON.parse(await readFile(path.join(root, "config.json"), "utf8")), own);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("still rejects a missing file that has no sample", async () => {
    const root = await sampleOnly();
    try {
      await rm(path.join(root, "config.sample.json"));
      // Reads degrade to a problem; a write, which needs the file it edits, still fails.
      const plane = await readControlPlane(root);
      assert.deepEqual(plane.gates, []);
      assert.match(plane.problems[0]?.message ?? "", /Cannot read config\.json/);
      await assert.rejects(() => writeGate("lessThanInputWords", { fields: { words: 3 } }, root), SettingsError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("a file that cannot be read is skipped, never fatal", () => {
  it("keeps the other agents when one settings.json is missing", async () => {
    const root = await fixture();
    try {
      await rm(path.join(root, "agent-web-master/web-master/settings.json"));
      const plane = await readControlPlane(root);
      const broken = plane.agents.find((agent) => agent.id === "web-master");
      assert.equal(broken?.readable, false);
      assert.match(broken?.error ?? "", /Cannot read settings\.json/);
      assert.deepEqual(broken?.tools, []);
      const healthy = plane.agents.find((agent) => agent.id === "cos");
      assert.equal(healthy?.readable, true);
      assert.equal(healthy?.model, "deepseek-flash");
      assert.deepEqual(plane.problems.map((problem) => problem.file), ["agent.web-master"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the sections that are readable when config.json is not", async () => {
    const root = await fixture();
    try {
      await rm(path.join(root, "config.json"));
      await writeFile(path.join(root, "config.json"), "{ not json\n");
      const plane = await readControlPlane(root);
      assert.deepEqual(plane.gates, []);
      assert.match(plane.problems[0]?.message ?? "", /not valid JSON/);
      assert.equal(plane.inputPhrase?.enabled, true);
      assert.ok(plane.promptBuild);
      assert.equal(plane.agents.find((agent) => agent.id === "cos")?.readable, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("names a directory where a file belongs", async () => {
    const root = await fixture();
    try {
      await rm(path.join(root, "prompt-build-config.json"));
      await mkdir(path.join(root, "prompt-build-config.json"));
      const plane = await readControlPlane(root);
      assert.equal(plane.promptBuild, null);
      assert.match(plane.problems[0]?.message ?? "", /is a directory/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

});

describe("modeSwitch.answer", () => {
  it("writes hook or model and rejects any other string, leaving the file", async () => {
    const root = await fixture();
    try {
      const file = path.join(root, "config.json");
      const config = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      config.modeSwitch = { enabled: true, print: true, answer: "model" };
      await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
      const before = await readFile(file, "utf8");

      await assert.rejects(
        () => writeGate("modeSwitch", { fields: { answer: "shout" } }, root),
        (error: unknown) => error instanceof SettingsError && /answer must be hook or model/.test(error.message),
      );
      assert.equal(await readFile(file, "utf8"), before);

      const written = await writeGate("modeSwitch", { fields: { answer: "hook" } }, root);
      const answer = written.fields.find((field) => field.key === "answer");
      assert.equal(answer?.type, "answer");
      assert.equal(answer?.value, "hook");
      assert.equal(JSON.parse(await readFile(file, "utf8")).modeSwitch.answer, "hook");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("the write path", () => {
  it("leaves the directory clean and the file whole after a write", async () => {
    const root = await fixture();
    try {
      await writeGate("lessThanInputWords", { fields: { words: 3 } }, root);
      const names = await readdir(root);
      assert.deepEqual(names.filter((name) => name.endsWith(".tmp")), []);
      assert.equal(JSON.parse(await readFile(path.join(root, "config.json"), "utf8")).lessThanInputWords.words, 3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
