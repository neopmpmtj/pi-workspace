import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { BEGIN, END, fetchPublications } from "../scripts/fetch-publications.ts";

const PROSE_BEFORE = "## Sibling agents\n\nDelegate through bash.\n\n";
const PROSE_AFTER = "\n\nA sibling missing from this table: list the manifests.\n";

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function withRoot(run: (root: string, cos: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "cos-fetch-"));
  const cos = path.join(root, "cos", "cos");
  try {
    await mkdir(cos, { recursive: true });
    await writeFile(path.join(cos, "APPEND_SYSTEM.md"), `${PROSE_BEFORE}${BEGIN}\n| old |\n${END}${PROSE_AFTER}`);
    await writeJson(path.join(cos, "agent.json"), { name: "cos", launcher: "pi-cos", defaultPrompt: "/ask", commands: [] });
    const zebra = path.join(root, "zebra", "zebra");
    await writeJson(path.join(zebra, "agent.json"), {
      name: "zebra",
      launcher: "pi-zebra",
      defaultPrompt: "/stripe",
      purpose: "Draws stripes.",
      commands: [{ name: "/stripe" }],
    });
    const alpha = path.join(root, "alpha", "alpha");
    await writeJson(path.join(alpha, "agent.json"), {
      name: "alpha",
      launcher: "pi-alpha",
      defaultPrompt: "/first",
      call: "/first [--dir <abs path>]",
      purpose: "Does first things.",
      latestRun: `${alpha}/latest.md`,
      commands: [{ name: "/first" }, { name: "/second" }],
    });
    await run(root, cos);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("fetchPublications", () => {
  it("rebuilds the table sorted by name and keeps the text around the markers", async () => {
    await withRoot(async (root, cos) => {
      const result = await fetchPublications(cos, { root });
      assert.equal(result.changed, true);
      assert.deepEqual(result.siblings, ["alpha", "zebra"]);
      const text = await readFile(path.join(cos, "APPEND_SYSTEM.md"), "utf8");
      assert.ok(text.startsWith(PROSE_BEFORE));
      assert.ok(text.endsWith(PROSE_AFTER));
      assert.doesNotMatch(text, /\| old \|/);
      const rows = text.split("\n").filter((line) => line.startsWith("| alpha") || line.startsWith("| zebra"));
      assert.equal(rows.length, 2);
      assert.ok(rows[0].startsWith("| alpha"));
      assert.match(rows[0], /`pi-alpha -p "\/first \[--dir <abs path>\]"`/);
      assert.match(rows[0], /Other commands: \/second\./);
      assert.match(rows[0], /Latest run: `latest\.md` in its home\./);
      assert.match(rows[0], /Contract: `docs\/CALLING\.md` in its home\./);
      assert.match(rows[1], /`pi-zebra -p "\/stripe"`/);
      assert.doesNotMatch(rows[1], /Other commands/);
      assert.doesNotMatch(text, /pi-cos/);
    });
  });

  it("changes nothing on a second run, and check mode never writes", async () => {
    await withRoot(async (root, cos) => {
      const target = path.join(cos, "APPEND_SYSTEM.md");
      const before = await readFile(target, "utf8");
      assert.equal((await fetchPublications(cos, { root, check: true })).changed, true);
      assert.equal(await readFile(target, "utf8"), before);
      await fetchPublications(cos, { root });
      assert.equal((await fetchPublications(cos, { root })).changed, false);
    });
  });

  it("fails on an invalid publication without writing", async () => {
    await withRoot(async (root, cos) => {
      await writeJson(path.join(root, "broken", "broken", "agent.json"), { name: "broken", defaultPrompt: "/x", commands: [] });
      const target = path.join(cos, "APPEND_SYSTEM.md");
      const before = await readFile(target, "utf8");
      await assert.rejects(() => fetchPublications(cos, { root }), /broken\/agent\.json: missing launcher/);
      assert.equal(await readFile(target, "utf8"), before);
    });
  });

  it("finds an agent whose repo root holds the home one level down", async () => {
    await withRoot(async (root, cos) => {
      const nested = path.join(root, "group-name", "sm-nested", "sm-nested");
      await writeJson(path.join(nested, "agent.json"), {
        name: "sm-nested",
        launcher: "pi-sm-nested",
        defaultPrompt: "/inbox-new",
        commands: [{ name: "/inbox-new" }],
      });
      const result = await fetchPublications(cos, { root });
      assert.deepEqual(result.siblings, ["alpha", "sm-nested", "zebra"]);
      const text = await readFile(path.join(cos, "APPEND_SYSTEM.md"), "utf8");
      const row = text.split("\n").find((line) => line.startsWith("| sm-nested"));
      assert.ok(row, "the nested agent needs a row");
      assert.match(row, /`\/.*group-name\/sm-nested\/sm-nested`/);
      assert.match(row, /`pi-sm-nested -p "\/inbox-new"`/);
    });
  });

  it("refuses a file without the markers", async () => {
    await withRoot(async (root, cos) => {
      await writeFile(path.join(cos, "APPEND_SYSTEM.md"), PROSE_BEFORE);
      await assert.rejects(() => fetchPublications(cos, { root }), /needs one/);
    });
  });
});
