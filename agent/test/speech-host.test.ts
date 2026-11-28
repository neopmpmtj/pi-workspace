import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const SPEAK = fileURLToPath(new URL("../scripts/speech/speak.sh", import.meta.url));
const TOGGLE = fileURLToPath(new URL("../scripts/speech/host-toggle.sh", import.meta.url));

/** Runs a script with a scratch HOME so no test touches the real switches. */
async function script(command: string, args: string[], env: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), "pi-speak-"));
  try {
    const result = await run("bash", [command, ...args], {
      env: { ...process.env, HOME: home, ...env },
      timeout: 30_000,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr, home };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "", home };
  }
}

describe("speak.sh gate for Telegram voice notes", () => {
  it("stays silent, exit 5, and writes no file when the switch is off", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "pi-speak-out-")), "note.ogg");
    const result = await script(SPEAK, ["-t", "hello there", "-o", out], { PI_SPEECH_TELEGRAM: "0" });
    assert.equal(result.code, 5, "exit 5 is the bridge's documented text fallback");
    assert.equal(existsSync(out), false, "no artifact, so no voice note");
  });

  it("is not gated while the switch is on, and absent means on", async () => {
    // Empty text stops it before synthesis with exit 3: proof it got past the gate.
    const off = await script(SPEAK, ["-t", "   ", "-o", "/tmp/never.ogg"], { PI_SPEECH_TELEGRAM: "0" });
    assert.equal(off.code, 5);
    for (const env of [{ PI_SPEECH_TELEGRAM: "1" }, { PI_SPEECH_TELEGRAM: "" }]) {
      const result = await script(SPEAK, ["-t", "   ", "-o", "/tmp/never.ogg"], env);
      assert.equal(result.code, 3, JSON.stringify(env));
    }
  });

  it("never gates the laptop TUI, which has its own switch", async () => {
    const result = await script(SPEAK, ["-t", "   ", "-o", "/tmp/never.ogg", "--play"], { PI_SPEECH_TELEGRAM: "0" });
    assert.equal(result.code, 3, "--play marks local playback and must pass the Telegram gate");
  });
});

describe("host-toggle.sh", () => {
  it("prints one JSON answer for this host", async () => {
    const result = await script(TOGGLE, ["status"]);
    assert.equal(result.code, 0, result.stderr);
    const state = JSON.parse(result.stdout) as { host: string; tui: boolean; telegram: boolean; speak: string };
    assert.equal(typeof state.host, "string");
    assert.equal(state.tui, false, "no file, so the TUI is off");
    assert.equal(state.telegram, true, "no file, so Telegram is not gated");
    // The scratch HOME has no ~/.pi, so speak.sh is honestly reported as missing.
    assert.equal(state.speak, "missing");
  });

  it("writes each key through the one shared rule", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-toggle-"));
    const env = { ...process.env, HOME: home };
    await run("bash", [TOGGLE, "set", "tui", "on"], { env });
    await run("bash", [TOGGLE, "set", "telegram", "off"], { env });
    assert.equal(readFileSync(join(home, ".config", "pi-speech.env"), "utf8"), "PI_SPEECH_TUI=1\nPI_SPEECH_TELEGRAM=0\n");
    const status = JSON.parse((await run("bash", [TOGGLE, "status"], { env })).stdout) as { tui: boolean; telegram: boolean };
    assert.deepEqual(status, { ...status, tui: true, telegram: false });
  });

  it("refuses anything outside the allowlist, and says why", async () => {
    for (const args of [["set", "mode", "on"], ["set", "tui", "maybe"], ["start"]]) {
      const result = await script(TOGGLE, args);
      assert.equal(result.code, 2, args.join(" "));
      assert.match(result.stdout, /"error"/);
    }
  });
});
