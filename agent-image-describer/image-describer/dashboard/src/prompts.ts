import type { PromptMode } from "../../src/prompt.ts";
import { api } from "./data.ts";

interface PromptEntry {
  mode: PromptMode;
  builtIn: string;
  saved: string | null;
}

interface PromptsBody {
  shape: string;
  rules: string;
  placeholder: string;
  maxLength: number;
  prompts: PromptEntry[];
}

export async function renderPrompts(mount: HTMLElement): Promise<void> {
  const status = document.createElement("p");
  status.className = "status";
  mount.append(status);
  try {
    paint(mount, await request("GET", ""));
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not load the prompts.";
  }
}

function paint(mount: HTMLElement, body: PromptsBody): void {
  const intro = document.createElement("p");
  intro.className = "hint";
  intro.textContent = `Write ${body.placeholder} where the language should go. Every preset then adds this output shape and this rules sentence. Neither can be edited:`;
  const shape = document.createElement("blockquote");
  shape.className = "rules";
  shape.textContent = body.shape;
  const rules = document.createElement("blockquote");
  rules.className = "rules";
  rules.textContent = body.rules;
  const list = document.createElement("div");
  list.className = "prompts";
  for (const entry of body.prompts) list.append(editor(entry, body));
  mount.replaceChildren(intro, shape, rules, list);
}

function editor(entry: PromptEntry, body: PromptsBody, message?: string): HTMLElement {
  const card = document.createElement("article");
  card.className = "prompt";

  const heading = document.createElement("h3");
  heading.textContent = entry.mode;
  const badge = document.createElement("span");
  badge.className = entry.saved === null ? "badge" : "badge edited";
  badge.textContent = entry.saved === null ? "built-in" : "edited";
  heading.append(badge);

  const current = entry.saved ?? entry.builtIn;
  const text = document.createElement("textarea");
  text.value = current;
  text.rows = 5;
  text.maxLength = body.maxLength;
  text.setAttribute("aria-label", `${entry.mode} prompt`);

  const note = document.createElement("p");
  note.className = "status";

  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset to built-in";
  reset.disabled = entry.saved === null;
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(save, reset);

  const refresh = (): void => {
    const value = text.value.trim();
    save.disabled = !value || value === current.trim();
    note.textContent = value.includes(body.placeholder)
      ? `${text.value.length} / ${body.maxLength} characters`
      : `No ${body.placeholder} placeholder, so --language has no effect on this mode.`;
  };
  text.addEventListener("input", refresh);
  refresh();
  if (message) note.textContent = message;

  const run = async (method: "PUT" | "DELETE", payload?: { prompt: string }): Promise<void> => {
    for (const control of [text, save, reset]) control.disabled = true;
    try {
      const next = await request(method, `/${entry.mode}`, payload);
      const updated = next.prompts.find((candidate) => candidate.mode === entry.mode);
      if (!updated) throw new Error(`Prompts response did not include ${entry.mode}.`);
      card.replaceWith(editor(updated, next, method === "PUT" ? "Saved. Later runs use this prompt." : "Reset to the built-in prompt."));
    } catch (error) {
      text.disabled = false;
      reset.disabled = entry.saved === null;
      refresh();
      note.textContent = error instanceof Error ? error.message : "Could not save the prompt.";
    }
  };
  save.addEventListener("click", () => void run("PUT", { prompt: text.value }));
  reset.addEventListener("click", () => void run("DELETE"));

  card.append(heading, text, actions, note);
  return card;
}

async function request(method: "GET" | "PUT" | "DELETE", suffix: string, payload?: { prompt: string }): Promise<PromptsBody> {
  const response = await fetch(`${api}/api/prompts${suffix}`, {
    method,
    ...(payload ? { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : {}),
  });
  let body: Partial<PromptsBody> & { error?: string } = {};
  try {
    body = await response.json() as typeof body;
  } catch {
    body = {};
  }
  if (!response.ok) throw new Error(body.error ?? `Prompts request returned ${response.status}.`);
  if (!body.prompts || body.shape === undefined || body.rules === undefined || !body.placeholder || !body.maxLength) {
    throw new Error("Prompts response was incomplete.");
  }
  return body as PromptsBody;
}
