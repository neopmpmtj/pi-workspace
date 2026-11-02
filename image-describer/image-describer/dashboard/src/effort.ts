import { EFFORT_LEVELS, type EffortLevel } from "../../src/models.ts";
import { api } from "./data.ts";
import { applyEffortState } from "./settings.ts";

interface EffortResponse {
  effort?: string;
  error?: string;
}

interface EffortControl {
  label: string;
  path: string;
  loadError: string;
  saveError: string;
}

const detailedEffort: EffortControl = {
  label: "Detailed effort",
  path: "detailed-effort",
  loadError: "Could not load the detailed effort.",
  saveError: "Could not save the detailed effort.",
};

const countEffort: EffortControl = {
  label: "Count effort",
  path: "count-effort",
  loadError: "Could not load the count effort.",
  saveError: "Could not save the count effort.",
};

const presetEffort: EffortControl = {
  label: "Preset effort",
  path: "preset-effort",
  loadError: "Could not load the preset effort.",
  saveError: "Could not save the preset effort.",
};

export async function renderDetailedEffort(mount: HTMLElement): Promise<void> {
  await renderEffort(mount, detailedEffort);
}

export async function renderCountEffort(mount: HTMLElement): Promise<void> {
  await renderEffort(mount, countEffort);
}

export async function renderPresetEffort(mount: HTMLElement): Promise<void> {
  await renderEffort(mount, presetEffort);
}

async function renderEffort(mount: HTMLElement, control: EffortControl): Promise<void> {
  const field = document.createElement("div");
  field.className = "field effort";
  const label = document.createElement("label");
  const name = document.createElement("span");
  name.textContent = control.label;
  const select = document.createElement("select");
  select.setAttribute("aria-label", control.label);
  for (const level of EFFORT_LEVELS) {
    const option = document.createElement("option");
    option.value = level;
    option.textContent = level;
    select.append(option);
  }
  const status = document.createElement("p");
  status.className = "status";
  select.disabled = true;
  label.append(name, select);
  field.append(label, status);
  mount.append(field);
  try {
    const effort = await loadEffort(control);
    select.value = effort;
    select.dataset.saved = effort;
    select.dataset.ready = "true";
    applyEffortState();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : control.loadError;
    return;
  }
  select.addEventListener("change", () => {
    void save(select, status, control);
  });
}

async function save(select: HTMLSelectElement, status: HTMLElement, control: EffortControl): Promise<void> {
  const previous = select.dataset.saved ?? select.value;
  status.textContent = "";
  select.disabled = true;
  try {
    const effort = await putEffort(select.value, control);
    select.value = effort;
    select.dataset.saved = effort;
  } catch (error) {
    select.value = previous;
    status.textContent = error instanceof Error ? error.message : control.saveError;
  } finally {
    applyEffortState();
  }
}

async function loadEffort(control: EffortControl): Promise<EffortLevel> {
  return readEffort(await fetch(`${api}/api/${control.path}`), control);
}

async function putEffort(effort: string, control: EffortControl): Promise<EffortLevel> {
  return readEffort(await fetch(`${api}/api/${control.path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ effort }),
  }), control);
}

async function readEffort(response: Response, control: EffortControl): Promise<EffortLevel> {
  let body: EffortResponse = {};
  try {
    body = await response.json() as EffortResponse;
  } catch {
    body = {};
  }
  if (!response.ok) throw new Error(body.error ?? `${control.label} request returned ${response.status}.`);
  if (!body.effort || !EFFORT_LEVELS.includes(body.effort as EffortLevel)) {
    throw new Error(`${control.label} response did not include a level.`);
  }
  return body.effort as EffortLevel;
}
