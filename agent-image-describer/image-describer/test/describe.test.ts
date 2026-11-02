import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { commandHelp, parseCommandArgs } from "../src/args.ts";
import { describeImages, failLines, stdoutLines } from "../src/describe.ts";
import { imageCalls } from "../src/metrics.ts";
import { resolveEffort, lookupModel } from "../src/models.ts";
import { OUTPUT_SHAPE, PROMPT_MODES, PROMPT_RULES } from "../src/prompt.ts";
import { listSummaries, summariesPathForLog } from "../src/summaries.ts";
import { chatResponse, errorResponse, removeDir, tempDir, writeBytes, writePng } from "./helpers.ts";

const KEY = "sk-test-secret-value";

describe("arguments", () => {
  test("parses flags and quoted prompts", () => {
    const request = parseCommandArgs(
      `--dir ./images --model gpt-6.1-sol --effort high --timeout 15 --language Portuguese --prompt "keep the date"`,
      "/work",
    );
    assert.equal(request.dir, "./images");
    assert.equal(request.model, "gpt-6.1-sol");
    assert.equal(request.effort, "high");
    assert.equal(request.timeout, 15);
    assert.equal(request.language, "Portuguese");
    assert.equal(request.prompt, "keep the date");
    assert.equal(request.cwd, "/work");
  });

  test("allows an omitted directory, and rejects an unknown flag or a bad timeout", () => {
    const omitted = parseCommandArgs("", "/work");
    assert.equal(omitted.dir, "");
    assert.equal(omitted.cwd, "/work");
    assert.throws(() => parseCommandArgs("--dir ./images --nope 1", "/work"), /Unknown flag .* Use --help\./);
    assert.throws(() => parseCommandArgs("--dir ./images --timeout soon", "/work"), /Invalid timeout/);
  });

  test("prints help for --help and does not parse the other flags", () => {
    const alone = commandHelp("--help");
    const withDir = commandHelp("--help --dir ./images");
    assert.equal(commandHelp("--dir ./images"), undefined);
    assert.ok(alone);
    assert.equal(withDir, alone);
    assert.match(alone, /--mode/);
    assert.match(alone, /--set-default-image-describer-images-dir/);
  });

  test("rejects the old --set-default flag", () => {
    assert.throws(() => parseCommandArgs("--set-default financial", "/work"), /Unknown flag --set-default/);
  });
});

