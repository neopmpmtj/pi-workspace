import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { readModeSwitch } from "../src/global-config.ts";
import { classifyPrompt, resetJevClassify, winnerLine } from "../src/jev-classify.ts";
import { isModeAck, markModeAck, resetModeAck } from "../src/mode-ack.ts";
import { promptBuildOptions } from "../src/prompt-build.ts";
import {
  cliRunner,
  detectModeRequest,
  isModeQuestion,
  parseModeState,
  resolveModeOption,
  runModeRequest,
  type CliResult,
  type CliRunner,
} from "../src/mode-switch.ts";

const MODES = [...promptBuildOptions];

const STATE = (mode: string, enabled = true): string => JSON.stringify({
  enabled,
  options: MODES.map((name) => ({ name, enabled: name === mode, prompt: "", config: "{}" })),
});

/** A fake CLI: each call pops the next answer, and every argv tuple is recorded. */
function fakeCli(answers: CliResult[]): { run: CliRunner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run: async (args) => {
      calls.push([...args]);
      const next = answers.shift();
      if (!next) throw new Error("the fake CLI ran out of answers");
      return next;
    },
  };
}

const OK = (stdout: string): CliResult => ({ ok: true, code: 0, stdout, stderr: "", timedOut: false });
const FAIL = (stderr: string, code = 1): CliResult => ({ ok: false, code, stdout: "", stderr, timedOut: false });

