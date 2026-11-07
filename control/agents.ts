// Homes the settings UI and dashboard start/stop know (:8786 / pi-config).
// Not the COS delegation roster — that is APPEND_SYSTEM.md, built from agent.json.
// Copies and the scaffold are omitted. lan-agent is roster-only (no row here).
import path from "node:path";

export interface AgentSpec {
  id: string;
  name: string;
  /** Path under the ~/.pi root. */
  home: string;
  /** Dashboard port. Null when this agent has no dashboard. */
  port: number | null;
}

export const PI_ROOT = path.resolve(import.meta.dirname, "..");

export const PROJECT_PORT = 8786;

export const AGENTS: readonly AgentSpec[] = [
  { id: "cos", name: "Cos orchestrator", home: "agent/cos-orchestrator-agent", port: 8787 },
  { id: "image-describer", name: "Image describer", home: "agent-image-describer/image-describer", port: 8788 },
  { id: "web-master", name: "Web master", home: "agent-web-master/web-master", port: 8789 },
  { id: "tasks", name: "Tasks", home: "agent-tasks-agent/tasks-agent", port: 8791 },
  {
    id: "google-workspace",
    name: "Google Workspace",
    home: "agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace",
    port: null,
  },
];

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function agentById(id: string): AgentSpec | undefined {
  return AGENTS.find((agent) => agent.id === id);
}

export function agentDir(root: string, agent: AgentSpec): string {
  return path.join(root, agent.home);
}

export function dashboardAgents(): readonly AgentSpec[] {
  return AGENTS.filter((agent) => agent.port !== null);
}