describe("mode", () => {
  test("parses the mode flag", () => {
    const request = parseCommandArgs("--dir ./images --mode financial", "/work");
    assert.equal(request.mode, "financial");
  });

  test("rejects an unknown mode before any request", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      let calls = 0;
      await assert.rejects(
        () =>
          describeImages(
            { dir, cwd: dir, mode: "invoice", log: "runs.jsonl" },
            {
              loadEnvFile: false,
              env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
              fetchImpl: async () => {
                calls += 1;
                return chatResponse("nope");
              },
            },
          ),
        /Unknown mode "invoice"/,
      );
      assert.equal(calls, 0);
    } finally {
      await removeDir(dir);
    }
  });

  test("saves one default mode and a later mode does not change it", async () => {
    const dir = await tempDir();
    try {
      const parsed = parseCommandArgs("--set-default-image-describer-mode financial", dir);
      assert.equal(parsed.setDefaultImageDescriberMode, "financial");
      assert.equal(parsed.dir, "");
      let calls = 0;
      const saved = await describeImages(
        { dir: "", cwd: dir, setDefaultImageDescriberMode: "financial" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
          fetchImpl: async () => {
            calls += 1;
            return chatResponse("nope");
          },
        },
      );
      assert.equal(calls, 0);
      assert.match(saved.text, /Saved default mode financial\./);
      const file = JSON.parse(await readFile(path.join(dir, "default-mode.json"), "utf8")) as Record<string, boolean>;
      assert.deepEqual(file, {
        general: false,
        leisure: false,
        work: false,
        financial: true,
        venue: false,
        detailed: false,
        count: false,
      });
      await writePng(path.join(dir, "a.png"));
      const prompt = await sentPrompt(dir, {});
      assert.match(prompt, /Supplier/);
      const override = await sentPrompt(dir, { mode: "leisure", log: "leisure.jsonl" });
      assert.match(override, /What is happening/);
      const after = JSON.parse(await readFile(path.join(dir, "default-mode.json"), "utf8")) as Record<string, boolean>;
      assert.deepEqual(after, file);
    } finally {
      await removeDir(dir);
    }
  });

  test("saves preset and detailed effort only for the matching default mode", async () => {
    const dir = await tempDir();
    let calls = 0;
    const deps = {
      loadEnvFile: false as const,
      env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
      fetchImpl: async () => {
        calls += 1;
        return chatResponse("nope");
      },
    };
    const presetFile = path.join(dir, "preset-effort.json");
    const detailedFile = path.join(dir, "detailed-effort.json");
    const modeFile = path.join(dir, "default-mode.json");
    const log = path.join(dir, "logs", "saved.sqlite");
    try {
      const parsed = parseCommandArgs("--set-default-image-describer-preset low", dir);
      assert.equal(parsed.setDefaultImageDescriberPreset, "low");
      assert.equal(parsed.dir, "");
      assert.throws(
        () => parseCommandArgs("--set-default-image-describer-mode general --set-default-image-describer-preset low", dir),
        /--set-default-image-describer-images-dir/,
      );
      assert.throws(
        () => parseCommandArgs("--set-default-image-describer-preset low --set-default-image-describer-detailed high", dir),
        /--set-default-image-describer-images-dir/,
      );
      assert.throws(
        () => parseCommandArgs("--set-default-image-describer-detailed low --set-default-image-describer-count high", dir),
        /--set-default-image-describer-images-dir/,
      );

      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberMode: "detailed", setDefaultImageDescriberDetailed: "high", log }, deps),
        /--set-default-image-describer-images-dir/,
      );
      assert.equal(existsSync(modeFile), false);
      assert.equal(existsSync(presetFile), false);
      assert.equal(existsSync(detailedFile), false);
      assert.equal(existsSync(log), false);

      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberDetailed: "low", log }, deps),
        /Detailed effort can be saved only when the default mode is detailed/,
      );
      assert.equal(existsSync(detailedFile), false);

      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberPreset: "turbo", log }, deps),
        /Unknown effort "turbo"/,
      );
      assert.equal(existsSync(presetFile), false);
      assert.equal(calls, 0);

      const preset = await describeImages({ dir: "", cwd: dir, setDefaultImageDescriberPreset: "high", log }, deps);
      assert.match(preset.text, /Saved preset effort high\./);
      assert.equal(preset.record.mode, "general");
      assert.equal(preset.record.requestedEffort, "high");
      assert.deepEqual(JSON.parse(await readFile(presetFile, "utf8")), { effort: "high" });
      assert.equal(existsSync(log), false);
      assert.equal(calls, 0);

      await writePng(path.join(dir, "a.png"));
      const used = await sentRun(dir, { log: "used.jsonl" });
      assert.equal(used.record.mode, "general");
      assert.equal(used.record.requestedEffort, "high");
      assert.equal(used.body.reasoning_effort, "high");
      const override = await sentRun(dir, { effort: "low", log: "override.jsonl" });
      assert.equal(override.record.requestedEffort, "low");
      assert.deepEqual(JSON.parse(await readFile(presetFile, "utf8")), { effort: "high" });

      await describeImages({ dir: "", cwd: dir, setDefaultImageDescriberMode: "detailed" }, deps);
      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberPreset: "low", log }, deps),
        /Preset effort can be saved only when the default mode is general, leisure, work, financial, or venue/,
      );
      assert.deepEqual(JSON.parse(await readFile(presetFile, "utf8")), { effort: "high" });

      const detailed = await describeImages({ dir: "", cwd: dir, setDefaultImageDescriberDetailed: "low", log }, deps);
      assert.match(detailed.text, /Saved detailed effort low\./);
      assert.equal(detailed.record.mode, "detailed");
      assert.deepEqual(JSON.parse(await readFile(detailedFile, "utf8")), { effort: "low" });
      const detailedRun = await sentRun(dir, { log: "detailed.jsonl" });
      assert.equal(detailedRun.record.mode, "detailed");
      assert.equal(detailedRun.record.requestedEffort, "low");
      assert.equal(calls, 0);
      assert.equal(existsSync(log), false);
    } finally {
      await removeDir(dir);
    }
  });

  test("sends a saved mode prompt with the language and the fixed rules", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      const builtIn = await sentPrompt(dir, { mode: "general", log: "before.jsonl" });
      assert.equal(
        builtIn,
        `Describe this image in English. Write separate sections with these headings: Subject, Composition, Colors and lighting, Visible text, Other details. Put dates, times, amounts, currencies, names, and other details useful for understanding invoices, notices, posters, or personal photographs in the section they belong to. ${OUTPUT_SHAPE} ${PROMPT_RULES}`,
      );
      await writeFile(path.join(dir, "prompts.json"), JSON.stringify({ venue: "Find the event in {language}. Name it {language} too." }));
      const edited = await sentPrompt(dir, { mode: "venue", language: "Portuguese", log: "venue.jsonl" });
      assert.equal(edited, `Find the event in Portuguese. Name it Portuguese too. ${OUTPUT_SHAPE} ${PROMPT_RULES}`);
      const untouched = await sentPrompt(dir, { mode: "financial", log: "financial.jsonl" });
      assert.match(untouched, /Supplier/);
      const custom = await sentPrompt(dir, { mode: "venue", prompt: "only this", log: "custom.jsonl" });
      assert.equal(custom, "only this");
      await writeFile(path.join(dir, "prompts.json"), JSON.stringify({ invoice: "x" }));
      await assert.rejects(() => sentPrompt(dir, { mode: "venue", log: "bad.jsonl" }), /Unknown mode "invoice" in prompts.json/);
    } finally {
      await removeDir(dir);
    }
  });

  test("rejects a saved default that marks two modes true", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      await writeFile(
        path.join(dir, "default-mode.json"),
        JSON.stringify({ general: true, leisure: true, work: false, financial: false, venue: false, detailed: false }),
      );
      let calls = 0;
      await assert.rejects(
        () =>
          describeImages(
            { dir, cwd: dir, log: "runs.jsonl" },
            {
              loadEnvFile: false,
              env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
              fetchImpl: async () => {
                calls += 1;
                return chatResponse("nope");
              },
            },
          ),
        /exactly one mode/,
      );
      assert.equal(calls, 0);
    } finally {
      await removeDir(dir);
    }
  });

  test("keeps the general prompt when mode is omitted", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      const prompt = await sentPrompt(dir, {});
      assert.match(prompt, /Subject/);
      assert.match(prompt, /Composition/);
      const line = await ledgerLine(dir);
      assert.equal(line.mode, "general");
    } finally {
      await removeDir(dir);
    }
  });

  test("sends the leisure preset in the requested language", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      const prompt = await sentPrompt(dir, { mode: "leisure", language: "Portuguese" });
      assert.match(prompt, /^Describe this image in Portuguese\./);
      assert.match(prompt, /What is happening/);
      assert.equal((await ledgerLine(dir)).language, "Portuguese");
    } finally {
      await removeDir(dir);
    }
  });

  test("sends the work preset", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      const prompt = await sentPrompt(dir, { mode: "work" });
      assert.match(prompt, /What is being asked/);
      assert.match(prompt, /Dates and deadlines/);
    } finally {
      await removeDir(dir);
    }
  });

  test("sends the venue preset", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      const prompt = await sentPrompt(dir, { mode: "venue" });
      assert.match(prompt, /Description/);
      assert.match(prompt, /Title/);
      assert.match(prompt, /Venue/);
      assert.match(prompt, /Date or time/);
    } finally {
      await removeDir(dir);
    }
  });

  test("sends the detailed preset at the default medium effort", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      const deepseek = await sentRun(dir, { mode: "detailed", log: "deepseek.jsonl" });
      assert.match(deepseek.prompt, /region by region/);
      assert.match(deepseek.prompt, /Subject/);
      assert.match(deepseek.prompt, /Other details/);
      assert.equal(deepseek.record.mode, "detailed");
      assert.equal(deepseek.record.requestedEffort, "medium");
      assert.equal((await ledgerLines(dir, "deepseek.jsonl"))[0]?.effort, "medium");
      assert.equal(deepseek.body.reasoning_effort, "high");
      assert.deepEqual(deepseek.body.thinking, { type: "enabled" });
      await assert.rejects(() => readFile(path.join(dir, "detailed-effort.json")));

      const gpt = await sentRun(
        dir,
        { mode: "detailed", model: "gpt-6.1-sol", log: "gpt.jsonl" },
        { OPENAI_API_KEY: KEY },
      );
      assert.equal(gpt.record.requestedEffort, "medium");
      assert.equal(gpt.body.reasoning_effort, "medium");
      assert.equal(gpt.body.thinking, undefined);

      const gemini = await sentRun(
        dir,
        { mode: "detailed", model: "gemini-3.8-flash", log: "gemini.jsonl" },
        { GEMINI_API_KEY: KEY },
      );
      assert.equal(gemini.record.requestedEffort, "medium");
      const generation = gemini.body.generationConfig as { thinkingConfig?: { thinkingLevel?: string } };
      assert.equal(generation.thinkingConfig?.thinkingLevel, "medium");
    } finally {
      await removeDir(dir);
    }
  });

  test("a saved detailed effort replaces medium, and an explicit effort still wins", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      await writeFile(path.join(dir, "detailed-effort.json"), `${JSON.stringify({ effort: "low" })}\n`);
      const low = await sentRun(dir, { mode: "detailed", log: "low.jsonl" });
      assert.equal(low.record.requestedEffort, "low");
      assert.equal(low.body.reasoning_effort, "low");
      assert.deepEqual(low.body.thinking, { type: "enabled" });

      await writeFile(path.join(dir, "detailed-effort.json"), `${JSON.stringify({ effort: "max" })}\n`);
      const highest = await sentRun(dir, { mode: "detailed", log: "max.jsonl" });
      assert.equal(highest.record.requestedEffort, "max");
      assert.equal(highest.body.reasoning_effort, "max");

      const override = await sentRun(dir, { mode: "detailed", effort: "low", log: "override.jsonl" });
      assert.equal(override.record.requestedEffort, "low");
      assert.equal(override.body.reasoning_effort, "low");

      await writeFile(path.join(dir, "detailed-effort.json"), `${JSON.stringify({ effort: "turbo" })}\n`);
      let calls = 0;
      await assert.rejects(
        () =>
          describeImages(
            { dir, cwd: dir, mode: "detailed", log: "bad.jsonl" },
            {
              loadEnvFile: false,
              env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
              fetchImpl: async () => {
                calls += 1;
                return chatResponse("nope");
              },
            },
          ),
        /Unknown effort "turbo" in detailed-effort.json/,
      );
      assert.equal(calls, 0);
    } finally {
      await removeDir(dir);
    }
  });

  test("an explicit effort wins over detailed mode", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      const run = await sentRun(dir, { mode: "detailed", effort: "low" });
      assert.equal(run.record.requestedEffort, "low");
      assert.equal(run.body.reasoning_effort, "low");
      assert.deepEqual(run.body.thinking, { type: "enabled" });
    } finally {
      await removeDir(dir);
    }
  });

  test("sends the count preset at the default medium effort", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      const run = await sentRun(dir, { mode: "count", log: "count.jsonl" });
      assert.match(run.prompt, /Counts/);
      assert.match(run.prompt, /people, cars, buildings/);
      assert.match(run.prompt, /Visible text/);
      assert.equal(run.record.mode, "count");
      assert.equal(run.record.requestedEffort, "medium");
      assert.equal(run.body.reasoning_effort, "high");
      assert.deepEqual(run.body.thinking, { type: "enabled" });
      await assert.rejects(() => readFile(path.join(dir, "count-effort.json")));
    } finally {
      await removeDir(dir);
    }
  });

  test("a saved count effort replaces medium, and an explicit effort or prompt still wins", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      await writeFile(path.join(dir, "preset-effort.json"), `${JSON.stringify({ effort: "high" })}\n`);
      await writeFile(path.join(dir, "count-effort.json"), `${JSON.stringify({ effort: "low" })}\n`);
      const low = await sentRun(dir, { mode: "count", log: "low.jsonl" });
      assert.equal(low.record.requestedEffort, "low");
      assert.equal(low.body.reasoning_effort, "low");

      const override = await sentRun(dir, { mode: "count", effort: "max", log: "override.jsonl" });
      assert.equal(override.record.requestedEffort, "max");
      assert.deepEqual(JSON.parse(await readFile(path.join(dir, "count-effort.json"), "utf8")), { effort: "low" });

      const custom = await sentRun(dir, { mode: "count", prompt: "only this", log: "custom.jsonl" });
      assert.equal(custom.prompt, "only this");
      assert.equal(custom.record.mode, "custom");
      assert.equal(custom.record.requestedEffort, "none");
      assert.deepEqual(custom.body.thinking, { type: "disabled" });

      await writeFile(path.join(dir, "count-effort.json"), `${JSON.stringify({ effort: "turbo" })}\n`);
      let calls = 0;
      await assert.rejects(
        () =>
          describeImages(
            { dir, cwd: dir, mode: "count", log: "bad.jsonl" },
            {
              loadEnvFile: false,
              env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
              fetchImpl: async () => {
                calls += 1;
                return chatResponse("nope");
              },
            },
          ),
        /Unknown effort "turbo" in count-effort.json/,
      );
      assert.equal(calls, 0);
    } finally {
      await removeDir(dir);
    }
  });

  test("saves count effort only when the default mode is count", async () => {
    const dir = await tempDir();
    const deps = {
      loadEnvFile: false as const,
      env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
      fetchImpl: async () => chatResponse("nope"),
    };
    const countFile = path.join(dir, "count-effort.json");
    const presetFile = path.join(dir, "preset-effort.json");
    try {
      const parsed = parseCommandArgs("--set-default-image-describer-count low", dir);
      assert.equal(parsed.setDefaultImageDescriberCount, "low");
      assert.equal(parsed.dir, "");

      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberCount: "low" }, deps),
        /Count effort can be saved only when the default mode is count/,
      );
      assert.equal(existsSync(countFile), false);

      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberCount: "turbo" }, deps),
        /Count effort can be saved only when the default mode is count/,
      );
      assert.equal(existsSync(countFile), false);

      await describeImages({ dir: "", cwd: dir, setDefaultImageDescriberMode: "count" }, deps);
      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberPreset: "high" }, deps),
        /Preset effort can be saved only when the default mode is general, leisure, work, financial, or venue/,
      );
      assert.equal(existsSync(presetFile), false);

      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberCount: "turbo" }, deps),
        /Unknown effort "turbo"/,
      );
      assert.equal(existsSync(countFile), false);

      const saved = await describeImages({ dir: "", cwd: dir, setDefaultImageDescriberCount: "low" }, deps);
      assert.match(saved.text, /Saved count effort low\./);
      assert.equal(saved.record.mode, "count");
      assert.equal(saved.record.requestedEffort, "low");
      assert.deepEqual(JSON.parse(await readFile(countFile, "utf8")), { effort: "low" });

      await writePng(path.join(dir, "a.png"));
      const run = await sentRun(dir, { log: "used.jsonl" });
      assert.equal(run.record.mode, "count");
      assert.equal(run.record.requestedEffort, "low");
      assert.equal(run.body.reasoning_effort, "low");
    } finally {
      await removeDir(dir);
    }
  });

  test("other modes and a custom prompt keep thinking off on deepseek", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      const venue = await sentRun(dir, { mode: "venue", log: "venue.jsonl" });
      assert.equal(venue.record.requestedEffort, "none");
      assert.equal(venue.body.reasoning_effort, undefined);
      assert.deepEqual(venue.body.thinking, { type: "disabled" });
      const omitted = await sentRun(dir, { log: "omitted.jsonl" });
      assert.equal(omitted.record.mode, "general");
      assert.equal(omitted.record.requestedEffort, "none");
      assert.deepEqual(omitted.body.thinking, { type: "disabled" });
      const custom = await sentRun(dir, { mode: "detailed", prompt: "only this", log: "custom.jsonl" });
      assert.equal(custom.prompt, "only this");
      assert.equal(custom.record.mode, "custom");
      assert.equal(custom.record.requestedEffort, "none");
      assert.deepEqual(custom.body.thinking, { type: "disabled" });
    } finally {
      await removeDir(dir);
    }
  });

  test("a saved preset effort is shared by every mode except detailed and count", async () => {
    const dir = await tempDir();
    const deps = { loadEnvFile: false as const, env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir } };
    try {
      await writePng(path.join(dir, "a.png"));
      await writeFile(path.join(dir, "preset-effort.json"), `${JSON.stringify({ effort: "high" })}\n`);
      await writeFile(path.join(dir, "detailed-effort.json"), `${JSON.stringify({ effort: "low" })}\n`);

      await writeFile(path.join(dir, "count-effort.json"), `${JSON.stringify({ effort: "max" })}\n`);

      for (const mode of PROMPT_MODES) {
        if (mode === "detailed" || mode === "count") continue;
        const run = await sentRun(dir, { mode, log: `${mode}.jsonl` });
        assert.equal(run.record.mode, mode);
        assert.equal(run.record.requestedEffort, "high");
        assert.equal(run.body.reasoning_effort, "high");
        assert.deepEqual(run.body.thinking, { type: "enabled" });
      }

      const detailed = await sentRun(dir, { mode: "detailed", log: "detailed.jsonl" });
      assert.equal(detailed.record.requestedEffort, "low");
      assert.equal(detailed.body.reasoning_effort, "low");

      const counted = await sentRun(dir, { mode: "count", log: "count.jsonl" });
      assert.equal(counted.record.requestedEffort, "max");
      assert.equal(counted.body.reasoning_effort, "max");

      const override = await sentRun(dir, { mode: "venue", effort: "low", log: "override.jsonl" });
      assert.equal(override.record.requestedEffort, "low");
      assert.equal(override.body.reasoning_effort, "low");

      const custom = await sentRun(dir, { mode: "leisure", prompt: "only this", log: "custom.jsonl" });
      assert.equal(custom.record.mode, "custom");
      assert.equal(custom.record.requestedEffort, "none");
      assert.deepEqual(custom.body.thinking, { type: "disabled" });

      const gpt = await sentRun(
        dir,
        { mode: "work", model: "gpt-6.1-sol", log: "gpt.jsonl" },
        { OPENAI_API_KEY: KEY },
      );
      assert.equal(gpt.record.requestedEffort, "high");
      assert.equal(gpt.body.reasoning_effort, "high");

      await writeFile(path.join(dir, "preset-effort.json"), `${JSON.stringify({ effort: "none" })}\n`);
      const off = await sentRun(dir, { mode: "financial", log: "none.jsonl" });
      assert.equal(off.record.requestedEffort, "none");
      assert.equal(off.body.reasoning_effort, undefined);
      assert.deepEqual(off.body.thinking, { type: "disabled" });

      await writeFile(path.join(dir, "preset-effort.json"), `${JSON.stringify({ effort: "high" })}\n`);
      await describeImages({ dir: "", cwd: dir, setDefaultImageDescriberMode: "leisure" }, deps);
      const saved = await sentRun(dir, { log: "saved.jsonl" });
      assert.equal(saved.record.mode, "leisure");
      assert.equal(saved.record.requestedEffort, "high");

      await writeFile(path.join(dir, "preset-effort.json"), `${JSON.stringify({ effort: "turbo" })}\n`);
      let calls = 0;
      await assert.rejects(
        () =>
          describeImages(
            { dir, cwd: dir, mode: "general", log: "bad.jsonl" },
            {
              ...deps,
              fetchImpl: async () => {
                calls += 1;
                return chatResponse("nope");
              },
            },
          ),
        /Unknown effort "turbo" in preset-effort.json/,
      );
      assert.equal(calls, 0);
    } finally {
      await removeDir(dir);
    }
  });

  test("a saved detailed default raises effort when mode and effort are omitted", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      await describeImages(
        { dir: "", cwd: dir, setDefaultImageDescriberMode: "detailed" },
        { loadEnvFile: false, env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir } },
      );
      const run = await sentRun(dir, {});
      assert.equal(run.record.mode, "detailed");
      assert.equal(run.record.requestedEffort, "medium");
      assert.equal(run.body.reasoning_effort, "high");
    } finally {
      await removeDir(dir);
    }
  });

  test("turning another mode on returns deepseek effort to off", async () => {
    const dir = await tempDir();
    const deps = { loadEnvFile: false as const, env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir } };
    try {
      await writePng(path.join(dir, "a.png"));
      await describeImages({ dir: "", cwd: dir, setDefaultImageDescriberMode: "detailed" }, deps);
      const raised = await sentRun(dir, { log: "detailed.jsonl" });
      assert.equal(raised.record.mode, "detailed");
      assert.equal(raised.record.requestedEffort, "medium");
      assert.equal(raised.body.reasoning_effort, "high");
      assert.deepEqual(raised.body.thinking, { type: "enabled" });

      for (const mode of PROMPT_MODES) {
        if (mode === "detailed" || mode === "count") continue;
        await describeImages({ dir: "", cwd: dir, setDefaultImageDescriberMode: mode }, deps);
        const run = await sentRun(dir, { log: `${mode}.jsonl` });
        assert.equal(run.record.mode, mode);
        assert.equal(run.record.requestedEffort, "none");
        assert.equal(run.body.reasoning_effort, undefined);
        assert.deepEqual(run.body.thinking, { type: "disabled" });
      }
    } finally {
      await removeDir(dir);
    }
  });

  test("loads a saved default that omits the detailed key", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      await writeFile(
        path.join(dir, "default-mode.json"),
        JSON.stringify({ general: false, leisure: true, work: false, financial: false, venue: false }),
      );
      const run = await sentRun(dir, {});
      assert.match(run.prompt, /What is happening/);
      assert.equal(run.record.mode, "leisure");
      assert.equal(run.record.requestedEffort, "none");
    } finally {
      await removeDir(dir);
    }
  });

  test("sends the financial preset", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      const prompt = await sentPrompt(dir, { mode: "financial" });
      assert.match(prompt, /Supplier/);
      assert.match(prompt, /Line items/);
      assert.match(prompt, /Tax/);
      assert.match(prompt, /Total/);
      assert.match(prompt, /as printed/);
      assert.match(prompt, /"None"/);
    } finally {
      await removeDir(dir);
    }
  });

  test("a custom prompt replaces the selected mode", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      const prompt = await sentPrompt(dir, { mode: "financial", prompt: "PROMPT_SENTINEL_only" });
      assert.equal(prompt, "PROMPT_SENTINEL_only");
      assert.equal(prompt.includes("Supplier"), false);
    } finally {
      await removeDir(dir);
    }
  });

  test("records the mode on each ledger line and not the prompt text", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      await writePng(path.join(dir, "b.png"));
      await sentPrompt(dir, { mode: "financial", log: "financial.jsonl" });
      const financial = await ledgerLines(dir, "financial.jsonl");
      assert.equal(financial.length, 2);
      for (const line of financial) {
        assert.equal(line.mode, "financial");
        assert.equal(line.effort, "none");
        assert.equal(line.language, "English");
        assert.equal(JSON.stringify(line).includes("Describe this image"), false);
      }
      await sentPrompt(dir, { prompt: "PROMPT_SENTINEL_only", log: "custom.jsonl" });
      const custom = await ledgerLines(dir, "custom.jsonl");
      assert.equal(custom.length, 2);
      for (const line of custom) {
        assert.equal(line.mode, "custom");
        assert.equal(JSON.stringify(line).includes("PROMPT_SENTINEL_only"), false);
        assert.equal(line.sessionId, undefined);
      }
    } finally {
      await removeDir(dir);
    }
  });

  test("records the session id on each ledger line", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      await sentPrompt(dir, { log: "session.jsonl", sessionId: "01a1676d-f71c-7014-a783-e1cfd2ab14c0" });
      const lines = await ledgerLines(dir, "session.jsonl");
      assert.equal(lines.length, 1);
      assert.equal(lines[0]?.sessionId, "01a1676d-f71c-7014-a783-e1cfd2ab14c0");
      await sentPrompt(dir, { log: "plain.jsonl", sessionId: "  " });
      const plain = await ledgerLines(dir, "plain.jsonl");
      assert.equal(plain[0]?.sessionId, undefined);
    } finally {
      await removeDir(dir);
    }
  });

  test("saves a default provider and model, and an explicit model overrides that save", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "default-provider.json");
    const log = path.join(dir, "logs", "provider.sqlite");
    const deps = {
      loadEnvFile: false as const,
      env: { DEEPSEEK_API_KEY: KEY, OPENAI_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
      fetchImpl: async () => chatResponse("nope"),
    };
    try {
      const parsed = parseCommandArgs("--set-default-image-describer-provider openai", dir);
      assert.equal(parsed.setDefaultImageDescriberProvider, "openai");
      assert.equal(parsed.dir, "");
      assert.throws(
        () => parseCommandArgs("--set-default-image-describer-mode financial --set-default-image-describer-provider openai", dir),
        /--set-default-image-describer-provider and --set-default-image-describer-model may be used together, and not with those saves/,
      );
      assert.throws(
        () => parseCommandArgs("--set-default-image-describer-provider openai --set-default-image-describer-preset low", dir),
        /not with those saves/,
      );

      let calls = 0;
      const saved = await describeImages(
        { dir: "", cwd: dir, setDefaultImageDescriberProvider: "openai", log },
        {
          ...deps,
          fetchImpl: async () => {
            calls += 1;
            return chatResponse("nope");
          },
        },
      );
      assert.equal(calls, 0);
      assert.equal(existsSync(log), false);
      assert.match(saved.text, /Saved default provider openai and model gpt-6.1-sol\./);
      assert.equal(saved.record.requestedModel, "gpt-6.1-sol");
      assert.equal(saved.record.provider, "openai");
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { provider: "openai", model: "gpt-6.1-sol" });

      const byModel = await describeImages({ dir: "", cwd: dir, setDefaultImageDescriberModel: "gemini-3.8-flash" }, deps);
      assert.match(byModel.text, /Saved default provider gemini and model gemini-3.8-flash\./);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { provider: "gemini", model: "gemini-3.8-flash" });

      const paired = await describeImages(
        { dir: "", cwd: dir, setDefaultImageDescriberProvider: "openai", setDefaultImageDescriberModel: "gpt-6.1-sol" },
        deps,
      );
      assert.match(paired.text, /Saved default provider openai and model gpt-6.1-sol\./);

      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberProvider: "openai", setDefaultImageDescriberModel: "gemini-3.8-flash" }, deps),
        /Model "gemini-3.8-flash" belongs to gemini, not openai/,
      );
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { provider: "openai", model: "gpt-6.1-sol" });
      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberProvider: "google" }, deps),
        /Unknown provider "google"/,
      );
      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberModel: "gpt-5.4-mini" }, deps),
        /Unknown model "gpt-5.4-mini"/,
      );
      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberProvider: "  " }, deps),
        /Default provider must not be empty/,
      );
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { provider: "openai", model: "gpt-6.1-sol" });
      assert.equal(calls, 0);

      await writePng(path.join(dir, "a.png"));
      let requested = "";
      const used = await describeImages(
        { dir, cwd: dir, log: "logs/used.sqlite" },
        {
          ...deps,
          fetchImpl: async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as { model?: string };
            requested = body.model ?? "";
            return chatResponse("described", undefined, "gpt-6.1-sol");
          },
        },
      );
      assert.equal(requested, "gpt-6.1-sol");
      assert.equal(used.record.requestedModel, "gpt-6.1-sol");
      assert.equal(used.record.provider, "openai");
      assert.equal(used.record.requestedEffort, "default");

      await rm(path.join(dir, "a.png.md"), { force: true });
      let overrideModel = "";
      await describeImages(
        { dir, cwd: dir, model: "deepseek-flash", log: "logs/override.sqlite" },
        {
          ...deps,
          fetchImpl: async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as { model?: string };
            overrideModel = body.model ?? "";
            return chatResponse("described");
          },
        },
      );
      assert.equal(overrideModel, "deepseek-flash");
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { provider: "openai", model: "gpt-6.1-sol" });
    } finally {
      await removeDir(dir);
    }
  });

  test("saves a default language, and an explicit language overrides that save", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "default-language.json");
    const log = path.join(dir, "logs", "language.sqlite");
    let calls = 0;
    const deps = {
      loadEnvFile: false as const,
      env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
      fetchImpl: async () => {
        calls += 1;
        return chatResponse("## Summary\n\nA red chair by a window.\n\n## Subject\n\nA chair.");
      },
    };
    try {
      const parsed = parseCommandArgs("--set-default-image-describer-language Portuguese", dir);
      assert.equal(parsed.setDefaultImageDescriberLanguage, "Portuguese");
      assert.equal(parsed.dir, "");
      assert.throws(
        () => parseCommandArgs("--set-default-image-describer-mode financial --set-default-image-describer-language Portuguese", dir),
        /--set-default-image-describer-images-dir/,
      );
      assert.throws(
        () => parseCommandArgs("--set-default-image-describer-language Portuguese --set-default-image-describer-provider openai", dir),
        /not with those saves/,
      );

      const saved = await describeImages({ dir: "", cwd: dir, setDefaultImageDescriberLanguage: "  Portuguese  ", log }, deps);
      assert.equal(calls, 0);
      assert.equal(existsSync(log), false);
      assert.match(saved.text, /Saved default language Portuguese\./);
      assert.equal(saved.record.language, "Portuguese");
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { language: "Portuguese" });

      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberLanguage: "   ", log }, deps),
        /Language must be a single line of at most 80 characters/,
      );
      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberLanguage: "Portuguese\nEnglish", log }, deps),
        /Language must be a single line of at most 80 characters/,
      );
      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberLanguage: "P".repeat(81), log }, deps),
        /Language must be a single line of at most 80 characters/,
      );
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { language: "Portuguese" });
      assert.equal(calls, 0);
      assert.equal(existsSync(log), false);

      await writePng(path.join(dir, "a.png"));
      let usedPrompt = "";
      const used = await describeImages(
        { dir, cwd: dir, log: "logs/used.sqlite" },
        {
          ...deps,
          fetchImpl: async (_url, init) => {
            calls += 1;
            const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: Array<{ text?: string }> }> };
            usedPrompt = body.messages?.[0]?.content?.[0]?.text ?? "";
            return chatResponse("## Summary\n\nA red chair by a window.\n\n## Subject\n\nA chair.");
          },
        },
      );
      assert.match(usedPrompt, /Describe this image in Portuguese\./);
      assert.equal(used.record.language, "Portuguese");
      const rows = await ledgerLines(dir, "logs/used.sqlite");
      assert.equal(rows[0]?.language, "Portuguese");
      const summaries = listSummaries(summariesPathForLog(path.join(dir, "logs", "used.sqlite")));
      assert.equal(summaries[0]?.language, "Portuguese");
      assert.equal(summaries[0]?.summary, "A red chair by a window.");

      await rm(path.join(dir, "a.png.md"), { force: true });
      let overridePrompt = "";
      const override = await describeImages(
        { dir, cwd: dir, language: "English", log: "logs/override.sqlite" },
        {
          ...deps,
          fetchImpl: async (_url, init) => {
            calls += 1;
            const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: Array<{ text?: string }> }> };
            overridePrompt = body.messages?.[0]?.content?.[0]?.text ?? "";
            return chatResponse("described");
          },
        },
      );
      assert.match(overridePrompt, /Describe this image in English\./);
      assert.equal(override.record.language, "English");
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { language: "Portuguese" });

      await writeFile(file, "{", "utf8");
      await rm(path.join(dir, "a.png.md"), { force: true });
      let corruptCalls = 0;
      await assert.rejects(
        () =>
          describeImages(
            { dir, cwd: dir, log: "logs/corrupt.sqlite" },
            {
              ...deps,
              fetchImpl: async () => {
                corruptCalls += 1;
                return chatResponse("nope");
              },
            },
          ),
        /default-language.json is not valid JSON/,
      );
      assert.equal(corruptCalls, 0);
      assert.equal(existsSync(path.join(dir, "logs", "corrupt.sqlite")), false);

      await writeFile(file, JSON.stringify({ language: "Portuguese", extra: true }), "utf8");
      await assert.rejects(
        () => describeImages({ dir, cwd: dir, log: "logs/shape.sqlite" }, deps),
        /default-language.json must be an object with a language string/,
      );
      assert.equal(calls, 2);
      assert.equal(existsSync(path.join(dir, "logs", "shape.sqlite")), false);
    } finally {
      await removeDir(dir);
    }
  });

  test("saves an images directory, falls back when --dir is omitted, and lets --dir override", async () => {
    const dir = await tempDir();
    const inbox = path.join(dir, "inbox");
    const other = path.join(dir, "other");
    const file = path.join(dir, "images-dir.json");
    const log = path.join(dir, "logs", "images-dir.sqlite");
    let calls = 0;
    const deps = {
      loadEnvFile: false as const,
      env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
      fetchImpl: async () => {
        calls += 1;
        return chatResponse("described");
      },
    };
    try {
      await mkdir(inbox, { recursive: true });
      await mkdir(other, { recursive: true });

      const parsed = parseCommandArgs(`--set-default-image-describer-images-dir ${inbox}`, dir);
      assert.equal(parsed.setDefaultImageDescriberImagesDir, inbox);
      assert.equal(parsed.dir, "");
      assert.throws(
        () => parseCommandArgs(`--set-default-image-describer-mode financial --set-default-image-describer-images-dir ${inbox}`, dir),
        /--set-default-image-describer-images-dir/,
      );
      assert.throws(
        () => parseCommandArgs(`--set-default-image-describer-images-dir ${inbox} --set-default-image-describer-language Portuguese`, dir),
        /not with those saves/,
      );

      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, log }, deps),
        /No images directory configured/,
      );
      assert.equal(calls, 0);

      const saved = await describeImages({ dir: "", cwd: dir, setDefaultImageDescriberImagesDir: "  inbox  ", log }, deps);
      assert.equal(calls, 0);
      assert.equal(existsSync(log), false);
      assert.match(saved.text, new RegExp(`Saved images directory ${inbox.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`));
      assert.equal(saved.dir, inbox);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { dir: inbox });

      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberImagesDir: "   ", log }, deps),
        /Images directory must be a single line of at most 4096 characters/,
      );
      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, setDefaultImageDescriberImagesDir: "missing-folder", log }, deps),
        /Images directory not found/,
      );
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { dir: inbox });

      await writePng(path.join(inbox, "a.png"));
      const used = await describeImages({ dir: "", cwd: dir, log: "logs/used.sqlite" }, deps);
      assert.equal(calls, 1);
      assert.equal(used.dir, inbox);
      assert.equal(used.record.status, "ok");
      assert.equal(used.images[0]?.filename, "a.png");
      assert.equal(existsSync(path.join(inbox, "a.png.md")), true);

      await writePng(path.join(other, "b.png"));
      const override = await describeImages({ dir: other, cwd: dir, log: "logs/override.sqlite" }, deps);
      assert.equal(calls, 2);
      assert.equal(override.dir, other);
      assert.equal(override.images[0]?.filename, "b.png");
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { dir: inbox });

      await writeFile(file, "{", "utf8");
      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, log: "logs/corrupt.sqlite" }, deps),
        /images-dir.json is not valid JSON/,
      );
      assert.equal(calls, 2);

      await writeFile(file, JSON.stringify({ dir: inbox, extra: true }), "utf8");
      await assert.rejects(
        () => describeImages({ dir: "", cwd: dir, log: "logs/shape.sqlite" }, deps),
        /images-dir.json must be an object with a dir string/,
      );
      assert.equal(calls, 2);
    } finally {
      await removeDir(dir);
    }
  });
});

