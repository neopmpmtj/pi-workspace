import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  contextBlock,
  parseRouteOutput,
  runCalendarRoute,
  traceLines,
} from "../src/calendar-router.ts";

const MATCH = JSON.stringify({
  node: "calendar",
  node_version: "0.1.0",
  utterance_chars: 62,
  abstained: false,
  reason: null,
  calendar: {
    is_match: true,
    confidence: 0.99,
    decision: "venue_date_time",
    threshold: 0.7,
    rules: { states_intention: 0.17, has_venue: 0.99, has_date: 0.99, has_time: 0.99 },
  },
  model: "jev-1.14.0",
  latency_ms: 311,
  routes: [
    {
      destination: "do:calendar:gog",
      status: "ran",
      agent: "sm-google-workspace",
      seconds: 19.2,
      chars: 525,
      answer: "10:30 is free on both candidate dates.",
    },
    { destination: "do:calendar:create", status: "stub", note: "not implemented - next unit" },
  ],
});

const NO_MATCH = JSON.stringify({
  node: "calendar",
  abstained: false,
  reason: null,
  calendar: { is_match: false, confidence: 0.01, decision: "none", threshold: 0.7, rules: {} },
  model: "jev-1.14.0",
  latency_ms: 348,
  routes: [],
});

const ABSTAINED = JSON.stringify({
  node: "calendar",
  abstained: true,
  reason: "classifier_error: TYPESAFE_API_KEY is not set",
  calendar: null,
  routes: [{ destination: "escalate", status: "no-op", note: "fail open - nothing routed" }],
});

describe("parseRouteOutput", () => {
  it("reads a match with its two destinations", () => {
    const verdict = parseRouteOutput(MATCH);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.isMatch, true);
    assert.equal(verdict.confidence, 0.99);
    assert.equal(verdict.decision, "venue_date_time");
    assert.equal(verdict.rules.has_venue, 0.99);
    assert.equal(verdict.routes.length, 2);
    assert.equal(verdict.routes[0].destination, "do:calendar:gog");
    assert.equal(verdict.routes[0].seconds, 19.2);
    assert.equal(verdict.routes[1].status, "stub");
  });

  it("reads a non-match as no destinations", () => {
    const verdict = parseRouteOutput(NO_MATCH);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.isMatch, false);
    assert.deepEqual(verdict.routes, []);
  });

  it("keeps an abstain distinct from a non-match", () => {
    const verdict = parseRouteOutput(ABSTAINED);
    assert.equal(verdict.isMatch, false);
    assert.equal(verdict.abstained, true);
    assert.match(verdict.reason ?? "", /TYPESAFE_API_KEY/);
  });

  it("refuses output that cannot be trusted", () => {
    assert.throws(() => parseRouteOutput("not json"), /JSON|Unexpected/);
    assert.throws(() => parseRouteOutput(JSON.stringify({ calendar: {} })), /abstained/);
    assert.throws(() => parseRouteOutput(JSON.stringify({ abstained: false })), /calendar verdict/);
  });
});

describe("traceLines", () => {
  it("shows the judgment and both destinations on a match", () => {
    const lines = traceLines(parseRouteOutput(MATCH));
    assert.match(lines[0], /^\[jev\]   calendar true 0\.990 \(venue_date_time\)/);
    assert.ok(lines.some((line) => line.includes("do:calendar:gog") && line.includes("ran")));
    assert.ok(lines.some((line) => line.includes("do:calendar:create") && line.includes("stub")));
  });

  it("says nothing was routed on a non-match", () => {
    const lines = traceLines(parseRouteOutput(NO_MATCH));
    assert.match(lines[0], /calendar false/);
    assert.ok(lines.includes("[route] none - ordinary turn"));
  });

  it("reports a missing verdict as a continuing turn", () => {
    const lines = traceLines({ ...parseRouteOutput(NO_MATCH), ok: false, reason: "timed out" });
    assert.deepEqual(lines, ["[calendar] no verdict: timed out - turn continues"]);
  });
});

describe("contextBlock", () => {
  it("forbids repeating the hand-off and claiming a creation", () => {
    const block = contextBlock(parseRouteOutput(MATCH));
    assert.match(block, /already executed/);
    assert.match(block, /Do not call the router or the sibling again/);
    assert.match(block, /Do not claim the event was created/);
    assert.match(block, /10:30 is free/);
    assert.match(block, /do:calendar:create -> stub/);
  });
});

describe("runCalendarRoute", () => {
  let dir = "";
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "calendar-router-"));
  });
  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("returns the verdict from a script that answers", async () => {
    const script = path.join(dir, "ok.py");
    await writeFile(script, `print(${JSON.stringify(MATCH)})\n`, "utf8");
    const verdict = await runCalendarRoute("lunch at Cafe Nero on Friday at 1pm", { script });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.isMatch, true);
  });

  it("fails open when the node exits 2", async () => {
    const script = path.join(dir, "fail.py");
    await writeFile(script, `import sys\nprint("classifier timeout", file=sys.stderr)\nsys.exit(2)\n`, "utf8");
    const verdict = await runCalendarRoute("anything", { script });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason ?? "", /classifier timeout/);
    assert.deepEqual(traceLines(verdict).length, 1);
  });

  it("fails open when the script is missing", async () => {
    const verdict = await runCalendarRoute("anything", { script: path.join(dir, "missing.py") });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason ?? "", /not runnable|no such file/i);
  });

  it("fails open when the output is not a verdict", async () => {
    const script = path.join(dir, "junk.py");
    await writeFile(script, `print("hello")\n`, "utf8");
    const verdict = await runCalendarRoute("anything", { script });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason ?? "", /unreadable/);
  });
});
