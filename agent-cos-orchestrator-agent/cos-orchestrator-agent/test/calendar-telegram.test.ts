import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { sendTelegram } from "../extensions/calendar-router/index.ts";

// `sendTelegram` takes the bridge module from PI_TELEGRAM_DELIVERY when set, so the
// delivery contract can be exercised without a live bot.

describe("sendTelegram", () => {
  let dir = "";
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "calendar-telegram-"));
  });
  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const moduleWith = async (name: string, body: string): Promise<string> => {
    const file = path.join(dir, name);
    await writeFile(file, body, "utf8");
    return file;
  };

  it("delivers through the active turn first", async () => {
    const module = await moduleWith("ok.mjs", `
      export const calls = [];
      export async function sendTelegramView(view, options) {
        calls.push(options.scope.kind);
        return { ok: options.scope.kind === "active-turn" };
      }
    `);
    assert.equal(await sendTelegram("hello", { PI_TELEGRAM_DELIVERY: module }), true);
  });

  it("falls back to the instance target when the turn target is gone", async () => {
    const module = await moduleWith("fallback.mjs", `
      export async function sendTelegramView(view, options) {
        return { ok: options.scope.kind === "instance" };
      }
    `);
    assert.equal(await sendTelegram("hello", { PI_TELEGRAM_DELIVERY: module }), true);
  });

  it("reports failure when the bridge refuses both scopes", async () => {
    const module = await moduleWith("refuse.mjs", `
      export async function sendTelegramView() {
        return { ok: false, reason: "target-unavailable" };
      }
    `);
    assert.equal(await sendTelegram("hello", { PI_TELEGRAM_DELIVERY: module }), false);
  });

  it("reports failure when the module is missing", async () => {
    assert.equal(await sendTelegram("hello", { PI_TELEGRAM_DELIVERY: path.join(dir, "nope.mjs") }), false);
  });
});