async function sentPrompt(
  dir: string,
  request: { mode?: string; language?: string; prompt?: string; log?: string; sessionId?: string },
): Promise<string> {
  return (await sentRun(dir, request)).prompt;
}

async function sentRun(
  dir: string,
  request: {
    mode?: string;
    language?: string;
    prompt?: string;
    log?: string;
    sessionId?: string;
    model?: string;
    effort?: string;
  },
  keys: NodeJS.ProcessEnv = { DEEPSEEK_API_KEY: KEY },
): Promise<{ prompt: string; body: Record<string, unknown>; record: { mode: string; requestedEffort: string } }> {
  const names = await readdir(dir);
  await Promise.all(
    names
      .filter((name) => name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg"))
      .map((name) => rm(path.join(dir, `${name}.md`), { force: true })),
  );
  let prompt = "";
  let body: Record<string, unknown> = {};
  const result = await describeImages(
    { dir, cwd: dir, log: request.log ?? "runs.jsonl", ...request },
    {
      loadEnvFile: false,
      env: { ...keys, PI_CODING_AGENT_DIR: dir },
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (Array.isArray(body.messages)) {
          const messages = body.messages as Array<{ content?: Array<{ text?: string }> }>;
          prompt = messages[0]?.content?.[0]?.text ?? "";
        } else {
          const contents = body.contents as Array<{ parts?: Array<{ text?: string }> }>;
          prompt = contents[0]?.parts?.[0]?.text ?? "";
        }
        if (request.model === "gemini-3.8-flash") {
          return new Response(
            JSON.stringify({
              modelVersion: "gemini-3.8-flash",
              candidates: [{ content: { parts: [{ text: "described" }] } }],
              usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6 },
            }),
            { status: 200 },
          );
        }
        return chatResponse("described");
      },
    },
  );
  return { prompt, body, record: { mode: result.record.mode, requestedEffort: result.record.requestedEffort } };
}

