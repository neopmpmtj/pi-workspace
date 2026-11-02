import assert from "node:assert/strict";
import { utimes } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { compareImages, discoverImages, orderKey } from "../src/discover.ts";
import { removeDir, tempDir, writeBytes, writePng } from "./helpers.ts";

describe("image order", () => {
  test("prefers the photo date, then birth time, then modification time", () => {
    const exif = orderKey({ filename: "a.jpg", takenMs: 50, birthMs: 10, mtimeMs: 1 });
    const birth = orderKey({ filename: "b.jpg", takenMs: null, birthMs: 10, mtimeMs: 1 });
    const missingBirth = orderKey({ filename: "c.jpg", takenMs: null, birthMs: 0, mtimeMs: 40 });
    assert.deepEqual(exif, { time: 50, source: "exif" });
    assert.deepEqual(birth, { time: 10, source: "birth" });
    assert.deepEqual(missingBirth, { time: 40, source: "mtime" });
  });

  test("sorts oldest first and breaks ties with the filename", () => {
    const files = [
      { filename: "b.jpg", takenMs: 20, birthMs: null, mtimeMs: 1 },
      { filename: "a.jpg", takenMs: 20, birthMs: null, mtimeMs: 99 },
      { filename: "c.jpg", takenMs: 5, birthMs: null, mtimeMs: 99 },
    ];
    const names = [...files].sort(compareImages).map((file) => file.filename);
    assert.deepEqual(names, ["c.jpg", "a.jpg", "b.jpg"]);
  });

  test("includes a one-file subfolder and skips a folder that already has two files", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "later.png"));
      await writePng(path.join(dir, "earlier.png"));
      await writeBytes(path.join(dir, "done.png.md"), "already described");
      await writePng(path.join(dir, "done.png"));
      await writePng(path.join(dir, "nested", "only.png"));
      await writePng(path.join(dir, "deep", "inner", "too-deep.png"));
      await writePng(path.join(dir, "full", "a.png"));
      await writeBytes(path.join(dir, "full", "note.txt"), "second file");
      await writeBytes(path.join(dir, "notes.txt"), "not an image");
      const later = new Date(2024, 0, 2);
      const earlier = new Date(2020, 0, 1);
      await utimes(path.join(dir, "later.png"), later, later);
      await utimes(path.join(dir, "earlier.png"), later, later);
      const found = await discoverImages(dir, async (filePath) => {
        return filePath.endsWith("earlier.png") ? earlier.getTime() : null;
      });
      assert.deepEqual(
        found.map((file) => file.filename),
        ["earlier.png", "later.png", "nested/only.png"],
      );
      assert.equal(found[0].timeSource, "exif");
      if (found[1].birthMs != null && found[1].birthMs > 0) assert.equal(found[1].timeSource, "birth");
      else assert.equal(found[1].timeSource, "mtime");
    } finally {
      await removeDir(dir);
    }
  });
});
