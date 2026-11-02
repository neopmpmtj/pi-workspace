// Pi extension for the sm-google-workspace.
//
// `/ask` sends one request straight to a provider through Pi's own model
// registry: same catalog, same credentials, same pricing as a chat turn, but no
// chat model turn is started. It is the only paid path this agent owns; the rest
// of the ledger is filled by reading Pi's sessions.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ASK_HELP, askHelp, hasStandingSave, parseAskArgs, type AskRequest } from "../../src/args.ts";
import { effectiveChoice } from "../../src/effective.ts";
import { resolveModel, runAsk, type AskOutcome, type RegistryLike } from "../../src/ask.ts";
import { readStandingModel, writeDefaultModel, type DefaultModel } from "../../src/default-model.ts";
import { ledgerPath, sessionsRoot } from "../../ledger/env.ts";
import { syncSessions } from "../../ledger/ingest.ts";
import { USAGE_HELP, usageHelp, usageView } from "../../src/usage.ts";
import { readRates } from "../../ledger/rates.ts";
import { openLedger, type Ledger } from "../../ledger/store.ts";
import { formatFooter } from "../../src/report.ts";
import { recordCommandIfUnsaved, slashCommand } from "../../src/session-command.ts";
import { CANNED, CANNED_DESCRIPTION, GOG_HELP, runCanned } from "../../src/gog.ts";

const DESCRIPTION =
  'One request, no chat turn: /ask "question" [--model gpt-6.1-sol] [--effort low] [--timeout 60]. Save defaults with --set-default-model.';

// Help text per slash command, in the shape a sibling's scripts/publish.ts reads.
export const HELP: Record<string, string> = { ask: ASK_HELP, usage: USAGE_HELP, ...GOG_HELP };

export default function registerChat(pi: ExtensionAPI): void {
  let ledger: Ledger | null = null;
  const open = (): Ledger => (ledger ??= openLedger(ledgerPath()));
  pi.on("session_shutdown", () => {
    ledger?.close();
    ledger = null;
  });

  const sync = (ratesVersion: string): void => {
    try {
      syncSessions(open(), { sessionsRoot: sessionsRoot(), ratesVersion });
    } catch {
      // A session file being written must never break a command.
    }
  };

  pi.on("session_start", async () => {
    try {
      sync((await readRates()).version);
    } catch {
      // Nothing to report at startup.
    }
  });

  pi.registerCommand("usage", {
    description: "Tokens and cost: /usage · /usage --all · /usage --session · /usage <runId>",
    handler: async (args, ctx) => {
      try {
        const help = usageHelp(args);
        if (help !== undefined) {
          showText(pi, ctx, "sm-google-workspace-usage", help, commandLine("usage", args));
          return;
        }
        const selector = args.trim();
        const rates = await readRates();
        const ledger = open();
        sync(rates.version);
        const view = usageView(
          ledger,
          rates,
          selector === "--all"
            ? { kind: "all" }
            : selector === "--session"
              ? { kind: "session", sessionId: ctx.sessionManager.getSessionId().trim() }
              : selector && !selector.startsWith("--")
                ? { kind: "run", prefix: selector }
                : { kind: "last" },
        );
        if (!ctx.hasUI) toStdout(view.text);
        pi.sendMessage(
          { customType: "sm-google-workspace-usage", content: view.text, display: true, details: { runs: view.runs.length } },
          { triggerTurn: false },
        );
      } catch (error) {
        fail(pi, ctx, message(error), undefined, undefined, commandLine("usage", args));
      }
    },
  });

  // The fast path: one fixed `gog` command, shaped and printed. No model turn, no tokens.
  for (const name of CANNED) {
    pi.registerCommand(name, {
      description: CANNED_DESCRIPTION[name],
      handler: async (args, ctx) => {
        const command = commandLine(name, args);
        try {
          if (args.trim() === "--help") {
            showText(pi, ctx, `sm-google-workspace-${name}`, GOG_HELP[name], command);
            return;
          }
          const outcome = await runCanned(name, args);
          if (!outcome.ok) {
            fail(pi, ctx, outcome.text, undefined, undefined, command);
            return;
          }
          showText(pi, ctx, `sm-google-workspace-${name}`, outcome.text, command);
        } catch (error) {
          fail(pi, ctx, message(error), undefined, undefined, command);
        }
      },
    });
  }

  pi.registerCommand("ask", {
    description: DESCRIPTION,
    handler: async (args, ctx) => {
      let parsed: AskRequest;
      try {
        const help = askHelp(args);
        if (help !== undefined) {
          showText(pi, ctx, "sm-google-workspace", help, slashCommand(args));
          return;
        }
        parsed = parseAskArgs(args);
      } catch (error) {
        fail(pi, ctx, message(error), undefined, undefined, commandLine("ask", args));
        return;
      }

      try {
        if (hasStandingSave(parsed)) {
          const saved = await saveDefault(parsed, ctx.modelRegistry);
          const line = `Default saved: ${saved.provider}/${saved.model} · effort ${saved.thinking}. Applies to the next launch.`;
          ctx.ui.notify(line, "info");
          if (!ctx.hasUI) toStdout(line);
          recordCommandIfUnsaved(ctx.sessionManager, slashCommand(args));
          return;
        }

        const choice = effectiveChoice(parsed, await readStandingModel());
        const rates = await readRates();
        sync(rates.version);
        const outcome = await runAsk(
          {
            question: parsed.question,
            provider: choice.provider,
            model: choice.model,
            effort: choice.effort,
            timeoutSeconds: parsed.timeoutSeconds,
            sessionId: ctx.sessionManager.getSessionId().trim() || undefined,
          },
          {
            registry: ctx.modelRegistry as unknown as RegistryLike,
            ledger: open(),
            rates,
            signal: ctx.signal,
          },
        );
        report(pi, ctx, outcome, args);
      } catch (error) {
        fail(pi, ctx, message(error), undefined, undefined, commandLine("ask", args));
      }
    },
  });
}

