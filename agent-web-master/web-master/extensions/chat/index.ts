// Pi extension for the web-master agent.
//
// `/ask` looks the question up on the configured web route, then sends one
// request through Pi's model registry. Same catalog and credentials as a chat
// turn, and no chat turn is started. A prompt that is not a slash command is
// the research chat, and that turn can call the web tools itself.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ASK_HELP, commandHelp, hasStandingSave, parseAskArgs, parseUsageArgs, USAGE_HELP, type AskRequest } from "../../src/args.ts";
import { effectiveChoice } from "../../src/effective.ts";
import { resolveModel, runAsk, type AskOutcome, type RegistryLike } from "../../src/ask.ts";
import { readDefaultModel, writeDefaultModel, type DefaultModel } from "../../src/default-model.ts";
import { ledgerPath, sessionsRoot } from "../../ledger/env.ts";
import { syncSessions } from "../../ledger/ingest.ts";
import { syncToolCalls } from "../../ledger/search-ingest.ts";
import { readToolRates } from "../../ledger/tool-rates.ts";
import { readToolCalls } from "../../ledger/tool-store.ts";
import { formatTools, usageView } from "../../src/usage.ts";
import { readRates } from "../../ledger/rates.ts";
import { openLedger, type Ledger } from "../../ledger/store.ts";
import { formatFooter } from "../../src/report.ts";
import { recordCommandIfUnsaved, slashCommand } from "../../src/session-command.ts";

const DESCRIPTION = 'One web lookup, then one request, no chat turn: /ask "question". /ask --help lists the flags.';

/** Published into docs/CALLING.md by scripts/publish.ts. Keys are the command names. */
export const HELP: Record<string, string> = { ask: ASK_HELP, usage: USAGE_HELP };

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

  const syncTools = (rates: Awaited<ReturnType<typeof readToolRates>>): void => {
    try {
      syncToolCalls(open(), { sessionsRoot: sessionsRoot(), rates });
    } catch {
      // Same rule: a bad session file is not allowed to break a command.
    }
  };

  pi.on("session_start", async () => {
    try {
      sync((await readRates()).version);
      syncTools(await readToolRates());
    } catch {
      // Nothing to report at startup.
    }
  });

  pi.registerCommand("usage", {
    description: "Tokens and cost: /usage · /usage --usage-totals · /usage --this-session · /usage --web-search · /usage <runId> · /usage --help",
    handler: async (args, ctx) => {
      try {
        const help = commandHelp("usage", args);
        if (help !== undefined) {
          show(pi, ctx, "usage", "web-master-usage", args, help);
          return;
        }
        const selection = parseUsageArgs(args);
        const rates = await readRates();
        const toolRates = await readToolRates();
        const ledger = open();
        sync(rates.version);
        syncTools(toolRates);
        const tools = readToolCalls(ledger, toolRates);

        if (selection.kind === "web-search") {
          const text = formatTools(tools.map((row) => ({
            tool: row.tool,
            startedAt: row.startedAt,
            searches: row.searches,
            urls: row.urls,
            results: row.results,
            providers: row.providerCounts,
            costEstimated: row.costEstimated,
            costStatus: row.costStatus,
            durationMs: row.durationMs,
            status: row.status,
          })));
          if (!ctx.hasUI) toStdout(text);
          pi.sendMessage({ customType: "web-master-usage", content: text, display: true, details: { toolCalls: tools.length } }, { triggerTurn: false });
          return;
        }

        const view = usageView(
          ledger,
          rates,
          selection.kind === "all"
            ? { kind: "all" }
            : selection.kind === "session"
              ? { kind: "session", sessionId: ctx.sessionManager.getSessionId().trim() }
              : selection.kind === "run"
                ? { kind: "run", prefix: selection.prefix }
                : { kind: "last" },
          tools,
        );
        if (!ctx.hasUI) toStdout(view.text);
        pi.sendMessage(
          { customType: "web-master-usage", content: view.text, display: true, details: { runs: view.runs.length } },
          { triggerTurn: false },
        );
      } catch (error) {
        fail(pi, ctx, message(error), undefined, undefined, commandLine("usage", args));
      }
    },
  });

  pi.registerCommand("ask", {
    description: DESCRIPTION,
    handler: async (args, ctx) => {
      let parsed: AskRequest;
      try {
        const help = commandHelp("ask", args);
        if (help !== undefined) {
          show(pi, ctx, "ask", "web-master", args, help);
          return;
        }
        parsed = parseAskArgs(args);
      } catch (error) {
        fail(pi, ctx, message(error), undefined, undefined, commandLine("ask", args));
        return;
      }

      try {
        if (hasStandingSave(parsed)) {
          const line = await saveModel(parsed, ctx.modelRegistry as unknown as RegistryLike);
          ctx.ui.notify(line, "info");
          if (!ctx.hasUI) toStdout(line);
          recordCommandIfUnsaved(ctx.sessionManager, slashCommand(args));
          return;
        }

        const choice = effectiveChoice(parsed, await readDefaultModel());
        const rates = await readRates();
        sync(rates.version);
        const outcome = await runAsk(
          {
            question: parsed.question,
            provider: choice.provider,
            model: choice.model,
            effort: choice.effort,
            prompt: parsed.prompt,
            timeoutSeconds: parsed.timeoutSeconds,
            sessionId: ctx.sessionManager.getSessionId().trim() || undefined,
            sessionFile: ctx.sessionManager.getSessionFile() || undefined,
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

async function saveModel(parsed: AskRequest, registry: RegistryLike): Promise<string> {
  const current = await readDefaultModel();
  // Same rule as a run: a model named on the command line brings no provider with it.
  const choice = effectiveChoice(
    { provider: parsed.setDefaultProvider, model: parsed.setDefaultModel, effort: parsed.setDefaultEffort },
    current,
  );
  if (!choice.model) throw new Error("No model to save. Pass --set-default-web-master-model or save one first.");
  const resolved = resolveModel(registry, choice.provider, choice.model);
  const saved: DefaultModel = await writeDefaultModel({
    provider: resolved.provider,
    model: resolved.id,
    effort: choice.effort ?? "low",
  });
  return `Default saved: ${saved.provider}/${saved.model} · effort ${saved.effort}. Applies to the next /ask, and to the next launch.`;
}

function show(pi: ExtensionAPI, ctx: ExtensionCommandContext, name: string, customType: string, args: string, text: string): void {
  if (!ctx.hasUI) toStdout(text);
  recordCommandIfUnsaved(ctx.sessionManager, commandLine(name, args));
  pi.sendMessage({ customType, content: text, display: true }, { triggerTurn: false });
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
    { customType: "web-master", content: `${outcome.text}\n\n${footer}`, display: true, details: details(outcome) },
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
      customType: "web-master",
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
    webProvider: outcome.webProvider,
    tokens: outcome.tokens,
    costEstimated: outcome.costEstimated,
    costPi: outcome.costPi,
    ratesVersion: outcome.ratesVersion,
    durationMs: outcome.durationMs,
  };
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
