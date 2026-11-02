import { PROMPT_MODES, type PromptMode } from "../../src/prompt.ts";
import { api } from "./data.ts";

type Switches = Record<PromptMode, boolean>;

interface ModeResponse {
  switches?: Switches;
  error?: string;
}

export async function renderSettings(mount: HTMLElement): Promise<void> {
  const list = document.createElement("div");
  list.className = "modes";
  const status = document.createElement("p");
  status.className = "status";
  mount.append(list, status);
  try {
    paint(list, status, await loadSwitches());
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not load the default mode.";
  }
}

function paint(list: HTMLElement, status: HTMLElement, switches: Switches): void {
  list.replaceChildren();
  for (const mode of PROMPT_MODES) {
    const label = document.createElement("label");
    label.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.role = "switch";
    input.checked = switches[mode];
    input.dataset.mode = mode;
    input.setAttribute("aria-checked", String(switches[mode]));
    const name = document.createElement("span");
    name.textContent = mode;
    input.addEventListener("change", () => {
      if (switches[mode]) {
        input.checked = true;
        input.setAttribute("aria-checked", "true");
        return;
      }
      void save(mode, list, status, switches);
    });
    label.append(input, name);
    list.append(label);
  }
  applyEffortState();
}

export function applyEffortState(): void {
  const detailedOn = document.querySelector<HTMLInputElement>('input[data-mode="detailed"]')?.checked === true;
  const countOn = document.querySelector<HTMLInputElement>('input[data-mode="count"]')?.checked === true;
  const detailed = document.querySelector<HTMLSelectElement>('[aria-label="Detailed effort"]');
  if (detailed?.dataset.ready === "true") detailed.disabled = !detailedOn;
  const count = document.querySelector<HTMLSelectElement>('[aria-label="Count effort"]');
  if (count?.dataset.ready === "true") count.disabled = !countOn;
  const preset = document.querySelector<HTMLSelectElement>('[aria-label="Preset effort"]');
  if (preset?.dataset.ready === "true") preset.disabled = detailedOn || countOn;
}

async function save(
  mode: PromptMode,
  list: HTMLElement,
  status: HTMLElement,
  previous: Switches,
): Promise<void> {
  status.textContent = "";
  for (const input of Array.from(list.querySelectorAll("input"))) input.disabled = true;
  try {
    paint(list, status, await putMode(mode));
  } catch (error) {
    paint(list, status, previous);
    status.textContent = error instanceof Error ? error.message : "Could not save the default mode.";
  }
}

async function loadSwitches(): Promise<Switches> {
  return readSwitches(await fetch(`${api}/api/default-mode`));
}

async function putMode(mode: PromptMode): Promise<Switches> {
  return readSwitches(await fetch(`${api}/api/default-mode`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  }));
}

async function readSwitches(response: Response): Promise<Switches> {
  let body: ModeResponse = {};
  try {
    body = await response.json() as ModeResponse;
  } catch {
    body = {};
  }
  if (!response.ok) throw new Error(body.error ?? `Default mode request returned ${response.status}.`);
  if (!body.switches) throw new Error("Default mode response did not include switches.");
  return body.switches;
}
