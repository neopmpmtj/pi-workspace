import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import registerArchive from "../extensions/archive/index.ts";
import { parseArchiveArgs, runArchive, splitShellArgs } from "../src/archive-command.ts";

describe("parseArchiveArgs", () => {
  it("takes one path as --source", () => {
    assert.deepEqual(parseArchiveArgs("~/.pi/agent/example.md"), {
      argv: ["--source", "~/.pi/agent/example.md"],
    });
  });

  it("keeps a quoted path as one source", () => {
    assert.deepEqual(splitShellArgs("'/path/with spaces/note.md'"), ["/path/with spaces/note.md"]);
    assert.deepEqual(parseArchiveArgs("'/path/with spaces/note.md'"), {
      argv: ["--source", "/path/with spaces/note.md"],
    });
  });

  it("forwards dry-run and an explicit target", () => {
    assert.deepEqual(parseArchiveArgs("--dry-run --target ~/z.old ~/.pi/agent/example.md"), {
      argv: ["--dry-run", "--target", "~/z.old", "--source", "~/.pi/agent/example.md"],
    });
  });

  it("undo is only the last run", () => {
    assert.deepEqual(parseArchiveArgs("--undo"), { argv: ["--undo"] });
    assert.deepEqual(parseArchiveArgs("--undo --dry-run"), { argv: ["--undo", "--dry-run"] });
    assert.deepEqual(parseArchiveArgs("--undo ~/.pi/agent/example.md"), {
      error: "--undo cannot be combined with a source path",
    });
  });

  it("rejects a missing path, a second path, and an unknown flag", () => {
    assert.deepEqual(parseArchiveArgs(""), { help: true });
    assert.deepEqual(parseArchiveArgs("--help"), { help: true });
    assert.deepEqual(parseArchiveArgs("one.md two.md"), { error: "one source path" });
    assert.deepEqual(parseArchiveArgs("--nope one.md"), { error: "unknown flag --nope" });
  });
});

describe("registerArchive", () => {
  it("answers --help without a chat turn", async () => {
    const registered: Record<string, (args: string, ctx: unknown) => Promise<void>> = {};
    const sent: { content?: string; triggerTurn?: boolean } = {};
    registerArchive({
      registerCommand(name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) {
        registered[name] = options.handler;
      },
      sendMessage(message: { content: string }, options: { triggerTurn?: boolean }) {
        sent.content = message.content;
        sent.triggerTurn = options.triggerTurn;
      },
    } as never);
    assert.ok(registered.archive, "command 'archive' must be registered");
    assert.ok(registered.arquive, "command 'arquive' alias must be registered");
    await registered.archive("--help", {
      cwd: homedir(),
      hasUI: true,
      ui: { notify() {} },
      sessionManager: { getSessionFile() { return undefined; } },
    });
    assert.equal(sent.triggerTurn, false);
    assert.match(sent.content ?? "", /\/archive <path>/);
  });
});

describe("runArchive", () => {
  it("dry-run prints the move and leaves the file in place", async () => {
    const dir = await mkdtemp(path.join(homedir(), ".pi", "archive-command-test-"));
    const source = path.join(dir, "note.md");
    const target = path.join(dir, "out");
    await writeFile(source, "note");
    try {
      const result = await runArchive(
        ["--source", source, "--target", target, "--dry-run"],
        homedir(),
      );
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /\[ok\]/);
      assert.match(result.output, /note\.md/);
      await assert.doesNotReject(writeFile(source, "note", { flag: "r+" }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