async function saveDefault(parsed: AskRequest, registry: RegistryLike): Promise<DefaultModel> {
  const current = await readStandingModel();
  // Same rule as a run: a model named on the command line brings no provider with it.
  const choice = effectiveChoice(
    { provider: parsed.setDefaultProvider, model: parsed.setDefaultModel, effort: parsed.setDefaultEffort },
    current,
  );
  if (!choice.model) throw new Error("No model to save. Pass --set-default-model or save one first.");
  const resolved = resolveModel(registry, choice.provider, choice.model);
  return writeDefaultModel({ provider: resolved.provider, model: resolved.id, thinking: choice.effort ?? "low" });
}

function report(pi: ExtensionAPI, ctx: ExtensionCommandContext, outcome: AskOutcome, args: string): void {
  const footer = formatFooter(outcome);
  recordCommandIfUnsaved(ctx.sessionManager, slashCommand(args));

  if (outcome.status === "failed") {
    fail(pi, ctx, outcome.failure ?? "ask failed", footer, outcome);
    return;
  }

  if (!ctx.hasUI) toStdout(outcome.text);
  console.error(footer);
  pi.sendMessage(
    { customType: "sm-google-workspace", content: `${outcome.text}\n\n${footer}`, display: true, details: details(outcome) },
    { triggerTurn: false },
  );
}

function fail(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  text: string,
  footer?: string,
  outcome?: AskOutcome,
  command?: string,
): void {
  if (command) recordCommandIfUnsaved(ctx.sessionManager, command);
  ctx.ui.notify(text, "error");
  console.error(`[FAIL] ${text}`);
  // Print mode is a script: a failure must be visible in `$?`, not only in the
  // text. `process.exitCode` lets Pi finish writing the session file first.
  if (!ctx.hasUI) process.exitCode = 1;
  pi.sendMessage(
    {
      customType: "sm-google-workspace",
      content: `[FAIL] ${text}${footer ? `\n${footer}` : ""}`,
      display: true,
      ...(outcome ? { details: details(outcome) } : {}),
    },
    { triggerTurn: false },
  );
}

function details(outcome: AskOutcome) {
  return {
    runId: outcome.runId,
    status: outcome.status,
    provider: outcome.provider,
    model: outcome.modelRequested,
    tokens: outcome.tokens,
    costEstimated: outcome.costEstimated,
    costPi: outcome.costPi,
    ratesVersion: outcome.ratesVersion,
    durationMs: outcome.durationMs,
  };
}

function showText(pi: ExtensionAPI, ctx: ExtensionCommandContext, customType: string, text: string, command: string): void {
  if (!ctx.hasUI) toStdout(text);
  recordCommandIfUnsaved(ctx.sessionManager, command);
  pi.sendMessage({ customType, content: text, display: true }, { triggerTurn: false });
}

/**
 * Pi patches `console` to write to stderr in print mode, so the answer goes to
 * file descriptor 1 directly and stays pipeable.
 */
function toStdout(text: string): void {
  writeSync(1, `${text}\n`);
}

function commandLine(name: string, args: string): string {
  const rest = args.trim();
  return rest ? `/${name} ${rest}` : `/${name}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "ask failed.";
}