/** A temp grouped root: the config these tests read lives beside the agent home. */
async function withConfigRoot<T>(value: unknown, run: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "cos-mode-switch-"));
  const grouped = path.join(root, "pi-agents-experts-grouped");
  const agent = path.join(grouped, "cos-orchestrator-agent", "cos-orchestrator-agent");
  try {
    await mkdir(agent, { recursive: true });
    await writeFile(path.join(grouped, "config.json"), JSON.stringify(value), "utf8");
    return await run({ PI_CODING_AGENT_DIR: agent });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("detectModeRequest - change", () => {
  const changes: [string, string][] = [
    ["change your mode to normal", "normal"],
    ["Change mode to advanced", "advanced"],
    ["change the mode to advanced please", "advanced"],
    ["switch to advanced mode", "advanced"],
    ["switch to mode normal", "normal"],
    ["set your mode to normal", "normal"],
    ["set mode advanced", "advanced"],
    ["go to normal mode", "normal"],
    ["use normal mode", "normal"],
    ["activate advanced mode", "advanced"],
    ["muda o teu modo para normal", "normal"],
    ["muda para modo advanced", "advanced"],
    ["passa para o modo normal", "normal"],
    ["[telegram] change your mode to advanced", "advanced"],
    ['change your mode to "normal"', "normal"],
  ];
  for (const [text, mode] of changes) {
    it(`reads ${JSON.stringify(text)} as a change to ${mode}`, () => {
      assert.deepEqual(detectModeRequest(text), { kind: "change", mode });
    });
  }
});

describe("detectModeRequest - status", () => {
  for (const text of [
    "what mode are you on",
    "what mode are we running on?",
    "what is the current mode",
    "which mode is active?",
    "what's the mode",
    "mode status",
    "mode?",
    "qual é o modo atual",
    "em que modo estás",
    "current mode?",
  ]) {
    it(`reads ${JSON.stringify(text)} as a status question`, () => {
      assert.deepEqual(detectModeRequest(text), { kind: "status" });
    });
  }
});

describe("detectModeRequest - leaves ordinary text alone", () => {
  for (const text of [
    "the mode of transport is the train",
    "I use dark mode in vim",
    "what mode do you recommend for vim",
    "what mode does vim need",
    "commit the changes to mode.ts",
    "Remind me to buy milk tomorrow",
    "/mode normal",
    "the current mode is advanced",
    "look at ```ts\nconst mode = 1\n```",
    "change your mode to the",
    "this is a long paragraph about mode switching that goes on and on, explaining how the various modes behave in different situations and why one would choose the advanced mode over the normal one at all, at length, well past the limit",
  ]) {
    it(`ignores ${JSON.stringify(text.slice(0, 48))}`, () => {
      assert.equal(detectModeRequest(text), null);
    });
  }

  it("does not treat a question about the mode of something as a mode question", () => {
    assert.equal(isModeQuestion("what's the mode of this file"), false);
    assert.equal(isModeQuestion("what is the current mode"), true);
  });
});

describe("parseModeState", () => {
  it("reads the option that is on", () => {
    assert.deepEqual(parseModeState(STATE("2-Development")), { enabled: true, mode: "2-Development", options: [...MODES] });
    assert.deepEqual(parseModeState(STATE("2-Development", false)), { enabled: false, mode: "2-Development", options: [...MODES] });
  });

  it("reports no mode when no option is on", () => {
    assert.deepEqual(parseModeState(JSON.stringify({
      enabled: false,
      options: MODES.map((name) => ({ name, enabled: false })),
    })), { enabled: false, mode: null, options: [...MODES] });
  });

  it("rejects output that is not a mode state", () => {
    assert.equal(parseModeState("not json"), null);
    assert.equal(parseModeState("[]"), null);
    assert.equal(parseModeState("{}"), null);
    assert.equal(parseModeState(JSON.stringify({ options: [] })), null);
    assert.equal(parseModeState(JSON.stringify({ options: [{ enabled: true }] })), null);
  });
});

describe("resolveModeOption", () => {
  const modes = [...promptBuildOptions];

  it("matches the full name, the bare name, the number, or a unique prefix", () => {
    assert.equal(resolveModeOption("2-Development", modes), "2-Development");
    assert.equal(resolveModeOption("2-development", modes), "2-Development");
    assert.equal(resolveModeOption("development", modes), "2-Development");
    assert.equal(resolveModeOption("Personal", modes), "1-Personal");
    assert.equal(resolveModeOption("2", modes), "2-Development");
    assert.equal(resolveModeOption("3-work", modes), "3-Work");
    assert.equal(resolveModeOption("auto", modes), "4-Automatic");
    assert.equal(resolveModeOption("dev", modes), "2-Development");
    assert.equal(resolveModeOption("research", modes), "5-Research");
    assert.equal(resolveModeOption("5", modes), "5-Research");
  });

  it("rejects an unknown name, an empty one, and an ambiguous prefix", () => {
    assert.equal(resolveModeOption("turbo", modes), null);
    assert.equal(resolveModeOption("", modes), null);
    assert.equal(resolveModeOption("a", modes), null);
    assert.equal(resolveModeOption("1", ["1-Personal", "1-Pro"]), null);
  });
});

describe("runModeRequest", () => {
  it("answers a status question from the CLI and stops", async () => {
    const cli = fakeCli([OK(STATE("2-Development"))]);
    const outcome = await runModeRequest("what mode are you on", { run: cli.run });
    assert.ok(outcome);
    assert.equal(outcome.ok, true);
    assert.deepEqual(cli.calls, [["get", "promptBuild", "--json"]]);
    assert.match(outcome.answer, /mode: 2-Development · promptBuild on/);
    assert.match(outcome.ack, /mode is "2-Development"/);
    assert.match(outcome.ack, /Reply in one short line/);
    assert.match(outcome.ack, /Do not run a tool/);
    assert.match(outcome.trace, /\[mode\]  status → ok 2-Development · 1 cli/);
  });

  it("changes the mode with `use` and confirms it by reading back", async () => {
    // The speaker says "development"; the option is "2-Development".
    const cli = fakeCli([OK(STATE("1-Personal")), OK("promptBuild.2-Development is the one option on\n"), OK(STATE("2-Development"))]);
    const outcome = await runModeRequest("change your mode to development", { run: cli.run });
    assert.ok(outcome);
    assert.equal(outcome.ok, true);
    assert.deepEqual(cli.calls, [
      ["get", "promptBuild", "--json"],
      ["use", "promptBuild.2-Development"],
      ["get", "promptBuild", "--json"],
    ]);
    assert.match(outcome.answer, /mode is now 2-Development/);
    assert.match(outcome.ack, /Already executed by the pi-config CLI, which succeeded/);
    assert.match(outcome.ack, /mode is now "2-Development"/);
    assert.match(outcome.ack, /Done — mode is now 2-Development/);
  });

  it("takes the number, the bare name, or the full name", async () => {
    for (const [said, resolved] of [["3", "3-Work"], ["work", "3-Work"], ["3-work", "3-Work"], ["research", "5-Research"]] as const) {
      const cli = fakeCli([OK(STATE("1-Personal")), OK("ok\n"), OK(STATE(resolved))]);
      const outcome = await runModeRequest(`change your mode to ${said}`, { run: cli.run });
      assert.ok(outcome);
      assert.equal(outcome.ok, true, said);
      assert.deepEqual(cli.calls[1], ["use", `promptBuild.${resolved}`]);
    }
  });

  it("never reports success for a mode that does not exist", async () => {
    const cli = fakeCli([OK(STATE("1-Personal"))]);
    const outcome = await runModeRequest("change your mode to turbo", { run: cli.run });
    assert.ok(outcome);
    assert.equal(outcome.ok, false);
    assert.equal(cli.calls.length, 1, "an unknown mode never reaches `use`");
    assert.match(outcome.reason ?? "", /no mode "turbo"/);
    assert.match(outcome.reason ?? "", new RegExp(promptBuildOptions.join(", ")));
    assert.match(outcome.ack, /which FAILED/);
    assert.match(outcome.ack, /did not happen/);
    assert.match(outcome.ack, /Do not claim success/);
    assert.doesNotMatch(outcome.answer, /is now/);
    assert.match(outcome.answer, /change to turbo did not happen/);
  });

  it("never reports success when the CLI refuses the write, and keeps its words", async () => {
    const said = "[FAIL] promptBuild: 2-Development and 3-Work are both enabled.";
    const cli = fakeCli([OK(STATE("1-Personal")), FAIL(said)]);
    const outcome = await runModeRequest("change your mode to 2-Development", { run: cli.run });
    assert.ok(outcome);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, said);
    assert.equal(cli.calls.length, 2, "a failed change is not read back");
    assert.ok(outcome.ack.includes(said), "the CLI's own words survive into the acknowledgement");
    assert.match(outcome.ack, /Do not claim success/);
  });

  it("does not report success when the read-back disagrees with the change", async () => {
    const cli = fakeCli([OK(STATE("1-Personal")), OK("ok\n"), OK(STATE("3-Work"))]);
    const outcome = await runModeRequest("change your mode to 2-Development", { run: cli.run });
    assert.ok(outcome);
    assert.equal(outcome.ok, false);
    assert.match(outcome.reason ?? "", /reads back as 3-Work/);
    assert.match(outcome.ack, /which FAILED/);
  });

  it("treats unparseable CLI output as a failure, not as an empty mode", async () => {
    const cli = fakeCli([OK("this is not JSON\n")]);
    const outcome = await runModeRequest("mode status", { run: cli.run });
    assert.ok(outcome);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, "the CLI printed no mode state");
    assert.match(outcome.ack, /which FAILED/);
  });

  it("treats a timeout as a failure", async () => {
    const cli = fakeCli([{ ok: false, code: null, stdout: "", stderr: "", timedOut: true }]);
    const outcome = await runModeRequest("what mode are you on", { run: cli.run });
    assert.ok(outcome);
    assert.equal(outcome.ok, false);
    assert.match(outcome.reason ?? "", /timed out/);
  });

  it("keeps the status read honest when the section is off", async () => {
    const cli = fakeCli([OK(STATE("2-Development", false))]);
    const outcome = await runModeRequest("what mode are you on", { run: cli.run });
    assert.ok(outcome);
    assert.match(outcome.answer, /promptBuild off/);
    assert.match(outcome.ack, /promptBuild off/);
  });

  it("runs nothing for a message that is not a mode request", async () => {
    const cli = fakeCli([]);
    assert.equal(await runModeRequest("Remind me to buy milk", { run: cli.run }), null);
    assert.equal(cli.calls.length, 0);
  });

  it("exits non-zero from the real CLI runner when the CLI is missing", async () => {
    const run = cliRunner({ cli: path.join(tmpdir(), "no-such-pi-config-cli.ts"), timeoutMs: 10_000 });
    const result = await run(["get", "promptBuild", "--json"]);
    assert.equal(result.ok, false);
    assert.notEqual(result.code, 0);
  });
});

