import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { readInputContainsEmail, readInputContainsPath, readInputContainsUrl } from "../src/global-config.ts";

async function withGroupedRoot<T>(run: (env: NodeJS.ProcessEnv, configFile: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "keep-agent-"));
  const grouped = path.join(root, "pi-agents-experts-grouped");
  const agent = path.join(grouped, "keep-agent", "keep-agent");
  try {
    await mkdir(agent, { recursive: true });
    return await run({ PI_CODING_AGENT_DIR: agent }, path.join(grouped, "config.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("input gate config", () => {
  it("stays off when the file, the section, or enabled is missing or false", async () => {
    await withGroupedRoot(async (env, configFile) => {
      assert.equal(await readInputContainsPath(env), null);
      await writeFile(configFile, "{ not json", "utf8");
      assert.equal(await readInputContainsUrl(env), null);
      await writeFile(configFile, "{}\n", "utf8");
      assert.equal(await readInputContainsEmail(env), null);
      await writeFile(configFile, JSON.stringify({ inputContainsPath: { enabled: false, print: true } }), "utf8");
      assert.equal(await readInputContainsPath(env), null);
      await writeFile(configFile, JSON.stringify({ inputContainsPath: { enabled: "true" } }), "utf8");
      assert.equal(await readInputContainsPath(env), null);
    });
  });

  it("turns print on unless the value is boolean false", async () => {
    await withGroupedRoot(async (env, configFile) => {
      await writeFile(configFile, JSON.stringify({ inputContainsUrl: { enabled: true } }), "utf8");
      assert.deepEqual(await readInputContainsUrl(env), { print: true });
      await writeFile(configFile, JSON.stringify({ inputContainsEmail: { enabled: true, print: false } }), "utf8");
      assert.deepEqual(await readInputContainsEmail(env), { print: false });
      await writeFile(configFile, JSON.stringify({ inputContainsPath: { enabled: true, print: "false" } }), "utf8");
      assert.deepEqual(await readInputContainsPath(env), { print: true });
    });
  });
});
