import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { archiveRefusal, isReadOnlyArchive, protectedHitFor } from "../src/protected-paths.ts";

const HOME = "/home/tester";
const PATTERNS = [
	".pi/agent/AGENTS.md",
	".pi/agent/extensions/*",
	".pi/agent/docs/runbooks/what-must-remain.md",
	".local/bin/pi-*",
	".pi/agent/settings.json",
];

const hit = (source: string) => protectedHitFor(source, HOME, PATTERNS, HOME);

describe("protectedHitFor", () => {
	it("blocks an exact protected file", () => {
		assert.equal(hit("~/.pi/agent/AGENTS.md")?.pattern, ".pi/agent/AGENTS.md");
	});

	it("blocks the vitals runbook itself", () => {
		assert.equal(hit("~/.pi/agent/docs/runbooks/what-must-remain.md")?.pattern, ".pi/agent/docs/runbooks/what-must-remain.md");
	});

	it("blocks a directory containing protected files", () => {
		assert.ok(hit("~/.pi/agent"));
		assert.ok(hit("~/.pi"));
	});

	it("blocks a glob match and its parent directory", () => {
		assert.ok(hit("~/.pi/agent/extensions/cron.ts"));
		assert.ok(hit("~/.pi/agent/extensions"));
		assert.ok(hit("~/.local/bin/pi-web-master"));
	});

	it("allows ordinary files", () => {
		assert.equal(hit("~/Downloads/report.pdf"), null);
		assert.equal(hit("~/.pi/agent/docs/INBOX.md"), null);
		assert.equal(hit("~/.local/bin/other-tool"), null);
	});
});

describe("archiveRefusal", () => {
	it("refuses a move of a protected path", () => {
		const msg = archiveRefusal(["--source", "~/.pi/agent/AGENTS.md"], HOME, PATTERNS);
		assert.ok(msg?.startsWith("[FAIL] /archive refuses to move"));
		assert.match(msg!, /what-must-remain\.md/);
	});

	it("allows dry-run, list and undo", () => {
		assert.equal(archiveRefusal(["--dry-run", "--source", "~/.pi/agent/AGENTS.md"], HOME, PATTERNS), null);
		assert.equal(archiveRefusal(["--list"], HOME, PATTERNS), null);
		assert.equal(archiveRefusal(["--undo"], HOME, PATTERNS), null);
	});

	it("allows unprotected sources", () => {
		assert.equal(archiveRefusal(["--source", "~/Downloads/old.pdf"], HOME, PATTERNS), null);
	});

	it("never blocks an argv without --source", () => {
		assert.equal(isReadOnlyArchive(["--list"]), true);
		assert.equal(archiveRefusal([], HOME, PATTERNS), null);
	});
});
