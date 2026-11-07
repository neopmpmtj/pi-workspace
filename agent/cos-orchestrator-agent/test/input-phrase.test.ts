import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { readInputPhrase } from "../src/global-config.ts";
import { appendInputPhrase, inputPhraseApplies, inputPhraseFromSection } from "../src/input-phrase.ts";

async function withGroupedRoot<T>(run: (env: NodeJS.ProcessEnv, configFile: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "cos-orchestrator-agent-"));
  const grouped = path.join(root, "pi-agents-experts-grouped");
  const agent = path.join(grouped, "cos-orchestrator-agent", "cos-orchestrator-agent");
  try {
    await mkdir(agent, { recursive: true });
    return await run({ PI_CODING_AGENT_DIR: agent }, path.join(grouped, "input-phrase-config.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function section(options: {
  normal?: boolean | string;
  advanced?: boolean | string;
  append1?: unknown;
  normalPhrase?: unknown;
  advancedPhrase?: unknown;
  normalAllowBlank?: boolean | string;
  advancedAllowBlank?: boolean | string;
}): Record<string, unknown> {
  return {
    inputPhrase: {
      enabled: true,
      append1: options.append1 === undefined ? "Congratulate me for my 31st birthday" : options.append1,
      normal: {
        enabled: options.normal ?? false,
        ...(options.normalAllowBlank === undefined ? {} : { allowBlank: options.normalAllowBlank }),
        phrase: options.normalPhrase === undefined ? "respond in a single sentence" : options.normalPhrase,
      },
      advanced: {
        enabled: options.advanced ?? false,
        ...(options.advancedAllowBlank === undefined ? {} : { allowBlank: options.advancedAllowBlank }),
        phrase: options.advancedPhrase === undefined ? "respond with a brief explanation" : options.advancedPhrase,
      },
    },
  };
}

describe("append input phrase", () => {
  it("puts each phrase on the following line", () => {
    assert.equal(
      appendInputPhrase("hello", ["Congratulate me for my 31st birthday", "respond in a single sentence"]),
      "hello\nCongratulate me for my 31st birthday\nrespond in a single sentence",
    );
  });

  it("drops trailing whitespace on the user text and on each phrase", () => {
    assert.equal(appendInputPhrase("hello\n\n", ["  one line  "]), "hello\none line");
    assert.equal(appendInputPhrase("hello", ["keep\nboth"]), "hello\nkeep\nboth");
  });

  it("keeps a blank line that was included", () => {
    assert.equal(appendInputPhrase("hello", []), "hello");
    assert.equal(appendInputPhrase("hello", ["", ""]), "hello\n\n");
  });

  it("skips extension prompts and slash commands", () => {
    assert.equal(inputPhraseApplies("hello", "interactive"), true);
    assert.equal(inputPhraseApplies("hello", "extension"), false);
    assert.equal(inputPhraseApplies("/skill:name", "interactive"), false);
    assert.equal(inputPhraseApplies("hello", "rpc"), true);
  });
});

describe("inputPhrase config", () => {
  it("stays off when the file, the section, or enabled is missing or not boolean true", async () => {
    await withGroupedRoot(async (env, configFile) => {
      assert.equal(await readInputPhrase(env), null);
      await writeFile(configFile, "{ not json", "utf8");
      assert.equal(await readInputPhrase(env), null);
      await writeFile(configFile, "{}\n", "utf8");
      assert.equal(await readInputPhrase(env), null);
      await writeFile(configFile, JSON.stringify({ inputPhrase: { enabled: false, append1: "x" } }), "utf8");
      assert.equal(await readInputPhrase(env), null);
      await writeFile(configFile, JSON.stringify({ inputPhrase: { enabled: "true", append1: "x" } }), "utf8");
      assert.equal(await readInputPhrase(env), null);
    });
  });

  it("appends append1 and the one enabled option", () => {
    assert.deepEqual(inputPhraseFromSection(section({ normal: true }).inputPhrase as Record<string, unknown>), {
      lines: ["Congratulate me for my 31st birthday", "respond in a single sentence"],
      conflict: null,
    });
    assert.deepEqual(inputPhraseFromSection(section({ advanced: true }).inputPhrase as Record<string, unknown>), {
      lines: ["Congratulate me for my 31st birthday", "respond with a brief explanation"],
      conflict: null,
    });
  });

  it("reads that same pair from input-phrase-config.json", async () => {
    await withGroupedRoot(async (env, modesFile) => {
      const configFile = path.join(path.dirname(modesFile), "config.json");
      await writeFile(configFile, JSON.stringify(section({ normal: true })), "utf8");
      assert.equal(await readInputPhrase(env), null);
      await writeFile(modesFile, JSON.stringify(section({ normal: true })), "utf8");
      assert.deepEqual(await readInputPhrase(env), {
        lines: ["Congratulate me for my 31st birthday", "respond in a single sentence"],
        conflict: null,
      });
    });
  });

  it("conflicts when the section is on and no option is enabled", () => {
    assert.deepEqual(inputPhraseFromSection(section({}).inputPhrase as Record<string, unknown>), {
      lines: [],
      conflict: "inputPhrase: enabled but no option is enabled",
    });
  });

  it("conflicts when more than one option is enabled", () => {
    assert.deepEqual(inputPhraseFromSection(section({ normal: true, advanced: true }).inputPhrase as Record<string, unknown>), {
      lines: [],
      conflict: "inputPhrase: normal and advanced are both enabled",
    });
  });

  it("counts a string true as off", () => {
    assert.deepEqual(inputPhraseFromSection(section({ normal: "true" }).inputPhrase as Record<string, unknown>), {
      lines: [],
      conflict: "inputPhrase: enabled but no option is enabled",
    });
    assert.deepEqual(inputPhraseFromSection(section({ normal: "true", advanced: true }).inputPhrase as Record<string, unknown>), {
      lines: ["Congratulate me for my 31st birthday", "respond with a brief explanation"],
      conflict: null,
    });
  });

  it("appends append1 whenever it is a string, including a blank one", () => {
    assert.deepEqual(
      inputPhraseFromSection(section({ normal: true, append1: "  ", normalPhrase: "  respond  " }).inputPhrase as Record<string, unknown>),
      { lines: ["", "respond"], conflict: null },
    );
    assert.deepEqual(
      inputPhraseFromSection(section({ advanced: true, append1: "" }).inputPhrase as Record<string, unknown>),
      { lines: ["", "respond with a brief explanation"], conflict: null },
    );
  });

  it("skips a blank option phrase unless that option sets allowBlank true", () => {
    assert.deepEqual(
      inputPhraseFromSection(section({ advanced: true, append1: 1, advancedPhrase: "" }).inputPhrase as Record<string, unknown>),
      { lines: [], conflict: null },
    );
    assert.deepEqual(
      inputPhraseFromSection(section({ advanced: true, append1: "hi", advancedPhrase: "  ", advancedAllowBlank: true }).inputPhrase as Record<string, unknown>),
      { lines: ["hi", ""], conflict: null },
    );
    assert.deepEqual(
      inputPhraseFromSection(section({ normal: true, append1: "hi", normalPhrase: "", normalAllowBlank: "true" }).inputPhrase as Record<string, unknown>),
      { lines: ["hi"], conflict: null },
    );
  });
});
