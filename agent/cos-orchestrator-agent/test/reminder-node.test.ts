import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  formatDue,
  formatReminderTable,
  isReminderUnsure,
  parseReminderOutput,
  reminderContextBlock,
  reminderHintBlock,
  reminderOutcomeLines,
  reminderTelegramReply,
  reminderTraceLines,
  runReminderCommand,
  runReminderNode,
} from "../src/reminder-node.ts";
import { readReminderNode } from "../src/global-config.ts";

async function withGroupedRoot<T>(run: (env: NodeJS.ProcessEnv, configFile: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "reminder-config-"));
  const grouped = path.join(root, "pi-agents-experts-grouped");
  const agent = path.join(grouped, "cos-orchestrator-agent", "cos-orchestrator-agent");
  try {
    await mkdir(agent, { recursive: true });
    return await run({ PI_CODING_AGENT_DIR: agent }, path.join(grouped, "config.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const WINNER = { class: "reminder", band: "act", confidence: 0.97, vetoed_by: [], capped_by: [] };

const LOGGED = JSON.stringify({
  node: "reminder",
  abstained: false,
  reason: null,
  winner: WINNER,
  model: "jev-1.14.0",
  latency_ms: 300,
  routes: [
    { destination: "do:reminder:log", status: "logged", note: "r-20261105-ab12 · Buy milk · due Fri 06 Nov 06:00",
      reminder: { id: "r-20261105-ab12", title: "Buy milk", due: "2026-11-06T06:00:00+00:00" } },
    { destination: "do:reminder:calendar", status: "created", note: "Reminder: Buy milk",
      event: { id: "e1", link: "https://calendar.google.com/event?eid=e1", start: "2026-11-06T06:00:00+00:00" } },
  ],
});

const DONE = JSON.stringify({
  node: "reminder",
  abstained: false,
  winner: { ...WINNER, class: "reminder_done" },
  routes: [{ destination: "do:reminder:done", status: "done", id: "r-20261105-ab12", title: "Buy milk",
    event: "deleted", note: "r-20261105-ab12 · Buy milk · event deleted · match 0.95" }],
});

const NO_MATCH = JSON.stringify({
  node: "reminder",
  abstained: false,
  winner: { ...WINNER, class: "reminder_done" },
  routes: [{ destination: "do:reminder:done", status: "no-match", note: "no pending reminder matched",
    pending: [{ id: "r-20261105-ab12", title: "Buy milk", due: "2026-11-06T06:00:00+00:00" }] }],
});

const HINT = JSON.stringify({
  node: "reminder",
  abstained: false,
  winner: { ...WINNER, band: "hint", confidence: 0.66 },
  routes: [{ destination: "hint:reminder", status: "hint", note: "maybe a reminder (0.66) - ask before writing" }],
});

describe("parseReminderOutput", () => {
  it("reads a logged reminder and its event", () => {
    const verdict = parseReminderOutput(LOGGED);
    assert.equal(verdict.winner, "reminder");
    assert.equal(verdict.band, "act");
    assert.equal(verdict.routes[0].reminder?.id, "r-20261105-ab12");
    assert.equal(verdict.routes[1].event?.link, "https://calendar.google.com/event?eid=e1");
  });

  it("reads what happened to the event on done", () => {
    assert.equal(parseReminderOutput(DONE).routes[0].eventAction, "deleted");
  });

  it("refuses output that cannot be trusted", () => {
    assert.throws(() => parseReminderOutput("junk"));
    assert.throws(() => parseReminderOutput(JSON.stringify({ routes: [] })), /abstained/);
    assert.throws(() => parseReminderOutput(JSON.stringify({ abstained: false })), /winner/);
  });
});

describe("reminder outcome", () => {
  it("states the reminder, its due time and the event link", () => {
    const lines = reminderOutcomeLines(parseReminderOutput(LOGGED));
    assert.equal(lines[0], "→ reminder: Buy milk (r-20261105-ab12)");
    assert.equal(lines[1], "  due Fri 06 Nov 06:00");
    assert.match(lines[2], /eid=e1/);
  });

  it("says when the event was not written", () => {
    const row = JSON.parse(LOGGED) as { routes: Array<Record<string, unknown>> };
    row.routes[1] = { destination: "do:reminder:calendar", status: "failed", note: "gog create failed: quota" };
    const lines = reminderOutcomeLines(parseReminderOutput(JSON.stringify(row)));
    assert.match(lines.at(-1) ?? "", /no calendar event: gog create failed/);
  });

  it("reports a closed reminder", () => {
    assert.deepEqual(reminderOutcomeLines(parseReminderOutput(DONE)),
      ["→ done: Buy milk (r-20261105-ab12, event deleted)"]);
  });

  it("reports a Google Task write", () => {
    const row = JSON.stringify({
      node: "reminder",
      abstained: false,
      winner: WINNER,
      routes: [{ destination: "do:reminder:tasks", status: "created",
        task: { id: "T9", title: "Buy milk", due: "2026-11-06T06:00:00+00:00", list_id: "L1" } }],
    });
    const lines = reminderOutcomeLines(parseReminderOutput(row));
    assert.equal(lines[0], "→ reminder: Buy milk (T9)");
    assert.match(lines[2], /Google Tasks/);
  });

  it("drops the arrow on Telegram and adds the trace when asked", () => {
    const text = reminderTelegramReply(parseReminderOutput(LOGGED), true);
    assert.match(text, /^reminder: Buy milk/);
    assert.match(text, /reminder act 0\.970$/);
  });

  it("traces every route", () => {
    const lines = reminderTraceLines(parseReminderOutput(LOGGED));
    assert.ok(lines[0].startsWith("[route] do:reminder:log"));
    assert.ok(lines[1].includes("created"));
  });
});

describe("unsure verdicts", () => {
  it("treats a hint and a done with no match as unsure", () => {
    assert.equal(isReminderUnsure(parseReminderOutput(HINT)), true);
    assert.equal(isReminderUnsure(parseReminderOutput(NO_MATCH)), true);
    assert.equal(isReminderUnsure(parseReminderOutput(LOGGED)), false);
  });

  it("tells the model to ask, and never to use the inbox", () => {
    const block = reminderHintBlock(parseReminderOutput(HINT));
    assert.match(block, /nothing was written/);
    assert.match(block, /docs\/INBOX\.md/);
  });

  it("lists what is still pending when a done matched nothing", () => {
    const block = reminderHintBlock(parseReminderOutput(NO_MATCH));
    assert.match(block, /\/reminder-done <id>/);
    assert.match(block, /pending r-20261105-ab12: Buy milk/);
  });

  it("forbids redoing work in the relay block", () => {
    const block = reminderContextBlock(parseReminderOutput(LOGGED));
    assert.match(block, /already run/);
    assert.match(block, /do not add it to docs\/INBOX\.md/);
  });
});

describe("write switch config", () => {
  it("reads writer store|tasks|off, and maps leftover writes: false to off", async () => {
    await withGroupedRoot(async (env, configFile) => {
      assert.equal(await readReminderNode(env), null);
      await writeFile(configFile, JSON.stringify({ reminderNode: { enabled: true } }), "utf8");
      assert.deepEqual(await readReminderNode(env), { print: true, route: true, writer: "store" });
      await writeFile(configFile, JSON.stringify({ reminderNode: { enabled: true, writes: false, mode: "dry" } }), "utf8");
      assert.deepEqual(await readReminderNode(env), { print: true, route: false, writer: "off" });
      await writeFile(configFile, JSON.stringify({ reminderNode: { enabled: true, writer: "tasks" } }), "utf8");
      assert.equal((await readReminderNode(env))?.writer, "tasks");
      await writeFile(configFile, JSON.stringify({ reminderNode: { enabled: true, writer: "keep" } }), "utf8");
      assert.equal((await readReminderNode(env))?.writer, "off");
    });
  });
});

describe("table", () => {
  it("formats due times in Lisbon", () => {
    assert.equal(formatDue("2026-07-06T05:00:00Z"), "Mon 06 Jul 06:00");
    assert.equal(formatDue(null), "?");
  });

  it("prints one line per reminder", () => {
    const text = formatReminderTable([{ id: "r-20261105-ab12", title: "Buy milk", due: "2026-11-06T06:00:00+00:00", status: "pending" }]);
    assert.match(text.split("\n")[1], /^r-20261105-ab12 +pending +Fri 06 Nov 06:00 +Buy milk$/);
    assert.equal(formatReminderTable([]), "no reminders");
  });
});

describe("running the node", () => {
  let dir = "";
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "reminder-node-"));
  });
  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("passes the shared classification and returns the verdict", async () => {
    const script = path.join(dir, "ok.py");
    const seen = path.join(dir, "argv");
    await writeFile(script, `import sys\nopen(${JSON.stringify(seen)}, "w").write(" ".join(sys.argv[1:]))\nprint(${JSON.stringify(LOGGED)})\n`, "utf8");
    const verdict = await runReminderNode("Remind me to buy milk", { script, classifierJson: "/tmp/p.json" });
    assert.equal(verdict.ok, true);
    assert.match(await readFile(seen, "utf8"), /--classifier-json \/tmp\/p\.json/);
  });

  it("fails open on exit 2 and on junk", async () => {
    const fail = path.join(dir, "fail.py");
    await writeFile(fail, `import sys\nprint("no key", file=sys.stderr)\nsys.exit(2)\n`, "utf8");
    assert.match((await runReminderNode("x", { script: fail })).reason ?? "", /no key/);
    const junk = path.join(dir, "junk.py");
    await writeFile(junk, `print("hello")\n`, "utf8");
    assert.match((await runReminderNode("x", { script: junk })).reason ?? "", /unreadable/);
  });

  it("passes the write switch to the node", async () => {
    const script = path.join(dir, "gate.py");
    const seen = path.join(dir, "gate-argv");
    await writeFile(script, `import sys\nopen(${JSON.stringify(seen)}, "w").write(" ".join(sys.argv[1:]))\nprint(${JSON.stringify(LOGGED)})\n`, "utf8");
    await runReminderNode("Remind me to buy milk", { script, writer: "off" });
    assert.match(await readFile(seen, "utf8"), /--no-writes/);
    await runReminderNode("Remind me to buy milk", { script, writer: "tasks" });
    const tasksArgv = await readFile(seen, "utf8");
    assert.match(tasksArgv, /--writer tasks/);
    assert.doesNotMatch(tasksArgv, /--no-writes/);
    await runReminderNode("Remind me to buy milk", { script, writer: "store" });
    const storeArgv = await readFile(seen, "utf8");
    assert.match(storeArgv, /--writer store/);
    assert.doesNotMatch(storeArgv, /--no-writes/);
  });

  it("runs a table command and returns its JSON", async () => {
    const script = path.join(dir, "list.py");
    await writeFile(script, `import json\nprint(json.dumps([{"id": "r-1", "status": "pending"}]))\n`, "utf8");
    const result = await runReminderCommand(["--list"], { script });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.value, [{ id: "r-1", status: "pending" }]);
  });
});
