import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANNED, CANNED_DESCRIPTION, DEFAULT_LIMIT, GOG_HELP, parseDriveLimit, parseHours, parseInboxArgs, plan, runCanned } from "../src/gog.ts";
import type { GogResult } from "../src/gog.ts";

describe("parseHours", () => {
  it("defaults to 24 hours with no arguments", () => {
    assert.equal(parseHours(""), 24);
    assert.equal(parseHours("   "), 24);
  });

  it("reads --hours N", () => {
    assert.equal(parseHours("--hours 1"), 1);
    assert.equal(parseHours("--hours 720"), 720);
  });

  it("rejects a missing, non-numeric, or out-of-range value", () => {
    assert.throws(() => parseHours("--hours"), /1 to 720/);
    assert.throws(() => parseHours("--hours soon"), /whole number/);
    assert.throws(() => parseHours("--hours 0"), /1 to 720/);
    assert.throws(() => parseHours("--hours 721"), /1 to 720/);
  });

  it("rejects an unknown argument", () => {
    assert.throws(() => parseHours("--days 3"), /Unknown argument --days/);
  });
});

describe("--limit", () => {
  it("defaults to 20 rows", () => {
    assert.equal(DEFAULT_LIMIT, 20);
    assert.equal(parseInboxArgs("").limit, 20);
    assert.equal(parseDriveLimit(""), 20);
  });

  it("reads a small --limit N alongside --hours", () => {
    assert.deepEqual(parseInboxArgs("--hours 6 --limit 3"), { hours: 6, limit: 3 });
    assert.deepEqual(parseInboxArgs("--limit 3 --hours 6"), { hours: 6, limit: 3 });
    assert.equal(parseDriveLimit("--limit 3"), 3);
  });

  it("reads --limit 0 as all rows", () => {
    assert.equal(parseInboxArgs("--limit 0").limit, 0);
    assert.equal(parseDriveLimit("--limit 0"), 0);
  });

  it("rejects a missing, negative, or non-numeric value", () => {
    assert.throws(() => parseInboxArgs("--limit"), /0 or more/);
    assert.throws(() => parseInboxArgs("--limit -1"), /whole number/);
    assert.throws(() => parseInboxArgs("--limit lots"), /whole number/);
    assert.throws(() => parseDriveLimit("--limit"), /0 or more/);
  });

  it("still refuses other arguments", () => {
    assert.throws(() => parseInboxArgs("--days 3"), /Unknown argument --days/);
    assert.throws(() => parseDriveLimit("--hours 3"), /takes no arguments/);
  });
});

describe("plan", () => {
  it("asks gog for the Drive root and marks folders", () => {
    const drive = plan("gdrive-root", "");
    assert.deepEqual(drive.argv, ["drive", "ls", "--no-input", "--json", "--results-only"]);
    const rows = drive.rows([
      { name: "Archive", mimeType: "application/vnd.google-apps.folder", id: "a1", modifiedTime: "2026-11-01T12:04:54.381Z" },
      { name: "notes.md", mimeType: "text/markdown", id: "b2", modifiedTime: "2026-10-01T00:00:00.000Z" },
    ]);
    assert.equal(rows[0], "Archive\tfolder\ta1\t2026-11-01T12:04:54.381Z");
    assert.equal(rows[1], "notes.md\tfile\tb2\t2026-10-01T00:00:00.000Z");
  });

  it("refuses arguments for the Drive root", () => {
    assert.throws(() => plan("gdrive-root", "--hours 3"), /takes no arguments/);
  });

  it("turns hours into a Gmail search and flattens the rows", () => {
    const inbox = plan("inbox-new", "--hours 6");
    assert.deepEqual(inbox.argv, ["gmail", "search", "is:unread newer_than:6h", "--no-input", "--json", "--results-only"]);
    const rows = inbox.rows([
      { date: "2026-11-01 10:28", from: "Skool <no-reply@skool.com>", subject: "Weekly\n digest", id: "c3" },
    ]);
    assert.equal(rows[0], "2026-11-01 10:28\tSkool <no-reply@skool.com>\tWeekly digest\tc3");
  });

  it("uses 24 hours by default", () => {
    const inbox = plan("inbox-new", "");
    assert.equal(inbox.argv[2], "is:unread newer_than:24h");
  });

  it("carries the limit into the plan", () => {
    assert.equal(plan("inbox-new", "").limit, 20);
    assert.equal(plan("inbox-new", "--limit 5").limit, 5);
    assert.equal(plan("inbox-new", "--limit 0").limit, 0);
    assert.equal(plan("gdrive-root", "").limit, 20);
    assert.equal(plan("gdrive-root", "--limit 0").limit, 0);
  });
});

