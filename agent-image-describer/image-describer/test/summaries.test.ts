import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";
import { listSummaries, summaryFromDescription, upsertSummaries, type SummaryRow } from "../src/summaries.ts";
import { removeDir, tempDir } from "./helpers.ts";

describe("summary text", () => {
  test("reads the paragraph under ## Summary and stops at the next heading", () => {
    const text = "## Summary\n\nA dining area with red chairs.\n\n## Counts\n\n- Red chairs: 6\n";
    assert.equal(summaryFromDescription(text), "A dining area with red chairs.");
  });

  test("returns null when the heading is missing, bold, or None", () => {
    assert.equal(summaryFromDescription("Counts\n- chairs: 6\n"), null);
    assert.equal(summaryFromDescription("**Summary**\n\nA room.\n"), null);
    assert.equal(summaryFromDescription("## Summary\n\nNone\n\n## Visible text\n\nNone\n"), null);
    assert.equal(summaryFromDescription("## Summary\n\n   \n"), null);
  });
});

describe("summaries database", () => {
  test("replaces the summary for the same image directory and file", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "logs", "summaries.sqlite");
    const imageDir = path.join(dir, "images", "folder-a");
    try {
      const first = row(imageDir, { summary: "First look.", runId: "run-1", recordedAt: "2026-10-25T07:00:00.000Z" });
      upsertSummaries(file, [first]);
      const replaced = row(imageDir, {
        summary: "A dining area with red chairs.",
        recordedAt: "2026-10-25T08:00:00.000Z",
        mode: "general",
        model: "gpt-6.1-sol",
        runId: "run-2",
      });
      const other = row(path.join(dir, "images", "folder-b"), { summary: "A street facade.", runId: "run-2" });
      upsertSummaries(file, [replaced, other]);
      assert.deepEqual(listSummaries(file), [replaced, other]);
    } finally {
      await removeDir(dir);
    }
  });

  test("adds the catalog columns to a table created without them", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "logs", "summaries.sqlite");
    const imageDir = path.join(dir, "images", "folder-a");
    try {
      await mkdir(path.dirname(file), { recursive: true });
      const db = new DatabaseSync(file);
      db.exec(`CREATE TABLE summaries (
        image_dir TEXT NOT NULL,
        image_file TEXT NOT NULL,
        summary TEXT NOT NULL,
        PRIMARY KEY (image_dir, image_file)
      )`);
      db.prepare("INSERT INTO summaries (image_dir, image_file, summary) VALUES (?, ?, ?)").run(
        imageDir,
        "IMG_0950.HEIC",
        "First look.",
      );
      db.close();
      assert.deepEqual(listSummaries(file), [
        {
          imageDir,
          imageFile: "IMG_0950.HEIC",
          summary: "First look.",
          recordedAt: "",
          mode: "",
          language: "",
          model: "",
          runId: "",
        },
      ]);
      const replaced = row(imageDir, { summary: "A dining area with red chairs.", runId: "run-2" });
      upsertSummaries(file, [replaced]);
      assert.deepEqual(listSummaries(file), [replaced]);
    } finally {
      await removeDir(dir);
    }
  });
});

function row(imageDir: string, overrides: Partial<SummaryRow> = {}): SummaryRow {
  return {
    imageDir,
    imageFile: "IMG_0950.HEIC",
    summary: "A dining area with red chairs.",
    recordedAt: "2026-10-25T08:00:00.000Z",
    mode: "count",
    language: "English",
    model: "deepseek-flash",
    runId: "run-1",
    ...overrides,
  };
}
