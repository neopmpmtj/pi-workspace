import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { recordCommandIfUnsaved } from "../src/session-command.ts";
import { removeDir, tempDir } from "./helpers.ts";

describe("slash command session", () => {
  test("a custom message leaves no file until the command is recorded", async () => {
    const dir = await tempDir();
    try {
      const idle = SessionManager.create(dir, path.join(dir, "idle"));
      const idleFile = idle.getSessionFile();
      assert.ok(idleFile);
      idle.appendCustomMessageEntry("describe-images", "only custom", true);
      assert.equal(existsSync(idleFile), false);

      const session = SessionManager.create(dir, path.join(dir, "saved"));
      const file = session.getSessionFile();
      assert.ok(file);
      assert.equal(recordCommandIfUnsaved(session, "/describe-images --dir ./images", 1), true);
      assert.equal(existsSync(file), true);
      session.appendCustomMessageEntry("describe-images", "the result", true);
      const text = await readFile(file, "utf8");
      assert.ok(text.indexOf("/describe-images --dir ./images") < text.indexOf("the result"));

      assert.equal(recordCommandIfUnsaved(session, "/describe-images --dir ./other", 2), false);
      const saved = await readFile(file, "utf8");
      const users = saved.split("\n").filter((line) => line.includes('"role":"user"'));
      assert.equal(users.length, 1);
      assert.equal(saved.includes("/describe-images --dir ./other"), false);
    } finally {
      await removeDir(dir);
    }
  });
});
