import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { inputContainsEmail, inputContainsEmailLines } from "../src/input-contains-email.ts";

const script = fileURLToPath(new URL("../src/input-contains-email.ts", import.meta.url));

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

describe("input contains email", () => {
  it("keeps one address and a dotted local part", () => {
    assert.deepEqual(inputContainsEmail("write a@b.com"), [{ address: "a@b.com", local: "a", domain: "b.com" }]);
    assert.deepEqual(inputContainsEmail("first.last@mail.example.co.uk"), [
      { address: "first.last@mail.example.co.uk", local: "first.last", domain: "mail.example.co.uk" },
    ]);
  });

  it("keeps every address", () => {
    assert.deepEqual(inputContainsEmail("a@b.com and c@d.org"), [
      { address: "a@b.com", local: "a", domain: "b.com" },
      { address: "c@d.org", local: "c", domain: "d.org" },
    ]);
  });

  it("reads the address inside mailto and drops a trailing dot", () => {
    assert.deepEqual(inputContainsEmail("mailto:a@b.com"), [{ address: "a@b.com", local: "a", domain: "b.com" }]);
    assert.equal(inputContainsEmail("see a@b.com.")[0]?.address, "a@b.com");
  });

  it("rejects a bare at-name and url userinfo", () => {
    assert.deepEqual(inputContainsEmail("@name"), []);
    assert.deepEqual(inputContainsEmail("https://user@example.com"), []);
    assert.deepEqual(inputContainsEmail("https://user:pass@example.com/a"), []);
  });

  it("writes one block with every address, and no address lines on a miss", () => {
    assert.equal(
      inputContainsEmailLines(inputContainsEmail("a@b.com and c@d.org")),
      "inputContainsEmail\nfound: true\naddress: a@b.com\nlocal: a\ndomain: b.com\naddress: c@d.org\nlocal: c\ndomain: d.org",
    );
    assert.equal(inputContainsEmailLines([]), "inputContainsEmail\nfound: false");
  });
});

describe("input contains email script", () => {
  it("prints true when one or more addresses are present", async () => {
    await withGroupedRoot(async (env, configFile) => {
      await writeFile(configFile, JSON.stringify({ inputContainsEmail: { enabled: true } }), "utf8");
      assert.equal(await runScript("a@b.com and c@d.org", env), "true\n");
      assert.equal(await runScript("no address", env), "false\n");
      await writeFile(configFile, JSON.stringify({ inputContainsEmail: { enabled: true, print: false } }), "utf8");
      assert.equal(await runScript("a@b.com", env), "");
    });
  });
});
