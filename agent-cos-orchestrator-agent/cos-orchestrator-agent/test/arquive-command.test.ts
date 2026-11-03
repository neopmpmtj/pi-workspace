import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import registerArquive from "../extensions/arquive/index.ts";
import { parseArquiveArgs, runArquive, splitShellArgs } from "../src/arquive-command.ts";

describe("parseArquiveArgs", () => {
  it("takes one path as --source", () => {
    assert.deepEqual(parseArquiveArgs("~/.pi/agent/example.md"), {
      argv: ["--source", "~/.pi/agent/example.md"],
    });
  });

  it("keeps a quoted path as one source", () => {
    assert.deepEqual(splitShellArgs("'/path/with spaces/note.md'"), ["/path/with spaces/note.md"]);
    assert.deepEqual(parseArquiveArgs("'/path/with spaces/note.md'"), {
      argv: ["--source", "/path/with spaces/note.md"],
    });
  });

  it("forwards dry-run and an explicit target", () => {
    assert.deepEqual(parseArquiveArgs("--dry-run --target ~/z.old ~/.pi/agent/example.md"), {
      argv: ["--dry-run", "--target", "~/z.old", "--source", "~/.pi/agent/example.md"],
    });
  });

  it("undo is only the last run", () => {
    assert.deepEqual(parseArquiveArgs("--undo"), { argv: ["--undo"] });
    assert.deepEqual(parseArquiveArgs("--undo --dry-run"), { argv: ["--undo", "--dry-run"] });
    assert.deepEqual(parseArquiveArgs("--undo ~/.pi/agent/example.md"), {
      error: "--undo cannot be combined with a source path",
    });
  });

  it("rejects a missing path, a second path, and an unknown flag", () => {
    assert.deepEqual(parseArquiveArgs(""), { help: true });
    assert.deepEqual(parseArquiveArgs("--help"), { help: true });
    assert.deepEqual(parseArquiveArgs("one.md two.md"), { error: "one source path" });
    assert.deepEqual(parseArquiveArgs("--nope one.md"), { error: "unknown flag --nope" });
  });
});

describe("registerArquive", () => {
  it("answers --help without a chat turn", async () => {
    let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
    const sent: { content?: string; triggerTurn?: boolean } = {};
    registerArquive({
      registerCommand(name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) {
        assert.equal(name, "arquive");
        handler = options.handler;
      },
      sendMessage(message: { content: string }, options: { triggerTurn?: boolean }) {
        sent.content = message.content;
        sent.triggerTurn = options.triggerTurn;
      },
    } as never);
    assert.ok(handler);
    await handler("--help", {
      cwd: homedir(),
      hasUI: true,
      ui: { notify() {} },
      sessionManager: { getSessionFile() { return undefined; } },
    });
    assert.equal(sent.triggerTurn, false);
    assert.match(sent.content ?? "", /\/arquive <path>/);
  });
});

describe("runArquive", () => {
  it("dry-run prints the move and leaves the file in place", async () => {
    const dir = await mkdtemp(path.join(homedir(), ".pi", "arquive-command-test-"));
    const source = path.join(dir, "note.md");
    const target = path.join(dir, "out");
    await writeFile(source, "note");
    try {
      const result = await runArquive(
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
