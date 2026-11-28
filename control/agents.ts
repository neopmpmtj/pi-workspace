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
  /** Page on :8786. Null when this agent is not served there. */
  sitePath: string | null;
}

export const PI_ROOT = path.resolve(import.meta.dirname, "..");

export const PROJECT_PORT = 8786;

/** Image describer's page. Its API stays on :8788. */
export const IMAGE_DESCRIBER_PAGE = "http://127.0.0.1:5173";

export const AGENTS: readonly AgentSpec[] = [
  { id: "cos", name: "Cos orchestrator", home: "agent", port: 8787, sitePath: "/cos/" },
  { id: "image-describer", name: "Image describer", home: "agent-image-describer/image-describer", port: 8788, sitePath: null },
  { id: "web-master", name: "Web master", home: "agent-web-master/web-master", port: 8789, sitePath: "/web-master/" },
  { id: "tasks", name: "Tasks", home: "agent-tasks-agent/tasks-agent", port: 8791, sitePath: "/tasks/" },
  {
    id: "google-workspace",
    name: "Google Workspace",
    home: "agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace",
    port: null,
    sitePath: null,
  },
];

/** Where Open sends the browser. Site pages stay on :8786; image describer stays on :5173. */
export function agentOpenUrl(agent: AgentSpec): string {
  if (agent.sitePath) return agent.sitePath;
  if (agent.id === "image-describer") return IMAGE_DESCRIBER_PAGE;
  return "";
}

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
