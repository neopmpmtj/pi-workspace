import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { readLessThanInputWords } from "../src/global-config.ts";
import { lessThanInputWords, lessThanInputWordsLines } from "../src/less-than-input-words.ts";

const script = fileURLToPath(new URL("../src/less-than-input-words.ts", import.meta.url));

function runScript(text: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", script], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      err += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || `script exited ${code}`));
      else resolve(out);
    });
    child.stdin.end(text);
  });
}

async function withGroupedRoot<T>(run: (env: NodeJS.ProcessEnv, configFile: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "sm-google-workspace-"));
  const grouped = path.join(root, "pi-agents-experts-grouped");
  const agent = path.join(grouped, "sm-google-workspace", "sm-google-workspace");
  try {
    await mkdir(agent, { recursive: true });
    return await run({ PI_CODING_AGENT_DIR: agent }, path.join(grouped, "config.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function section(enabled: boolean, words?: number, print?: boolean): string {
  return `${JSON.stringify({
    lessThanInputWords: {
      enabled,
      ...(words === undefined ? {} : { words }),
      ...(print === undefined ? {} : { print }),
    },
  })}\n`;
}

describe("less than input words", () => {
  it("is true for an empty string", () => {
    assert.equal(lessThanInputWords("", 6), true);
    assert.equal(lessThanInputWords("   \n\t", 6), true);
  });

  it("is true below the limit and false at the limit", () => {
    assert.equal(lessThanInputWords("one two three four five", 6), true);
    assert.equal(lessThanInputWords("one two three four five six", 6), false);
    assert.equal(lessThanInputWords("one two", 3), true);
    assert.equal(lessThanInputWords("one two three", 3), false);
  });

  it("collapses extra spaces", () => {
    assert.equal(lessThanInputWords("  one   two\tthree  ", 6), true);
  });

  it("writes labeled lines for the agent", () => {
    assert.equal(lessThanInputWordsLines(true), "lessThanInputWords\nfound: true");
    assert.equal(lessThanInputWordsLines(false), "lessThanInputWords\nfound: false");
  });
});

describe("less than input words script", () => {
  it("prints only true or false when the section is enabled with a word limit", async () => {
    await withGroupedRoot(async (env, configFile) => {
      await writeFile(configFile, section(true, 6), "utf8");
      assert.equal(await runScript("one two three", env), "true\n");
      assert.equal(await runScript("one two three four five six", env), "false\n");
      assert.equal(await runScript("", env), "true\n");
      assert.equal(await runScript("  one   two  ", env), "true\n");
    });
  });

  it("prints nothing when words is missing", async () => {
    await withGroupedRoot(async (env, configFile) => {
      await writeFile(configFile, section(true), "utf8");
      assert.equal(await runScript("one two", env), "");
    });
  });

  it("prints nothing when print is false", async () => {
    await withGroupedRoot(async (env, configFile) => {
      await writeFile(configFile, section(true, 6, false), "utf8");
      assert.equal(await runScript("one two", env), "");
    });
  });
});

describe("lessThanInputWords config", () => {
  it("stays off when the file is missing", async () => {
    await withGroupedRoot(async (env) => {
      assert.equal(await readLessThanInputWords(env), null);
    });
  });

  it("stays off when the section is missing", async () => {
    await withGroupedRoot(async (env, configFile) => {
      await writeFile(configFile, "{}\n", "utf8");
      assert.equal(await readLessThanInputWords(env), null);
    });
  });

  it("stays off when enabled is false", async () => {
    await withGroupedRoot(async (env, configFile) => {
      await writeFile(configFile, section(false, 6), "utf8");
      assert.equal(await readLessThanInputWords(env), null);
    });
  });

  it("stays off when enabled is true and words is missing or not a positive integer", async () => {
    await withGroupedRoot(async (env, configFile) => {
      await writeFile(configFile, section(true), "utf8");
      assert.equal(await readLessThanInputWords(env), null);
      await writeFile(configFile, JSON.stringify({ lessThanInputWords: { enabled: true, words: "6" } }), "utf8");
      assert.equal(await readLessThanInputWords(env), null);
      await writeFile(configFile, JSON.stringify({ lessThanInputWords: { enabled: true, words: 0 } }), "utf8");
      assert.equal(await readLessThanInputWords(env), null);
      await writeFile(configFile, JSON.stringify({ lessThanInputWords: { enabled: true, words: 6.5 } }), "utf8");
      assert.equal(await readLessThanInputWords(env), null);
    });
  });

  it("stays off for invalid JSON and for a non-boolean enabled", async () => {
    await withGroupedRoot(async (env, configFile) => {
      await writeFile(configFile, "{ not json", "utf8");
      assert.equal(await readLessThanInputWords(env), null);
      await writeFile(configFile, JSON.stringify({ lessThanInputWords: { enabled: "true", words: 6 } }), "utf8");
      assert.equal(await readLessThanInputWords(env), null);
    });
  });

  it("turns on only for boolean true and an integer word limit", async () => {
    await withGroupedRoot(async (env, configFile) => {
      await writeFile(configFile, section(true, 6), "utf8");
      assert.deepEqual(await readLessThanInputWords(env), { words: 6, print: true });
    });
  });

  it("prints unless print is boolean false", async () => {
    await withGroupedRoot(async (env, configFile) => {
      await writeFile(configFile, section(true, 6, false), "utf8");
      assert.deepEqual(await readLessThanInputWords(env), { words: 6, print: false });
      await writeFile(configFile, JSON.stringify({ lessThanInputWords: { enabled: true, words: 6, print: "false" } }), "utf8");
      assert.deepEqual(await readLessThanInputWords(env), { words: 6, print: true });
    });
  });
});
