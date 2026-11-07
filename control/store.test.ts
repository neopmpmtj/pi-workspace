import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { SettingsError, writeGate, writeInputPhrase, writePromptBuild, writeAgentSettings } from "./store.ts";

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "project-dashboard-"));
  await writeFile(path.join(root, "config.json"), `${JSON.stringify({
    lessThanInputWords: { enabled: true, words: 6, print: true },
    calendarNode: { enabled: true, print: true, mode: "route" },
  }, null, 2)}\n`);
  await writeFile(path.join(root, "agent-modes-config.json"), `${JSON.stringify({
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
      personal: { enabled: false, prompt: "", config: {} },
      option1: { enabled: true, prompt: "", config: {} },
      option2: { enabled: false, prompt: "", config: {} },
      option3: { enabled: false, prompt: "", config: {} },
      option4: { enabled: false, prompt: "", config: {} },
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
      const options = ["personal", "option1", "option2", "option3", "option4"].map((name) => ({
        name,
        enabled: name === "personal" || name === "option1",
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
