import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { appendGolden, parseJevLabel, runCalendarUndo } from "../src/jev-feedback.ts";
import { readReminderNode } from "../src/global-config.ts";

describe("parseJevLabel", () => {
  it("accepts the four labels, with dashes or underscores", () => {
    assert.equal(parseJevLabel("calendar"), "calendar");
    assert.equal(parseJevLabel(" Reminder-Done "), "reminder_done");
    assert.equal(parseJevLabel("none"), "none");
    assert.equal(parseJevLabel("financial"), null);
    assert.equal(parseJevLabel(""), null);
  });
});

describe("appendGolden", () => {
  it("adds a phrase once per label", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "jev-golden-"));
    const file = path.join(dir, "jev-golden.jsonl");
    await writeFile(file, `${JSON.stringify({ text: "Hi", expect: "none", lang: "en", tag: "chat" })}\n`, "utf8");
    assert.equal(await appendGolden("Hi", "none", "calendar:act", file), "unchanged");
    assert.equal(await appendGolden("Hi", "reminder", "none:none", file), "added");
    assert.equal(await appendGolden("Hi", "reminder", "none:none", file), "unchanged");
    const last = JSON.parse((await readFile(file, "utf8")).trim().split("\n").at(-1) ?? "{}") as Record<string, string>;
    assert.deepEqual(last, { text: "Hi", expect: "reminder", lang: "unknown", tag: "jev-wrong:none:none" });
    await rm(dir, { recursive: true, force: true });
  });
});

describe("runCalendarUndo", () => {
  it("returns the node's JSON, or a failure when there is none", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "calendar-undo-"));
    const ok = path.join(dir, "ok.py");
    await writeFile(ok, `import json\nprint(json.dumps({"status": "deleted", "event_id": "e1", "note": "deleted"}))\n`, "utf8");
    assert.equal((await runCalendarUndo(process.env, ok)).status, "deleted");
    const junk = path.join(dir, "junk.py");
    await writeFile(junk, `import sys\nprint("boom", file=sys.stderr)\nsys.exit(1)\n`, "utf8");
    const failed = await runCalendarUndo(process.env, junk);
    assert.equal(failed.status, "failed");
    assert.match(failed.note, /boom/);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("readReminderNode", () => {
  it("is off unless enabled, routes unless mode is dry, and defaults writer to store", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cos-orchestrator-agent-"));
    const { mkdir } = await import("node:fs/promises");
    const agent = path.join(root, "grouped", "cos-orchestrator-agent", "cos-orchestrator-agent");
    await mkdir(agent, { recursive: true });
    const env = { PI_CODING_AGENT_DIR: agent };
    const file = path.join(root, "grouped", "config.json");
    assert.equal(await readReminderNode(env), null);
    await writeFile(file, JSON.stringify({ reminderNode: { enabled: true } }), "utf8");
    assert.deepEqual(await readReminderNode(env), { print: true, route: true, writer: "store" });
    await writeFile(file, JSON.stringify({ reminderNode: { enabled: true, print: false, mode: "dry" } }), "utf8");
    assert.deepEqual(await readReminderNode(env), { print: false, route: false, writer: "store" });
    await rm(root, { recursive: true, force: true });
  });
});