async function ledgerLine(dir: string, log = "runs.jsonl"): Promise<{ mode?: string; effort?: string; language?: string; sessionId?: string }> {
  const lines = await ledgerLines(dir, log);
  return lines[0];
}

async function ledgerLines(dir: string, log: string): Promise<Array<{ mode?: string; effort?: string; language?: string; sessionId?: string }>> {
  return imageCalls(path.join(dir, log)).map((row) => ({
    mode: row.mode,
    effort: row.effort,
    language: row.language,
    sessionId: row.sessionId,
  }));
}

describe("effort", () => {
  test("omits an unsupported level and maps a DeepSeek alias", () => {
    const gemini = lookupModel("gemini-3.8-flash");
    const omitted = resolveEffort(gemini, "max");
    assert.equal(omitted.sent, null);
    assert.equal(omitted.effective, "medium");
    assert.match(omitted.notice ?? "", /not supported/);
    const deepseek = lookupModel("deepseek-flash");
    const mapped = resolveEffort(deepseek, "medium");
    assert.equal(mapped.sent, "high");
    assert.equal(mapped.behaviour, "mapped");
    const untouched = resolveEffort(deepseek, "default");
    assert.equal(untouched.sent, null);
    assert.equal(untouched.effective, "high");
  });
});

describe("describeImages", () => {
  test("returns four labelled descriptions and one ledger line", async () => {
    const dir = await tempDir();
    try {
      const names = ["one.png", "two.png", "three.png", "four.png"];
      for (const name of names) await writePng(path.join(dir, name));
      const before = await Promise.all(names.map(async (name) => (await stat(path.join(dir, name))).size));
      let calls = 0;
      const seenPrompts: string[] = [];
      const result = await describeImages(
        {
          dir,
          cwd: dir,
          prompt: "PROMPT_SENTINEL_should_not_be_logged",
          log: "logs/image-runs.jsonl",
        },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
          fetchImpl: async (_url, init) => {
            calls += 1;
            const body = JSON.parse(String(init?.body)) as {
              messages: Array<{ content: Array<{ text?: string }> }>;
              thinking?: { type?: string };
              reasoning_effort?: string;
            };
            assert.equal(body.thinking?.type, "disabled");
            assert.equal(body.reasoning_effort, undefined);
            seenPrompts.push(body.messages[0].content[0].text ?? "");
            const headers = init?.headers as Record<string, string>;
            assert.equal(headers.authorization, `Bearer ${KEY}`);
            return chatResponse(`DESCRIPTION_SENTINEL_${calls}`);
          },
        },
      );
      assert.equal(calls, 4);
      assert.deepEqual(seenPrompts, Array(4).fill("PROMPT_SENTINEL_should_not_be_logged"));
      for (const name of names) assert.match(result.text, new RegExp(`## ${name}`));
      assert.match(result.text, /DESCRIPTION_SENTINEL_4/);
      assert.equal(result.record.imageCount, 4);
      assert.equal(result.record.succeeded, 4);
      assert.equal(result.record.status, "ok");
      assert.deepEqual(failLines(result), []);
      const printed = stdoutLines(result);
      assert.equal(printed[0], `Run ${result.record.runId}: 4 succeeded, 0 failed, 0 unprocessed.`);
      assert.equal(printed.filter((line) => line.startsWith("Saved ")).length, 4);
      assert.equal(printed.join("\n").includes("DESCRIPTION_SENTINEL"), false);
      assert.equal(result.record.requestedEffort, "none");
      assert.equal(result.record.effectiveEffort, "none");
      const stored = imageCalls(path.join(dir, "logs", "image-runs.jsonl"));
      assert.equal(stored.length, 4);
      const storedText = JSON.stringify(stored);
      assert.equal(storedText.includes("DESCRIPTION_SENTINEL"), false);
      assert.equal(storedText.includes("PROMPT_SENTINEL"), false);
      assert.equal(storedText.includes(KEY), false);
      assert.equal(result.record.descriptionFile, undefined);
      assert.equal(result.record.images.length, 4);
      for (const image of result.images) {
        const listed = result.record.images.find((item) => item.filename === image.filename);
        assert.ok(listed);
        assert.ok(listed.descriptionFile);
        assert.equal(typeof listed.apiDurationSeconds, "number");
        assert.equal(listed.usage?.inputTokens, 11);
        assert.equal(listed.usage?.outputTokens, 7);
        const saved = await readFile(path.join(dir, listed.descriptionFile), "utf8");
        assert.equal(saved, `${image.description}\n`);
        assert.equal(saved.includes("##"), false);
        assert.equal(listed.descriptionFile, `${image.filename}.md`);
        assert.match(result.text, new RegExp(`Saved ${listed.descriptionFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`));
      }
      assert.deepEqual(
        result.record.images.map((image) => image.bytes),
        before,
      );
      assert.equal(new Set(stored.map((row) => row.runId)).size, 1);
      assert.deepEqual(
        stored.map((row) => row.totalTokens),
        result.record.images.map(() => 18),
      );
      const after = await Promise.all(names.map(async (name) => (await stat(path.join(dir, name))).size));
      assert.deepEqual(after, before);
    } finally {
      await removeDir(dir);
    }
  });

  test("uses the configured language in the default instruction", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      let prompt = "";
      await describeImages(
        { dir, cwd: dir, language: "Portuguese", log: "runs.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
          fetchImpl: async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: Array<{ text?: string }> }> };
            prompt = body.messages[0].content[0].text ?? "";
            return chatResponse("vista");
          },
        },
      );
      assert.match(prompt, /^Describe this image in Portuguese\./);
    } finally {
      await removeDir(dir);
    }
  });

  test("omits an unsupported effort and maps a supported alias", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      let geminiBody: Record<string, unknown> = {};
      const gemini = await describeImages(
        { dir, cwd: dir, model: "gemini-3.8-flash", effort: "max", log: "gemini.jsonl" },
        {
          loadEnvFile: false,
          env: { GEMINI_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
          fetchImpl: async (_url, init) => {
            geminiBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
            const headers = init?.headers as Record<string, string>;
            assert.equal(headers["x-goog-api-key"], KEY);
            assert.equal(headers.authorization, undefined);
            return new Response(
              JSON.stringify({
                modelVersion: "gemini-3.8-flash",
                candidates: [{ content: { parts: [{ text: "gemini text" }] } }],
                usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6 },
              }),
              { status: 200 },
            );
          },
        },
      );
      assert.equal(geminiBody.generationConfig, undefined);
      assert.match(gemini.notice ?? "", /not supported/);
      assert.match(gemini.text, /not supported/);
      assert.equal(gemini.record.effortBehaviour, "omitted_unsupported");
      assert.equal(gemini.record.effectiveEffort, "medium");
      await rm(path.join(dir, "a.png.md"), { force: true });

      let deepseekBody: { reasoning_effort?: string } = {};
      const deepseek = await describeImages(
        { dir, cwd: dir, effort: "medium", log: "deepseek.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
          fetchImpl: async (_url, init) => {
            deepseekBody = JSON.parse(String(init?.body)) as { reasoning_effort?: string };
            return chatResponse("mapped");
          },
        },
      );
      assert.equal(deepseekBody.reasoning_effort, "high");
      assert.match(deepseek.notice ?? "", /sent as "high"/);
    } finally {
      await removeDir(dir);
    }
  });

  test("rejects an unknown model and an invalid timeout before any request", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      let calls = 0;
      const deps = {
        loadEnvFile: false,
        env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
        fetchImpl: async () => {
          calls += 1;
          return chatResponse("nope");
        },
      };
      await assert.rejects(() => describeImages({ dir, cwd: dir, model: "gpt-5.4-mini" }, deps), /Unknown model/);
      await assert.rejects(() => describeImages({ dir, cwd: dir, timeout: 0 }, deps), /positive number/);
      await assert.rejects(() => describeImages({ dir, cwd: dir, timeout: Number.NaN }, deps), /positive number/);
      assert.equal(calls, 0);
    } finally {
      await removeDir(dir);
    }
  });

  test("skips a finished image and a folder that already holds two files", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "done.png"));
      await writeFile(path.join(dir, "done.png.md"), "already\n");
      await writePng(path.join(dir, "pending", "a.png"));
      await writePng(path.join(dir, "full", "b.png"));
      await writeFile(path.join(dir, "full", "note.txt"), "second");
      let calls = 0;
      const result = await describeImages(
        { dir, cwd: dir, log: "logs/skip.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
          fetchImpl: async () => {
            calls += 1;
            return chatResponse("fresh");
          },
        },
      );
      assert.equal(calls, 1);
      assert.match(result.text, /## pending\/a.png/);
      assert.equal(result.text.includes("done.png"), false);
      assert.equal(result.text.includes("full/b.png"), false);
      const listed = result.record.images[0];
      assert.equal(listed?.descriptionFile, path.join("pending", "a.png.md"));
      assert.equal(await readFile(path.join(dir, "pending", "a.png.md"), "utf8"), "fresh\n");
      await assert.rejects(() => readFile(path.join(dir, "logs", "descriptions"), "utf8"));
      let again = 0;
      await describeImages(
        { dir, cwd: dir, log: "logs/skip-again.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
          fetchImpl: async () => {
            again += 1;
            return chatResponse("again");
          },
        },
      );
      assert.equal(again, 0);
    } finally {
      await removeDir(dir);
    }
  });

  test("stores a summary row for each image directory and skips a description with no summary", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "room", "IMG_0950.png"));
      await writePng(path.join(dir, "street", "IMG_0949.png"));
      await writePng(path.join(dir, "loose.png"));
      const room = "## Summary\n\nA dining area with red chairs and a window.\n\n## Counts\n\n- Red chairs: 6";
      const replies = [room, "## Counts\n\n- Buildings: 1", "## Summary\n\nNone\n\n## Subject\n\nA blank card."];
      let n = 0;
      const result = await describeImages(
        { dir, cwd: dir, log: "logs/metrics.sqlite" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
          readExif: async (filePath) => (filePath.endsWith("IMG_0950.png") ? 1 : filePath.endsWith("IMG_0949.png") ? 2 : 3),
          fetchImpl: async () => {
            const text = replies[n] ?? "missing";
            n += 1;
            return chatResponse(text);
          },
        },
      );
      const db = summariesPathForLog(path.join(dir, "logs", "metrics.sqlite"));
      assert.deepEqual(listSummaries(db), [
        {
          imageDir: path.join(dir, "room"),
          imageFile: "IMG_0950.png",
          summary: "A dining area with red chairs and a window.",
          recordedAt: result.record.endedAt,
          mode: "general",
          language: "English",
          model: "deepseek-flash",
          runId: result.record.runId,
        },
      ]);
      assert.equal(await readFile(path.join(dir, "room", "IMG_0950.png.md"), "utf8"), `${room}\n`);
      assert.equal(existsSync(path.join(dir, "street", "IMG_0949.png.md")), true);
      assert.equal(existsSync(path.join(dir, "loose.png.md")), true);
    } finally {
      await removeDir(dir);
    }
  });

  test("writes the whole run to front-and-center.md and leaves it when nothing new is described", async () => {
    const dir = await tempDir();
    const agent = path.join(dir, "agent");
    const file = path.join(agent, "front-and-center.md");
    try {
      await writePng(path.join(dir, "one.png"));
      await writePng(path.join(dir, "two.png"));
      const older = new Date(2020, 0, 1);
      const newer = new Date(2024, 0, 2);
      await utimes(path.join(dir, "one.png"), older, older);
      await utimes(path.join(dir, "two.png"), newer, newer);
      const env = { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: agent };
      let n = 0;
      const first = await describeImages(
        { dir, cwd: dir, log: "logs/batch.jsonl" },
        {
          loadEnvFile: false,
          env,
          readExif: async () => null,
          fetchImpl: async () => {
            n += 1;
            return chatResponse(n === 1 ? "FIRST" : "SECOND");
          },
        },
      );
      assert.equal(
        await readFile(file, "utf8"),
        `# Front and center

- Run: ${first.record.runId}
- Recorded: ${first.record.endedAt}
- Directory: ${dir}

## one.png

FIRST

## two.png

SECOND
`,
      );

      const next = path.join(dir, "next");
      await writePng(path.join(next, "only.png"));
      const second = await describeImages(
        { dir: next, cwd: dir, log: "logs/next.jsonl" },
        {
          loadEnvFile: false,
          env,
          fetchImpl: async () => chatResponse("ONLY"),
        },
      );
      assert.equal(
        await readFile(file, "utf8"),
        `# Front and center

- Run: ${second.record.runId}
- Recorded: ${second.record.endedAt}
- Directory: ${next}

## only.png

ONLY
`,
      );

      const kept = await readFile(file, "utf8");
      let calls = 0;
      await describeImages(
        { dir: next, cwd: dir, log: "logs/again.jsonl" },
        {
          loadEnvFile: false,
          env,
          fetchImpl: async () => {
            calls += 1;
            return chatResponse("AGAIN");
          },
        },
      );
      assert.equal(calls, 0);
      assert.equal(await readFile(file, "utf8"), kept);
    } finally {
      await removeDir(dir);
    }
  });

  test("writes a no-images record and does not call the provider", async () => {
    const dir = await tempDir();
    try {
      let calls = 0;
      const result = await describeImages(
        { dir, cwd: dir, log: "empty.jsonl" },
        {
          loadEnvFile: false,
          env: {},
          fetchImpl: async () => {
            calls += 1;
            return chatResponse("nope");
          },
        },
      );
      assert.equal(calls, 0);
      assert.equal(result.record.status, "no-images");
      assert.match(result.text, /No eligible images/);
      await assert.rejects(() => readFile(path.join(dir, "empty.jsonl")));
      assert.ok(result.record.descriptionFile);
      const saved = await readFile(path.join(dir, result.record.descriptionFile), "utf8");
      assert.match(saved, /No eligible images/);
    } finally {
      await removeDir(dir);
    }
  });

  test("continues after a corrupt file and a timeout", async () => {
    const dir = await tempDir();
    try {
      await writeBytes(path.join(dir, "bad.jpg"), "this is not a jpeg");
      await writePng(path.join(dir, "slow.png"));
      await writePng(path.join(dir, "ok.png"));
      let calls = 0;
      const result = await describeImages(
        { dir, cwd: dir, timeout: 0.05, log: "mixed.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
          readExif: async (filePath) => (filePath.endsWith("slow.png") ? 2 : filePath.endsWith("ok.png") ? 3 : 1),
          fetchImpl: async (_url, init) => {
            calls += 1;
            if (calls === 1) {
              await new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => {
                  reject(new DOMException("The operation was aborted.", "TimeoutError"));
                });
              });
            }
            return chatResponse("visible");
          },
        },
      );
      assert.equal(result.record.failed, 2);
      assert.equal(result.record.succeeded, 1);
      assert.equal(result.record.status, "partial");
      assert.match(result.text, /FAILED \(local\): Could not read bad.jpg/);
      assert.match(result.text, /FAILED \(timeout\)/);
      assert.match(result.text, /visible/);
      assert.equal(result.record.usage.completeness, "partial");
      const printed = failLines(result);
      assert.equal(printed.length, 2);
      assert.ok(printed.some((line) => line.startsWith("[FAIL] bad.jpg:") && line.includes("Could not read bad.jpg")));
      assert.ok(printed.some((line) => line.startsWith("[FAIL] slow.png:")));
      assert.equal(printed.some((line) => line.includes("ok.png")), false);
    } finally {
      await removeDir(dir);
    }
  });

  test("prints a local HEIF decode failure for print mode", async () => {
    const dir = await tempDir();
    try {
      await writeBytes(path.join(dir, "sample.heif"), "not a heif file");
      const result = await describeImages(
        { dir, cwd: dir, log: "heif.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
          readExif: async () => null,
          fetchImpl: async () => chatResponse("should not be called"),
        },
      );
      assert.equal(result.record.failed, 1);
      assert.equal(result.record.succeeded, 0);
      assert.match(result.text, /FAILED \(local\): HEIC\/HEIF decode failed/);
      assert.equal(result.record.images[0]?.descriptionFile, undefined);
      const printed = failLines(result);
      assert.equal(printed.length, 1);
      assert.match(printed[0] ?? "", /^\[FAIL\] sample\.heif: HEIC\/HEIF decode failed/);
    } finally {
      await removeDir(dir);
    }
  });

  test("stops before a request when the key is missing", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      let calls = 0;
      await assert.rejects(
        () =>
          describeImages(
            { dir, cwd: dir, log: "missing.jsonl" },
            {
              loadEnvFile: false,
              env: { PI_CODING_AGENT_DIR: dir },
              fetchImpl: async () => {
                calls += 1;
                return chatResponse("nope");
              },
            },
          ),
        /Missing DEEPSEEK_API_KEY/,
      );
      assert.equal(calls, 0);
      await assert.rejects(() => readFile(path.join(dir, "missing.jsonl"), "utf8"));
    } finally {
      await removeDir(dir);
    }
  });

  test("continues after a rate limit", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      await writePng(path.join(dir, "b.png"));
      let calls = 0;
      const result = await describeImages(
        { dir, cwd: dir, log: "rate.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
          readExif: async () => null,
          fetchImpl: async () => {
            calls += 1;
            if (calls === 1) return errorResponse(429, { message: "Rate limit reached", code: "rate_limit_exceeded" });
            return chatResponse("after limit");
          },
        },
      );
      assert.equal(calls, 2);
      assert.equal(result.record.failed, 1);
      assert.equal(result.record.succeeded, 1);
      assert.match(result.text, /FAILED \(rate_limit\)/);
      assert.match(result.text, /after limit/);
    } finally {
      await removeDir(dir);
    }
  });

  test("stops further paid calls after an authentication failure", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      await writePng(path.join(dir, "b.png"));
      let calls = 0;
      const result = await describeImages(
        { dir, cwd: dir, log: "auth.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
          readExif: async () => null,
          fetchImpl: async () => {
            calls += 1;
            return errorResponse(401, { message: "Incorrect API key", code: "invalid_api_key" });
          },
        },
      );
      assert.equal(calls, 1);
      assert.equal(result.record.failed, 1);
      assert.equal(result.record.unprocessed, 1);
      assert.equal(result.record.status, "failed");
      assert.match(result.text, /UNPROCESSED: skipped after authentication failure/);
      const printed = failLines(result);
      assert.equal(printed.length, 2);
      assert.ok(printed.some((line) => line.startsWith("[FAIL] a.png:")));
      assert.ok(printed.some((line) => line.startsWith("[FAIL] b.png:") && line.includes("skipped after authentication failure")));
      const stored = JSON.stringify(imageCalls(path.join(dir, "auth.jsonl")));
      assert.equal(stored.includes(KEY), false);
      assert.equal(stored.includes("Incorrect API key"), false);
    } finally {
      await removeDir(dir);
    }
  });

  test("labels a partial token sum when a response omits usage", async () => {
    const dir = await tempDir();
    try {
      await writePng(path.join(dir, "a.png"));
      await writePng(path.join(dir, "b.png"));
      let calls = 0;
      const result = await describeImages(
        { dir, cwd: dir, log: "usage.jsonl" },
        {
          loadEnvFile: false,
          env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
          readExif: async () => null,
          fetchImpl: async () => {
            calls += 1;
            if (calls === 1) {
              return chatResponse("first", {
                prompt_tokens: 10,
                completion_tokens: 4,
                total_tokens: 14,
                completion_tokens_details: { reasoning_tokens: 1 },
                prompt_tokens_details: { cached_tokens: 0 },
              });
            }
            return chatResponse("second", null);
          },
        },
      );
      assert.equal(result.record.usage.completeness, "partial");
      assert.equal(result.record.usage.responsesReportingUsage, 1);
      assert.equal(result.record.usage.inputTokens, 10);
      assert.equal(result.record.usage.totalTokens, 14);
      assert.equal(result.record.usage.reasoningTokens, 1);
    } finally {
      await removeDir(dir);
    }
  });

  test("keeps concurrent ledger appends on separate lines", async () => {
    const dir = await tempDir();
    try {
      const left = path.join(dir, "left");
      const right = path.join(dir, "right");
      await writePng(path.join(left, "a.png"));
      await writePng(path.join(right, "b.png"));
      const log = path.join(dir, "logs", "image-runs.jsonl");
      const deps = {
        loadEnvFile: false as const,
        env: { DEEPSEEK_API_KEY: KEY, PI_CODING_AGENT_DIR: dir },
        fetchImpl: async () => chatResponse("text"),
      };
      await Promise.all([
        describeImages({ dir: left, cwd: dir, log }, deps),
        describeImages({ dir: right, cwd: dir, log }, deps),
      ]);
      const rows = imageCalls(log);
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((row) => row.filename).sort(), ["a.png", "b.png"]);
    } finally {
      await removeDir(dir);
    }
  });
});
