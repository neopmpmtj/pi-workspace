import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileChoice, persist } from "../agent/src/speech-switch.ts";
import { readTelegramVoice, writeTelegramVoice } from "../agent/src/telegram-voice-switch.ts";
import { matchDashboard, stoppedPage } from "./dashboard-proxy.ts";
import { injectShellBar } from "./shell-nav.ts";
import { parseWakewordStatus, runWakeword, writeWakeword } from "./host-switches.ts";
import { parseSnapshot, readVpsSpeech, toggleCommand, VPS_AGENT_UNIT, writeVpsNotes, type Exec, type ExecResult } from "./remote-host.ts";
import { SettingsError } from "./store.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-site-"));
}

describe("speech file shared with the project site", () => {
  it("writes PI_SPEECH_TUI and reads it back", () => {
    const file = join(tempDir(), "pi-speech.env");
    writeFileSync(file, "PI_SPEECH_LANG=en\n", "utf8");
    assert.equal(persist(true, file), undefined);
    assert.equal(fileChoice(file), true);
    assert.match(readFileSync(file, "utf8"), /^PI_SPEECH_LANG=en\nPI_SPEECH_TUI=1\n$/);
  });
});

describe("telegram voice reply mode", () => {
  it("changes replyMode and leaves every other field", () => {
    const file = join(tempDir(), "telegram.json");
    writeFileSync(file, JSON.stringify({ token: "secret", voice: { replyMode: "always", lang: "en" } }, null, 2), "utf8");
    assert.equal(writeTelegramVoice(false, file), undefined);
    const saved = JSON.parse(readFileSync(file, "utf8")) as { token: string; voice: { replyMode: string; lang: string } };
    assert.equal(saved.token, "secret");
    assert.equal(saved.voice.lang, "en");
    assert.equal(saved.voice.replyMode, "manual");
    assert.deepEqual(readTelegramVoice(file), { missing: false, on: false, mode: "manual" });
    assert.equal(writeTelegramVoice(true, file), undefined);
    assert.equal(readTelegramVoice(file).on, true);
    assert.equal(readTelegramVoice(file).mode, "always");
  });

  it("does not create a missing file", () => {
    const file = join(tempDir(), "telegram.json");
    assert.deepEqual(readTelegramVoice(file), { missing: true, on: false, mode: null });
    assert.equal(writeTelegramVoice(true, file), "telegram.json is missing");
    assert.equal(existsSync(file), false);
  });

  it("refuses to write when voice is not an object", () => {
    const file = join(tempDir(), "telegram.json");
    writeFileSync(file, JSON.stringify({ token: "secret", voice: "always" }), "utf8");
    assert.equal(writeTelegramVoice(false, file), "voice is not an object");
    assert.equal(readFileSync(file, "utf8"), JSON.stringify({ token: "secret", voice: "always" }));
  });
});

describe("wakeword status", () => {
  it("reads enabled and running from the status line", () => {
    const text = "enabled=true running=false pid=- phrase=hey pamela threshold=0.6\nowner=0\n";
    assert.deepEqual(parseWakewordStatus(text), { enabled: true, running: false });
    assert.deepEqual(parseWakewordStatus("no status here"), { enabled: false, running: false });
  });

  it("runs the given script and does not start a listener", async () => {
    const dir = tempDir();
    const log = join(dir, "args");
    const script = join(dir, "wakewordctl");
    writeFileSync(script, `#!/bin/sh\necho "$1" >> "${log}"\nif [ "$1" = status ]; then echo "enabled=false running=false pid=- phrase=? threshold=?"; fi\n`, "utf8");
    chmodSync(script, 0o755);
    const state = await writeWakeword(false, script);
    assert.deepEqual(state, { enabled: false, running: false });
    assert.equal(readFileSync(log, "utf8"), "off\nstatus\n");
  });

  it("reports a missing script without spawning one", async () => {
    const result = await runWakeword("on", join(tempDir(), "missing"));
    assert.equal(result.ok, false);
    assert.match(result.text, /control script missing/);
  });

  it("surfaces a script failure", async () => {
    const script = join(tempDir(), "wakewordctl");
    writeFileSync(script, "#!/bin/sh\necho listener-failed >&2\nexit 1\n", "utf8");
    chmodSync(script, 0o755);
    await assert.rejects(() => writeWakeword(true, script), (error: unknown) => {
      assert.ok(error instanceof SettingsError);
      assert.match(error.message, /listener-failed/);
      return true;
    });
  });
});

