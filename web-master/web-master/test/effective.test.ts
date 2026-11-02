import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveChoice } from "../src/effective.ts";
import type { DefaultModel } from "../src/default-model.ts";

const defaults: DefaultModel = {
  provider: "deepseek",
  model: "deepseek-flash",
  effort: "low",
  updatedAt: "2026-10-27T08:00:00Z",
};

describe("effectiveChoice", () => {
  it("uses the saved default when nothing is passed", () => {
    assert.deepEqual(effectiveChoice({}, defaults), {
      provider: "deepseek",
      model: "deepseek-flash",
      effort: "low",
    });
  });

  it("drops the saved provider when the model is given on the command line", () => {
    assert.deepEqual(effectiveChoice({ model: "gpt-5.4" }, defaults), { model: "gpt-5.4", effort: "low" });
  });

  it("keeps an explicit provider next to an explicit model", () => {
    assert.deepEqual(effectiveChoice({ provider: "google", model: "gemini-3.8-flash" }, defaults), {
      provider: "google",
      model: "gemini-3.8-flash",
      effort: "low",
    });
  });

  it("lets a flag effort beat the saved one", () => {
    assert.equal(effectiveChoice({ effort: "high" }, defaults).effort, "high");
  });

  it("works with no saved default at all", () => {
    assert.deepEqual(effectiveChoice({ model: "gpt-5.4" }, null), { model: "gpt-5.4" });
  });
});
