import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  claimAnnouncement,
  classifyPrompt,
  cleanPrompt,
  lastClassification,
  pruneReview,
  resetJevClassify,
  skipReason,
  winnerLine,
} from "../src/jev-classify.ts";

const PAYLOAD = {
  phrase: "Remind me to buy milk",
  model: "jev-1.14.0",
  winner: { class: "reminder", confidence: 0.97, band: "act", vetoed_by: [], capped_by: [] },
  classes: { reminder: { is_match: true, confidence: 0.97 } },
};

describe("cleanPrompt and skipReason", () => {
  it("strips the surface markup pi adds", () => {
    assert.equal(cleanPrompt("[telegram] Remind me\n[time] 12:00\nto buy milk"), "Remind me to buy milk");
  });

  it("skips commands, code, and a bare path, URL or email", () => {
    assert.equal(skipReason("/reminders"), "slash command");
    assert.equal(skipReason("look at ```ts\nconst a = 1\n```"), "code block");
    assert.equal(skipReason("~/.pi/config.json"), "only a path, URL, or email");
    assert.equal(skipReason("https://example.com/x"), "only a path, URL, or email");
    assert.equal(skipReason("rita@example.com"), "only a path, URL, or email");
  });

  it("classifies ordinary sentences, even with a path inside", () => {
    assert.equal(skipReason("Remind me to buy milk"), null);
    assert.equal(skipReason("Remind me to check ~/.pi/config.json tomorrow"), null);
  });
});

describe("classifyPrompt", () => {
  let dir = "";
  let script = "";
  let counter = "";
  let review = "";

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jev-classify-"));
    script = path.join(dir, "classify.py");
    counter = path.join(dir, "calls");
    review = path.join(dir, "review.jsonl");
    await writeFile(script, [
      "import json, sys",
      `open(${JSON.stringify(counter)}, "a").write("x")`,
      `payload = json.loads(${JSON.stringify(JSON.stringify(PAYLOAD))})`,
      "payload['phrase'] = sys.argv[2]",
      "print(json.dumps(payload))",
    ].join("\n"), "utf8");
  });
  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    resetJevClassify();
    await rm(counter, { force: true });
    await rm(review, { force: true });
  });

  it("asks once per prompt however many hooks ask", async () => {
    const options = { script, reviewFile: review };
    const [first, second] = await Promise.all([
      classifyPrompt("Remind me to buy milk", options),
      classifyPrompt("Remind me to buy milk", options),
    ]);
    assert.equal(first, second);
    assert.equal(first.ok, true);
    assert.equal(first.winner?.class, "reminder");
    assert.equal((await readFile(counter, "utf8")).length, 1);
    const written = JSON.parse(await readFile(first.file ?? "", "utf8")) as { latency_ms?: number };
    assert.equal(typeof written.latency_ms, "number");
    assert.equal(lastClassification()?.text, "Remind me to buy milk");
  });

  it("logs the text for review", async () => {
    await classifyPrompt("[telegram] Remind me to buy milk", { script, reviewFile: review });
    const row = JSON.parse((await readFile(review, "utf8")).trim()) as Record<string, unknown>;
    assert.equal(row.text, "Remind me to buy milk");
    assert.equal(row.surface, "telegram");
    assert.equal(row.winner, "reminder");
  });

  it("does not run the classifier for a skipped prompt", async () => {
    const result = await classifyPrompt("https://example.com", { script, reviewFile: review });
    assert.equal(result.skipped, "only a path, URL, or email");
    await assert.rejects(readFile(counter, "utf8"));
  });

  it("fails open when the classifier is missing", async () => {
    const result = await classifyPrompt("Remind me", { script: path.join(dir, "nope.py"), reviewFile: review });
    assert.equal(result.ok, false);
    assert.match(winnerLine(result), /no verdict/);
  });

  it("announces the winner once per prompt", () => {
    assert.equal(claimAnnouncement("a"), true);
    assert.equal(claimAnnouncement("a"), false);
    assert.equal(claimAnnouncement("b"), true);
  });

  it("prints the winner, band and vetoes", () => {
    const line = winnerLine({ ok: true, text: "x", latencyMs: 300,
      winner: { class: "calendar", confidence: 0.72, band: "hint", vetoed_by: [], capped_by: ["about_someone_else"] } });
    assert.equal(line, "[jev]   winner calendar hint 0.720  vetoes about_someone_else  300 ms");
  });
});

describe("pruneReview", () => {
  it("drops rows older than fourteen days", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "jev-review-"));
    const file = path.join(dir, "review.jsonl");
    const now = new Date("2026-11-20T12:00:00Z");
    await writeFile(file, [
      JSON.stringify({ ts: "2026-11-01T12:00:00Z", text: "old" }),
      JSON.stringify({ ts: "2026-11-10T12:00:00Z", text: "new" }),
      "",
    ].join("\n"), "utf8");
    assert.equal(await pruneReview(file, now), 1);
    assert.match(await readFile(file, "utf8"), /"new"/);
    assert.equal(await pruneReview(file, now), 0);
    await rm(dir, { recursive: true, force: true });
  });
});
