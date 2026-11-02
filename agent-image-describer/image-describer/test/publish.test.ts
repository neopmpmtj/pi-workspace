import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { BEGIN, END, publish } from "../scripts/publish.ts";
import { removeDir, tempDir, writeBytes } from "./helpers.ts";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EXTENSION = `export const HELP = { greet: "/greet [--name NAME]" };
export default function (pi) {
  pi.on("session_start", () => {});
  pi.registerCommand("greet", { description: "Say hello", handler: async () => { throw new Error("must not run"); } });
  pi.registerTool({
    name: "greet_tool",
    description: "Greets",
    parameters: { type: "object", properties: { name: { type: "string", description: "Who to greet" } } },
    execute: async () => { throw new Error("must not run"); },
  });
}
`;

async function fixture(): Promise<string> {
  const home = await tempDir();
  await writeBytes(path.join(home, "settings.json"), JSON.stringify({ extensions: ["+extensions/greet/index.ts"] }));
  await writeBytes(path.join(home, "extensions", "greet", "index.ts"), EXTENSION);
  await writeBytes(path.join(home, "agent.json"), `${JSON.stringify({ name: "greeter", launcher: "pi-greeter", purpose: "Greets." }, null, 2)}\n`);
  await writeBytes(path.join(home, "docs", "CALLING.md"), `# greeter\n\nHand-written intro.\n\n${BEGIN}\nold\n${END}\n\n## Output\n\nHand-written outro.\n`);
  return home;
}

describe("publish", () => {
  test("the published agent.json and CALLING.md match this agent's code", async () => {
    const results = await publish(HOME, { check: true });
    for (const result of results) assert.equal(result.changed, false, `${path.relative(HOME, result.path)} is out of date. Run npm run publish:agent.`);
  });

  test("writes commands, tools, and help, and a second run changes nothing", async () => {
    const home = await fixture();
    try {
      assert.deepEqual((await publish(home)).map((result) => result.changed), [true, true]);
      assert.deepEqual((await publish(home)).map((result) => result.changed), [false, false]);

      const manifest = JSON.parse(await readFile(path.join(home, "agent.json"), "utf8"));
      assert.deepEqual(Object.keys(manifest), ["name", "launcher", "purpose", "commands", "tools"]);
      assert.deepEqual(manifest.commands, [{ name: "/greet", description: "Say hello" }]);
      assert.deepEqual(manifest.tools, [{ name: "greet_tool", description: "Greets" }]);

      const calling = await readFile(path.join(home, "docs", "CALLING.md"), "utf8");
      assert.match(calling, /^# greeter\n\nHand-written intro\.\n\n/);
      assert.match(calling, /## Output\n\nHand-written outro\.\n$/);
      assert.match(calling, /### \/greet\n\nSay hello\n\n```text\n\/greet \[--name NAME\]\n```/);
      assert.match(calling, /- `name`: Who to greet/);
      assert.doesNotMatch(calling, /\nold\n/);
    } finally {
      await removeDir(home);
    }
  });

  test("check mode reports a newly registered command and writes nothing", async () => {
    const home = await fixture();
    try {
      await publish(home);
      const extension = path.join(home, "extensions", "greet", "index.ts");
      await writeBytes(extension, EXTENSION.replace("pi.registerTool(", 'pi.registerCommand("wave", { description: "Wave" });\n  pi.registerTool('));
      const before = await readFile(path.join(home, "agent.json"), "utf8");
      assert.deepEqual((await publish(home, { check: true })).map((result) => result.changed), [true, true]);
      assert.equal(await readFile(path.join(home, "agent.json"), "utf8"), before);
    } finally {
      await removeDir(home);
    }
  });

  test("appends the block when the markers are missing, and rejects a broken pair", async () => {
    const home = await fixture();
    try {
      const callingPath = path.join(home, "docs", "CALLING.md");
      await writeBytes(callingPath, "# greeter\n");
      await publish(home);
      assert.match(await readFile(callingPath, "utf8"), new RegExp(`^# greeter\\n\\n${BEGIN}[\\s\\S]*${END}\\n$`));

      await writeBytes(callingPath, `# greeter\n${BEGIN}\n`);
      await assert.rejects(() => publish(home), /broken/);
    } finally {
      await removeDir(home);
    }
  });
});
