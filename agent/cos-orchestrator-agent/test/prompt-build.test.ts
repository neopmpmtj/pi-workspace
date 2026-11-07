import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { readPromptBuild } from "../src/global-config.ts";
import { promptBuildFromSection } from "../src/prompt-build.ts";

async function withGroupedRoot<T>(run: (env: NodeJS.ProcessEnv, configFile: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "cos-orchestrator-agent-"));
  const grouped = path.join(root, "pi-agents-experts-grouped");
  const agent = path.join(grouped, "cos-orchestrator-agent", "cos-orchestrator-agent");
  try {
    await mkdir(agent, { recursive: true });
    return await run({ PI_CODING_AGENT_DIR: agent }, path.join(grouped, "prompt-build-config.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function entry(enabled: boolean, prompt: unknown = "", config: unknown = {}): Record<string, unknown> {
  return { enabled, prompt, config };
}

type ModeName = "1-Personal" | "2-Development" | "3-Work" | "4-Automatic";

function section(on: Partial<Record<ModeName, Record<string, unknown>>>): Record<string, unknown> {
  return {
    enabled: true,
    "1-Personal": on["1-Personal"] ?? entry(false),
    "2-Development": on["2-Development"] ?? entry(false),
    "3-Work": on["3-Work"] ?? entry(false),
    "4-Automatic": on["4-Automatic"] ?? entry(false),
  };
}

describe("promptBuild section", () => {
  it("renders the one enabled option", () => {
    const result = promptBuildFromSection(section({
      "2-Development": entry(true, "stay brief", { tone: "short" }),
    }));
    assert.equal(result.conflict, null);
    assert.equal(result.section, `2-Development\nstay brief\n${JSON.stringify({ tone: "short" }, null, 2)}`);
  });

  it("conflicts when 1-Personal and 2-Development are both on", () => {
    const result = promptBuildFromSection(section({
      "1-Personal": entry(true, "mine", { who: "me" }),
      "2-Development": entry(true, "other", {}),
    }));
    assert.equal(result.section, null);
    assert.equal(result.conflict, "promptBuild: 1-Personal and 2-Development are both enabled");
  });

  it("conflicts when every option is off", () => {
    const result = promptBuildFromSection(section({}));
    assert.equal(result.section, null);
    assert.equal(result.conflict, "promptBuild: enabled but no option is enabled");
  });

  it("sets no section for a blank prompt and an empty config", () => {
    const result = promptBuildFromSection(section({ "2-Development": entry(true, "  ", {}) }));
    assert.equal(result.conflict, null);
    assert.equal(result.section, null);
  });

  it("keeps a blank prompt when the config has fields", () => {
    const result = promptBuildFromSection(section({ "3-Work": entry(true, "", { keep: true }) }));
    assert.equal(result.conflict, null);
    assert.equal(result.section, `3-Work\n\n${JSON.stringify({ keep: true }, null, 2)}`);
  });

  it("treats a non-object config as empty and a non-string prompt as absent", () => {
    const dropped = promptBuildFromSection(section({ "2-Development": entry(true, 4, ["nope"]) }));
    assert.equal(dropped.conflict, null);
    assert.equal(dropped.section, null);
    const kept = promptBuildFromSection(section({ "1-Personal": entry(true, false, { present: 1 }) }));
    assert.equal(kept.section, `1-Personal\n\n${JSON.stringify({ present: 1 }, null, 2)}`);
  });

  it("counts only boolean true, and stays off when the modes file is the only copy", async () => {
    const flagged = promptBuildFromSection(section({ "2-Development": { enabled: "true", prompt: "hi", config: { a: 1 } } }));
    assert.equal(flagged.conflict, "promptBuild: enabled but no option is enabled");
    await withGroupedRoot(async (env, configFile) => {
      assert.equal(await readPromptBuild(env), null);
      await writeFile(configFile, `${JSON.stringify({ promptBuild: { enabled: false } }, null, 2)}\n`, "utf8");
      assert.equal(await readPromptBuild(env), null);
      await writeFile(configFile, `${JSON.stringify({ promptBuild: section({ "2-Development": entry(true, "hello", { a: 1 }) }) }, null, 2)}\n`, "utf8");
      const read = await readPromptBuild(env);
      assert.equal(read?.conflict, null);
      assert.equal(read?.section, `2-Development\nhello\n${JSON.stringify({ a: 1 }, null, 2)}`);
    });
  });
});