describe("mode acknowledgement marker", () => {
  it("matches only the marked text", () => {
    resetModeAck();
    assert.equal(isModeAck("anything"), false);
    markModeAck("  the replacement  ");
    assert.equal(isModeAck("the replacement"), true);
    assert.equal(isModeAck("the replacement "), true);
    assert.equal(isModeAck("the replacement, extended"), false);
    resetModeAck();
    assert.equal(isModeAck("the replacement"), false);
  });

  it("keeps the JEV classifier away from a mode acknowledgement", async () => {
    resetJevClassify();
    resetModeAck();
    const ack = "Already executed by the pi-config CLI, which succeeded: the agent's mode is now \"2-Development\".";
    markModeAck(ack);
    // A script that does not exist: if the classifier were asked, this would be a failure
    // reason, not a skip.
    const result = await classifyPrompt(ack, { script: path.join(tmpdir(), "no-such-classifier.py") });
    assert.equal(result.ok, false);
    assert.equal(result.skipped, "mode switch");
    assert.equal(winnerLine(result), "[jev]   skipped (mode switch)");
    resetModeAck();
  });

  it("keeps the JEV classifier away from a mode request while the gate is on", async () => {
    await withConfigRoot({ modeSwitch: { enabled: true } }, async (env) => {
      resetJevClassify();
      resetModeAck();
      // A script that does not exist: a classifier call would fail, not skip.
      const result = await classifyPrompt("change your mode to normal", {
        env,
        script: path.join(tmpdir(), "no-such-classifier.py"),
      });
      assert.equal(result.ok, false);
      assert.equal(result.skipped, "mode request");
      assert.equal(winnerLine(result), "[jev]   skipped (mode request)");
    });
  });

  it("classifies a mode-shaped message when the gate is off", async () => {
    await withConfigRoot({ modeSwitch: { enabled: false } }, async (env) => {
      resetJevClassify();
      const result = await classifyPrompt("what mode are you on", {
        env,
        script: path.join(tmpdir(), "no-such-classifier.py"),
      });
      assert.equal(result.skipped, undefined, "the classifier must be attempted");
      assert.ok((result.reason ?? "").length > 0, "a classifier failure is a reason, not a skip");
    });
  });

  it("always skips the acknowledgement, which only exists when the gate was on", async () => {
    await withConfigRoot({ modeSwitch: { enabled: false } }, async (env) => {
      resetJevClassify();
      markModeAck("Already executed by the pi-config CLI, which succeeded: the agent's mode is now \"1-Personal\".");
      const result = await classifyPrompt(
        "Already executed by the pi-config CLI, which succeeded: the agent's mode is now \"1-Personal\".",
        { env, script: path.join(tmpdir(), "no-such-classifier.py") },
      );
      assert.equal(result.skipped, "mode switch");
      resetModeAck();
    });
  });
});

