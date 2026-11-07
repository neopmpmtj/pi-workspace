import path from "node:path";

/**
 * The Pi agent home. Set by the launcher; the fallback keeps tests and direct
 * `node` calls working without one.
 */
export function agentDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PI_CODING_AGENT_DIR?.trim();
  if (configured) return configured;
  return path.join(env.HOME ?? "", ".pi", "agent-tasks-agent", "tasks-agent");
}

/** The folder that holds `.env` and the rate card, one level above the agent home. */
export function repoRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.dirname(agentDir(env));
}

/** Dollars live in a file beside `.env`, never in a database column. */
export function rateCardPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(repoRoot(env), "model-rates.json");
}

/** Pi's own provider catalog: the fallback rate source, and where prices come from. */
export function modelsStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(agentDir(env), "models-store.json");
}

/** Pi writes one JSONL per session, grouped by working directory. */
export function sessionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(agentDir(env), "sessions");
}

export function ledgerPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(agentDir(env), "logs", "ledger.sqlite");
}

/** The provider, model, and thinking level the launcher reads at startup. */
export function defaultModelPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(agentDir(env), "default-model.json");
}

/** Pi's own defaults. `/ask` uses these when `default-model.json` is absent. */
export function settingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(agentDir(env), "settings.json");
}

/** Instructions for `/ask` runs, editable from the dashboard. */
export function promptsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(agentDir(env), "prompts.json");
}
