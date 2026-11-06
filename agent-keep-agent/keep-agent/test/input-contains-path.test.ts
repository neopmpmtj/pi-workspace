import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { inputContainsPath, inputContainsPathLines } from "../src/input-contains-path.ts";

const script = fileURLToPath(new URL("../src/input-contains-path.ts", import.meta.url));

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

describe("input contains path", () => {
  it("accepts windows, posix, home, relative, file, and content paths", () => {
    assert.deepEqual(inputContainsPath("C:\\Users\\a"), { path: "C:\\Users\\a", name: "a", extension: "" });
    assert.deepEqual(inputContainsPath("C:/Users/a"), { path: "C:/Users/a", name: "a", extension: "" });
    assert.deepEqual(inputContainsPath("\\\\?\\C:\\Users\\a"), { path: "\\\\?\\C:\\Users\\a", name: "a", extension: "" });
    assert.deepEqual(inputContainsPath("\\\\server\\share"), { path: "\\\\server\\share", name: "share", extension: "" });
    assert.deepEqual(inputContainsPath("//server/share"), { path: "//server/share", name: "share", extension: "" });
    assert.equal(inputContainsPath("/home/a")?.path, "/home/a");
    assert.equal(inputContainsPath("/var/mobile/Containers")?.name, "Containers");
    assert.equal(inputContainsPath("/storage/emulated/0/DCIM")?.name, "DCIM");
    assert.equal(inputContainsPath("~/Documents")?.name, "Documents");
    assert.deepEqual(inputContainsPath("./src/a.ts"), { path: "./src/a.ts", name: "a.ts", extension: "ts" });
    assert.equal(inputContainsPath("../a")?.name, "a");
    assert.equal(inputContainsPath("file:///home/a.jpeg")?.extension, "jpeg");
    assert.equal(inputContainsPath("content://media/external/file/1")?.name, "1");
  });

  it("splits a trailing file and keeps the first path", () => {
    assert.deepEqual(inputContainsPath("C:\\docs\\book.xlsx"), {
      path: "C:\\docs\\book.xlsx",
      name: "book.xlsx",
      extension: "xlsx",
    });
    assert.deepEqual(inputContainsPath("./photo.jpeg"), { path: "./photo.jpeg", name: "photo.jpeg", extension: "jpeg" });
    assert.equal(inputContainsPath("./photo.JPEG")?.extension, "jpeg");
    assert.equal(inputContainsPath("./archive.tar.gz")?.extension, "gz");
    assert.equal(inputContainsPath("/home/a")?.extension, "");
    assert.equal(inputContainsPath("see /home/a then /home/b.txt")?.path, "/home/a");
  });

  it("keeps spaces inside quotes and stops an unquoted path at whitespace", () => {
    assert.equal(inputContainsPath('"C:\\Program Files\\App"')?.path, "C:\\Program Files\\App");
    assert.equal(inputContainsPath("C:\\Program Files\\App")?.path, "C:\\Program");
  });

  it("rejects slash words, dates, web urls, a lone slash, and a bare filename", () => {
    assert.equal(inputContainsPath("and/or"), null);
    assert.equal(inputContainsPath("input/output"), null);
    assert.equal(inputContainsPath("10/31/2026"), null);
    assert.equal(inputContainsPath("https://example.com/a"), null);
    assert.equal(inputContainsPath("http://example.com/a"), null);
    assert.equal(inputContainsPath("/"), null);
    assert.equal(inputContainsPath("\\"), null);
    assert.equal(inputContainsPath("photo.jpeg"), null);
    assert.equal(inputContainsPath("www.example.com"), null);
    assert.equal(inputContainsPath("www.example.com/docs/a"), null);
  });

  it("writes labeled lines for a hit and a miss", () => {
    assert.equal(
      inputContainsPathLines(inputContainsPath("C:\\docs\\book.xlsx")),
      "inputContainsPath\nfound: true\npath: C:\\docs\\book.xlsx\nname: book.xlsx\nextension: xlsx",
    );
    assert.equal(inputContainsPathLines(null), "inputContainsPath\nfound: false\npath: \nname: \nextension: ");
  });
});

describe("input contains path script", () => {
  it("prints true or false only when the section is enabled and print is on", async () => {
    await withGroupedRoot(async (env, configFile) => {
      await writeFile(configFile, JSON.stringify({ inputContainsPath: { enabled: true, print: true } }), "utf8");
      assert.equal(await runScript("/home/a", env), "true\n");
      assert.equal(await runScript("and/or", env), "false\n");
      await writeFile(configFile, JSON.stringify({ inputContainsPath: { enabled: true, print: false } }), "utf8");
      assert.equal(await runScript("/home/a", env), "");
      await writeFile(configFile, JSON.stringify({ inputContainsPath: { enabled: false, print: true } }), "utf8");
      assert.equal(await runScript("/home/a", env), "");
    });
  });
});
