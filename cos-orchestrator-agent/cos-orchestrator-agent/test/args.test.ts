import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { askHelp, parseAskArgs } from "../src/args.ts";

describe("parseAskArgs", () => {
  it("takes the positional text as the question", () => {
    const request = parseAskArgs("What is a vector database?");
    assert.equal(request.question, "What is a vector database?");
  });

  it("keeps quoted text together and strips the quotes", () => {
    const request = parseAskArgs('"Explain CAP theorem" --effort low');
    assert.equal(request.question, "Explain CAP theorem");
    assert.equal(request.effort, "low");
  });

  it("reads model, provider and timeout", () => {
    const request = parseAskArgs('hello --provider openai --model gpt-5.4 --timeout 30');
    assert.equal(request.provider, "openai");
    assert.equal(request.model, "gpt-5.4");
    assert.equal(request.timeoutSeconds, 30);
    assert.equal(request.question, "hello");
  });

  it("accepts a save with no question", () => {
    const request = parseAskArgs("--set-default-model gemini-3.8-flash");
    assert.equal(request.question, "");
    assert.equal(request.setDefaultModel, "gemini-3.8-flash");
  });

  it("rejects a question with a missing value", () => {
    assert.throws(() => parseAskArgs("hello --model"), /Missing value for --model/);
  });

  it("rejects an unknown flag", () => {
    assert.throws(() => parseAskArgs("hello --nope x"), /Unknown flag --nope/);
  });

  it("rejects an unknown effort", () => {
    assert.throws(() => parseAskArgs("hello --effort turbo"), /Unknown effort "turbo"/);
  });

  it("requires a question when nothing is being saved", () => {
    assert.throws(() => parseAskArgs(""), /Missing question/);
    assert.throws(() => parseAskArgs("--model gpt-5.4"), /Missing question/);
  });

  it("rejects mixing a save with a run", () => {
    assert.throws(() => parseAskArgs("hello --set-default-model gpt-5.4"), /Use only one of/);
  });

  it("rejects two conflicting saves", () => {
    assert.throws(
      () => parseAskArgs("--set-default-model gpt-5.4 --set-default-effort low"),
      /Use only one of/,
    );
  });

  it("allows provider and model saved together", () => {
    const request = parseAskArgs("--set-default-provider openai --set-default-model gpt-5.4");
    assert.equal(request.setDefaultProvider, "openai");
    assert.equal(request.setDefaultModel, "gpt-5.4");
  });

  it("rejects an unclosed quote", () => {
    assert.throws(() => parseAskArgs('"never closed'), /Unclosed quote/);
  });
});

describe("askHelp", () => {
  it("prints help for --help and does not parse the other flags", () => {
    const alone = askHelp("--help");
    const withQuestion = askHelp('--help "question" --model x');
    assert.equal(askHelp("question"), undefined);
    assert.ok(alone);
    assert.equal(withQuestion, alone);
    assert.match(alone, /--model/);
    assert.match(alone, /--set-default-effort/);
  });
});
