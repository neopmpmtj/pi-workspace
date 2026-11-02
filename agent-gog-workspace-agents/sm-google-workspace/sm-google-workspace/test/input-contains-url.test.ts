import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { inputContainsUrl, inputContainsUrlLines } from "../src/input-contains-url.ts";

const script = fileURLToPath(new URL("../src/input-contains-url.ts", import.meta.url));

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

describe("input contains url", () => {
  it("splits a file at the end of an https url and drops the query", () => {
    assert.deepEqual(inputContainsUrl("see https://example.com/a/book.xlsx?x=1"), {
      url: "https://example.com/a/book.xlsx?x=1",
      scheme: "https",
      name: "book.xlsx",
      extension: "xlsx",
      tld: "com",
    });
  });

  it("reads a host as a name and a tld, and does not invent a scheme", () => {
    assert.deepEqual(inputContainsUrl("www.example.com"), {
      url: "www.example.com",
      scheme: "",
      name: "www",
      extension: "",
      tld: "com",
    });
    assert.deepEqual(inputContainsUrl("http://example.com"), {
      url: "http://example.com",
      scheme: "http",
      name: "example",
      extension: "",
      tld: "com",
    });
    assert.equal(inputContainsUrl("example.com/a")?.url, "example.com/a");
    assert.equal(inputContainsUrl("ftp://files.example.com/a")?.scheme, "ftp");
  });

  it("drops a trailing sentence mark", () => {
    assert.equal(inputContainsUrl("go to https://example.com/a.")?.url, "https://example.com/a");
  });

  it("rejects file urls, content urls, filenames, and slash words", () => {
    assert.equal(inputContainsUrl("file:///home/a"), null);
    assert.equal(inputContainsUrl("content://media/external/file/1"), null);
    assert.equal(inputContainsUrl("photo.jpeg"), null);
    assert.equal(inputContainsUrl("and/or"), null);
    assert.equal(inputContainsUrl("10/31/2026"), null);
    assert.equal(inputContainsUrl("/"), null);
  });

  it("writes labeled lines for a hit and a miss", () => {
    assert.equal(
      inputContainsUrlLines(inputContainsUrl("https://example.com/a/book.xlsx")),
      "inputContainsUrl\nfound: true\nurl: https://example.com/a/book.xlsx\nscheme: https\nname: book.xlsx\nextension: xlsx\ntld: com",
    );
    assert.equal(
      inputContainsUrlLines(inputContainsUrl("www.example.com")),
      "inputContainsUrl\nfound: true\nurl: www.example.com\nscheme: \nname: www\nextension: \ntld: com",
    );
    assert.equal(inputContainsUrlLines(null), "inputContainsUrl\nfound: false\nurl: \nscheme: \nname: \nextension: \ntld: ");
  });
});

describe("input contains url script", () => {
  it("prints nothing when print is false", async () => {
    await withGroupedRoot(async (env, configFile) => {
      await writeFile(configFile, JSON.stringify({ inputContainsUrl: { enabled: true, print: true } }), "utf8");
      assert.equal(await runScript("https://example.com", env), "true\n");
      await writeFile(configFile, JSON.stringify({ inputContainsUrl: { enabled: true, print: false } }), "utf8");
      assert.equal(await runScript("https://example.com", env), "");
    });
  });
});
