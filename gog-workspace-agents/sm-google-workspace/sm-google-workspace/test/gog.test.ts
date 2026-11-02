import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANNED, CANNED_DESCRIPTION, GOG_HELP, parseHours, plan } from "../src/gog.ts";

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
});

describe("publication shape", () => {
  it("describes and documents every canned command", () => {
    for (const name of CANNED) {
      assert.ok(CANNED_DESCRIPTION[name].length > 20, `${name} needs a description`);
      assert.match(GOG_HELP[name], new RegExp(`^/${name}`));
    }
  });
});
