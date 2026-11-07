// Starts and stops the four agent dashboards. Stop only signals a process this
// server spawned. A port that is already open is left running.
import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import path from "node:path";
import { agentDir, dashboardAgents, PI_ROOT, type AgentSpec } from "./agents.ts";
import { readControlPlane, SettingsError } from "./store.ts";

export interface AgentRun {
  id: string;
  name: string;
  port: number;
  url: string;
  provider: string;
  model: string;
  listening: boolean;
  owned: boolean;
}

interface Owned {
  process: ChildProcess;
}

const owned = new Map<string, Owned>();

export async function listRuns(root = PI_ROOT): Promise<AgentRun[]> {
  const plane = await readControlPlane(root);
  const byId = new Map(plane.agents.map((agent) => [agent.id, agent]));
  const runs: AgentRun[] = [];
  for (const agent of dashboardAgents()) {
    const card = byId.get(agent.id);
    const port = agent.port ?? 0;
    runs.push({
      id: agent.id,
      name: agent.name,
      port,
      url: `http://127.0.0.1:${port}`,
      provider: card?.provider ?? "",
      model: card?.model ?? "",
      listening: await portOpen(port),
      owned: owned.has(agent.id),
    });
  }
  return runs;
}

export async function startAgent(id: string, root = PI_ROOT): Promise<AgentRun> {
  const agent = requireDashboard(id);
  if (await portOpen(agent.port!)) {
    openBrowser(`http://127.0.0.1:${agent.port}`);
    return one(root, agent);
  }
  const child = spawn("npm", ["run", "dashboard"], {
    cwd: agentDir(root, agent),
    env: {
      ...process.env,
      DASHBOARD_PORT: String(agent.port),
      DASHBOARD_HOST: "127.0.0.1",
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    },
    detached: true,
    stdio: "ignore",
  });
  child.on("exit", () => {
    const current = owned.get(agent.id);
    if (current?.process === child) owned.delete(agent.id);
  });
  child.unref();
  owned.set(agent.id, { process: child });
  const up = await waitForPort(agent.port!, 20000);
  if (!up) {
    stopOwned(agent.id);
    throw new SettingsError(`${agent.name} dashboard did not open on port ${agent.port}.`);
  }
  openBrowser(`http://127.0.0.1:${agent.port}`);
  return one(root, agent);
}

export async function stopAgent(id: string, root = PI_ROOT): Promise<AgentRun> {
  const agent = requireDashboard(id);
  if (!owned.has(agent.id)) throw new SettingsError(`${agent.name} was not started from this dashboard.`);
  stopOwned(agent.id);
  await waitForClose(agent.port!, 4000);
  return one(root, agent);
}

export async function openAgent(id: string, root = PI_ROOT): Promise<AgentRun> {
  const agent = requireDashboard(id);
  openBrowser(`http://127.0.0.1:${agent.port}`);
  return one(root, agent);
}

export async function startAll(root = PI_ROOT): Promise<{ agents: AgentRun[]; error: string | null }> {
  const errors: string[] = [];
  for (const agent of dashboardAgents()) {
    try {
      await startAgent(agent.id, root);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { agents: await listRuns(root), error: errors.length ? errors.join(" ") : null };
}

export async function stopAll(root = PI_ROOT): Promise<AgentRun[]> {
  const runs: AgentRun[] = [];
  for (const agent of dashboardAgents()) {
    if (!owned.has(agent.id)) {
      runs.push(await one(root, agent));
      continue;
    }
    runs.push(await stopAgent(agent.id, root));
  }
  return runs;
}

function requireDashboard(id: string): AgentSpec {
  const agent = dashboardAgents().find((item) => item.id === id);
  if (!agent || agent.port === null) throw new SettingsError(`No dashboard for ${id}.`);
  return agent;
}

async function one(root: string, agent: AgentSpec): Promise<AgentRun> {
  const runs = await listRuns(root);
  const found = runs.find((run) => run.id === agent.id);
  if (!found) throw new SettingsError(`${agent.name} is missing from the registry.`);
  return found;
}

function stopOwned(id: string): void {
  const current = owned.get(id);
  owned.delete(id);
  const pid = current?.process.pid;
  if (!pid) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process has already exited.
    }
  }
}

function openBrowser(url: string): void {
  try {
    const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // The dashboard is up even when the desktop cannot open a browser.
  }
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (open: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await delay(200);
  }
  return false;
}

async function waitForClose(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portOpen(port))) return;
    await delay(200);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
