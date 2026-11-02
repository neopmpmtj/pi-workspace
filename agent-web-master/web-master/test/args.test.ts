import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ASK_HELP, commandHelp, parseAskArgs, parseUsageArgs, USAGE_HELP } from "../src/args.ts";

describe("parseAskArgs", () => {
  it("takes the positional text as the question", () => {
    const request = parseAskArgs("What is a vector database?");
    assert.equal(request.question, "What is a vector database?");
  });

  it("keeps quoted text together and strips the quotes", () => {
    const request = parseAskArgs('"Explain CAP theorem" --web-master-effort low');
    assert.equal(request.question, "Explain CAP theorem");
    assert.equal(request.effort, "low");
  });

  it("reads model, provider, prompt and timeout", () => {
    const request = parseAskArgs(
      'hello --web-master-provider openai --web-master-model gpt-5.4 --web-master-prompt "Be brief." --web-master-timeout 30',
    );
    assert.equal(request.provider, "openai");
    assert.equal(request.model, "gpt-5.4");
    assert.equal(request.prompt, "Be brief.");
    assert.equal(request.timeoutSeconds, 30);
    assert.equal(request.question, "hello");
  });

  it("accepts a save with no question", () => {
    const request = parseAskArgs("--set-default-web-master-model gemini-3.8-flash");
    assert.equal(request.question, "");
    assert.equal(request.setDefaultModel, "gemini-3.8-flash");
  });

  it("rejects a question with a missing value", () => {
    assert.throws(() => parseAskArgs("hello --web-master-model"), /Missing value for --web-master-model/);
  });

  it("rejects an unknown flag", () => {
    assert.throws(() => parseAskArgs("hello --model gpt-5.4"), /Unknown flag --model\. Use --help\./);
    assert.throws(() => parseAskArgs("hello --web-master-mode advanced"), /Unknown flag --web-master-mode/);
  });

  it("rejects an unknown effort", () => {
    assert.throws(() => parseAskArgs("hello --web-master-effort turbo"), /Unknown effort "turbo"/);
  });

  it("requires a question when nothing is being saved", () => {
    assert.throws(() => parseAskArgs(""), /Missing question/);
    assert.throws(() => parseAskArgs("--web-master-model gpt-5.4"), /Missing question/);
  });

  it("rejects mixing a save with a run", () => {
    assert.throws(() => parseAskArgs("hello --set-default-web-master-model gpt-5.4"), /Use only one of/);
  });

  it("rejects two conflicting saves", () => {
    assert.throws(
      () => parseAskArgs("--set-default-web-master-model gpt-5.4 --set-default-web-master-effort low"),
      /Use only one of/,
    );
  });

  it("allows provider and model saved together", () => {
    const request = parseAskArgs("--set-default-web-master-provider openai --set-default-web-master-model gpt-5.4");
    assert.equal(request.setDefaultProvider, "openai");
    assert.equal(request.setDefaultModel, "gpt-5.4");
  });

  it("rejects an unclosed quote", () => {
    assert.throws(() => parseAskArgs('"never closed'), /Unclosed quote/);
  });

  it("prints help for --help and does not require the other flags", () => {
    assert.equal(commandHelp("ask", "--help"), ASK_HELP);
    assert.equal(commandHelp("ask", '--help --web-master-model'), ASK_HELP);
    assert.equal(commandHelp("ask", "hello"), undefined);
  });
});

describe("parseUsageArgs", () => {
  it("defaults to the last run", () => {
    assert.deepEqual(parseUsageArgs(""), { kind: "last" });
    assert.deepEqual(parseUsageArgs("   "), { kind: "last" });
  });

  it("reads the selectors", () => {
    assert.deepEqual(parseUsageArgs("--usage-totals"), { kind: "all" });
    assert.deepEqual(parseUsageArgs("--this-session"), { kind: "session" });
    assert.deepEqual(parseUsageArgs("--web-search"), { kind: "web-search" });
    assert.deepEqual(parseUsageArgs("7f3e"), { kind: "run", prefix: "7f3e" });
  });

  it("rejects an unknown flag and the old names", () => {
    assert.throws(() => parseUsageArgs("--all"), /Unknown flag --all\. Use --help\./);
    assert.throws(() => parseUsageArgs("--tools"), /Unknown flag --tools/);
    assert.throws(() => parseUsageArgs("--usage-totals --this-session"), /Use one of/);
  });

  it("prints help for --help", () => {
    assert.equal(commandHelp("usage", "--help"), USAGE_HELP);
    assert.equal(commandHelp("usage", ""), undefined);
  });
});