describe("dashboard paths on 8786", () => {
  it("maps each page onto its own port and leaves the other paths alone", () => {
    assert.deepEqual(matchDashboard("/cos"), { kind: "redirect", location: "/cos/" });
    assert.deepEqual(matchDashboard("/cos/"), { kind: "forward", page: { id: "cos", name: "Cos orchestrator", port: 8787, prefix: "/cos" }, upstreamPath: "/" });
    assert.deepEqual(matchDashboard("/cos/api/data")?.kind, "forward");
    const cos = matchDashboard("/cos/api/data");
    assert.equal(cos?.kind === "forward" ? cos.upstreamPath : "", "/api/data");
    assert.equal(cos?.kind === "forward" ? cos.page.port : 0, 8787);
    const web = matchDashboard("/web-master/app.js");
    assert.equal(web?.kind === "forward" ? web.upstreamPath : "", "/app.js");
    assert.equal(web?.kind === "forward" ? web.page.port : 0, 8789);
    const tasks = matchDashboard("/tasks/api/events");
    assert.equal(tasks?.kind === "forward" ? tasks.upstreamPath : "", "/api/events");
    assert.equal(tasks?.kind === "forward" ? tasks.page.port : 0, 8791);
    assert.equal(matchDashboard("/settings"), undefined);
    assert.equal(matchDashboard("/cosmos"), undefined);
  });

  it("puts the site links on a proxied page and names a stopped dashboard", () => {
    const html = injectShellBar("<body><h1>Cos</h1></body>", "/cos/");
    assert.match(html, /href="\/cos\/" aria-current="page"/);
    assert.match(html, /href="http:\/\/127\.0\.0\.1:5173"/);
    assert.doesNotMatch(html, /href="\/tasks\/" aria-current/);
    assert.match(html, /<h1>Cos<\/h1>/);
    const page = matchDashboard("/tasks/");
    assert.equal(page?.kind, "forward");
    if (page?.kind !== "forward") return;
    const stopped = stoppedPage(page.page);
    assert.match(stopped, /Stopped\./);
    assert.match(stopped, /\/api\/agents\/tasks\/start/);
    assert.match(stopped, /class="pi-shell"/);
    assert.match(stopped, /href="\/tasks\/" aria-current="page"/);
  });
});

describe("the VPS card", () => {
  const status = (telegram: boolean, mode = "always") =>
    JSON.stringify({ host: "vps", file: "/home/pmpmt/.config/pi-speech.env", tui: false, telegram, speak: "ok", mode }) + "\n";

  /** Records every ssh call and answers by command, so no test touches the network. */
  function fakeSsh(answer: (command: string) => ExecResult): { exec: Exec; calls: string[] } {
    const calls: string[] = [];
    const exec: Exec = async (file, args) => {
      const command = args[args.length - 1] ?? "";
      calls.push(`${file} ${args.slice(0, -1).join(" ")} ${command}`);
      return answer(command);
    };
    return { exec, calls };
  }

  it("sends only the two allowlisted shapes, and nothing free-form", () => {
    assert.equal(toggleCommand({ action: "status" }), 'exec "$HOME/.pi/agent/scripts/speech/host-toggle.sh" status');
    assert.equal(
      toggleCommand({ action: "set", key: "telegram", value: "off" }),
      'exec "$HOME/.pi/agent/scripts/speech/host-toggle.sh" set telegram off',
    );
    assert.throws(() => toggleCommand({ action: "set", key: "mode" as never, value: "on" }), /unknown switch/);
    assert.throws(() => toggleCommand({ action: "set", key: "tui", value: "maybe" as never }), /unknown value/);
  });

  it("reads the last JSON line and refuses anything else", () => {
    assert.deepEqual(parseSnapshot(status(false)), {
      host: "vps", file: "/home/pmpmt/.config/pi-speech.env", tui: false, telegram: false, speak: "ok", mode: "always",
    });
    assert.equal(parseSnapshot("not json\n"), undefined);
    assert.equal(parseSnapshot('{"error":"node not found"}'), undefined);
    assert.equal(parseSnapshot('{"telegram":"yes"}'), undefined);
  });

  it("reports the switch and the bridge in one call, over one ssh host", async () => {
    const calls: string[] = [];
    const exec: Exec = async (_file, args) => {
      const command = args[args.length - 1] ?? "";
      calls.push(command);
      return command.includes("host-toggle")
        ? { code: 0, stdout: status(true), stderr: "" }
        : { code: 0, stdout: "active\n", stderr: "" };
    };
    const state = await readVpsSpeech({ host: "neopmpmtj", exec });
    assert.deepEqual(state, { host: "neopmpmtj", reachable: true, notes: { on: true }, mode: "always", bridge: "active", engine: "ok" });
    assert.deepEqual(calls, ['exec "$HOME/.pi/agent/scripts/speech/host-toggle.sh" status', `systemctl --user is-active ${VPS_AGENT_UNIT}`]);
  });

  it("says unreachable with the ssh reason instead of a fake off", async () => {
    const { exec } = fakeSsh(() => ({ code: 255, stdout: "", stderr: "ssh: connect to host neopmpmtj port 22: Connection timed out" }));
    const state = await readVpsSpeech({ host: "neopmpmtj", exec });
    assert.equal(state.reachable, false);
    assert.equal(state.bridge, "unknown");
    assert.match(state.detail ?? "", /Connection timed out/);
  });

  it("writes the note switch and reports what the VPS says afterwards", async () => {
    const { exec, calls } = fakeSsh((command) => {
      if (command.includes("set telegram off")) return { code: 0, stdout: status(false, "manual"), stderr: "" };
      if (command.includes("host-toggle")) return { code: 0, stdout: status(false, "manual"), stderr: "" };
      return { code: 0, stdout: "active\n", stderr: "" };
    });
    const state = await writeVpsNotes(false, { host: "neopmpmtj", exec });
    assert.equal(state.notes.on, false);
    assert.equal(state.mode, "manual");
    assert.equal(calls.length, 3, "one write, then a fresh status and bridge read");
    assert.match(calls[0] ?? "", /set telegram off$/);
  });

  it("does not claim success when the write failed", async () => {
    const { exec } = fakeSsh((command) =>
      command.includes("set telegram")
        ? { code: 3, stdout: '{"error":"could not write /home/pmpmt/.config/pi-speech.env: EACCES"}', stderr: "" }
        : { code: 255, stdout: "", stderr: "ssh: Could not resolve hostname neopmpmtj" },
    );
    const state = await writeVpsNotes(true, { host: "neopmpmtj", exec });
    assert.equal(state.reachable, false);
    assert.match(state.detail ?? "", /resolve hostname|could not write/);
  });
});