/** A fake `gog` that answers with one tab-separated row per message, so no network is touched. */
function fakeGog(count: number): (argv: string[]) => Promise<GogResult> {
  return async () => ({
    ok: true,
    text: JSON.stringify(
      Array.from({ length: count }, (_, index) => ({
        date: `2026-11-01 10:${String(index).padStart(2, "0")}`,
        from: `Sender ${index} <s${index}@example.com>`,
        subject: `Subject ${index}`,
        id: `id${index}`,
      })),
    ),
  });
}

describe("runCanned --limit", () => {
  it("prints 20 rows by default and says how many were held back", async () => {
    const outcome = await runCanned("inbox-new", "", 30_000, fakeGog(24));
    assert.equal(outcome.ok, true);
    const lines = outcome.text.split("\n");
    assert.equal(lines.length, 21);
    assert.equal(lines[0], "2026-11-01 10:00\tSender 0 <s0@example.com>\tSubject 0\tid0");
    assert.equal(lines[19], "2026-11-01 10:19\tSender 19 <s19@example.com>\tSubject 19\tid19");
    assert.match(lines[20], /^\+4 more rows not shown \(24 total\); run with --limit 0/);
  });

  it("prints a small --limit and counts the rest", async () => {
    const outcome = await runCanned("inbox-new", "--hours 6 --limit 3", 30_000, fakeGog(24));
    const lines = outcome.text.split("\n");
    assert.equal(lines.length, 4);
    assert.match(lines[2], /\tid2$/);
    assert.match(lines[3], /^\+21 more rows not shown \(24 total\)/);
  });

  it("prints every row with --limit 0 and adds no trailing line", async () => {
    const outcome = await runCanned("inbox-new", "--limit 0", 30_000, fakeGog(24));
    assert.equal(outcome.ok, true);
    const lines = outcome.text.split("\n");
    assert.equal(lines.length, 24);
    assert.match(lines[23], /\tid23$/);
    assert.doesNotMatch(outcome.text, /more row/);
  });

  it("adds no trailing line when the list fits", async () => {
    const outcome = await runCanned("inbox-new", "--limit 0", 30_000, fakeGog(0));
    assert.equal(outcome.text, "nothing found");
    const small = await runCanned("inbox-new", "", 30_000, fakeGog(20));
    assert.equal(small.text.split("\n").length, 20);
    assert.doesNotMatch(small.text, /more row/);
  });

  it("limits /gdrive-root the same way", async () => {
    const drive = async(): Promise<GogResult> => ({
      ok: true,
      text: JSON.stringify(
        Array.from({ length: 25 }, (_, index) => ({
          name: `Item ${index}`,
          mimeType: "text/plain",
          id: `d${index}`,
          modifiedTime: "2026-11-01T00:00:00.000Z",
        })),
      ),
    });
    const outcome = await runCanned("gdrive-root", "--limit 2", 30_000, drive);
    const lines = outcome.text.split("\n");
    assert.equal(lines[0], "Item 0\tfile\td0\t2026-11-01T00:00:00.000Z");
    assert.equal(lines.length, 3);
    assert.match(lines[2], /^\+23 more rows not shown \(25 total\)/);
  });
});

describe("publication shape", () => {
  it("describes and documents every canned command", () => {
    for (const name of CANNED) {
      assert.ok(CANNED_DESCRIPTION[name].length > 20, `${name} needs a description`);
      assert.match(GOG_HELP[name], new RegExp(`^/${name}`));
    }
  });
});