describe("mode switch config", () => {
  it("is off unless the section says enabled: true", async () => {
    await withConfigRoot({ modeSwitch: { enabled: false, print: true } }, async (env) => {
      assert.equal(await readModeSwitch(env), null);
    });
    await withConfigRoot({ modeSwitch: { enabled: "true" } }, async (env) => {
      assert.equal(await readModeSwitch(env), null);
    });
    await withConfigRoot({}, async (env) => {
      assert.equal(await readModeSwitch(env), null);
    });
  });

  it("defaults to print on and to the model answer, and takes hook when it is set", async () => {
    await withConfigRoot({ modeSwitch: { enabled: true } }, async (env) => {
      assert.deepEqual(await readModeSwitch(env), { print: true, answer: "model" });
    });
    await withConfigRoot({ modeSwitch: { enabled: true, print: false } }, async (env) => {
      assert.deepEqual(await readModeSwitch(env), { print: false, answer: "model" });
    });
    await withConfigRoot({ modeSwitch: { enabled: true, answer: "hook" } }, async (env) => {
      assert.deepEqual(await readModeSwitch(env), { print: true, answer: "hook" });
    });
    await withConfigRoot({ modeSwitch: { enabled: true, answer: "shout" } }, async (env) => {
      assert.deepEqual(await readModeSwitch(env), { print: true, answer: "model" });
    });
  });
});
