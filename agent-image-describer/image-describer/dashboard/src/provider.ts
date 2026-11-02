import { MODELS, lookupModel, providerIds, type ProviderId } from "../../src/models.ts";
import { api } from "./data.ts";

interface Selection {
  provider: ProviderId;
  model: string;
}

interface SelectionResponse {
  provider?: string;
  model?: string;
  error?: string;
}

export async function renderDefaultProvider(mount: HTMLElement): Promise<void> {
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Later runs use this model unless that run passes its own.";
  const fields = document.createElement("div");
  fields.className = "fields";
  const provider = selectField("Provider", providerIds());
  const model = selectField("Model", Object.keys(MODELS));
  const status = document.createElement("p");
  status.className = "status";
  fields.append(provider.wrap, model.wrap);
  mount.append(hint, fields, status);
  try {
    const saved = await loadSelection();
    apply(provider.select, model.select, saved);
  } catch (error) {
    provider.select.disabled = true;
    model.select.disabled = true;
    status.textContent = error instanceof Error ? error.message : "Could not load the default model.";
    return;
  }
  provider.select.addEventListener("change", () => {
    const next = provider.select.value;
    const models = Object.values(MODELS).filter((entry) => entry.provider === next);
    const current = models.find((entry) => entry.id === model.select.value);
    if (models.length === 1) model.select.value = models[0].id;
    else if (!current) {
      status.textContent = "Choose a model for this provider.";
      return;
    }
    void save(provider.select, model.select, status);
  });
  model.select.addEventListener("change", () => {
    provider.select.value = lookupModel(model.select.value).provider;
    void save(provider.select, model.select, status);
  });
}

function selectField(label: string, values: readonly string[]): { wrap: HTMLLabelElement; select: HTMLSelectElement } {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const name = document.createElement("span");
  name.textContent = label;
  const select = document.createElement("select");
  select.setAttribute("aria-label", `Default ${label.toLowerCase()}`);
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  wrap.append(name, select);
  return { wrap, select };
}

function apply(provider: HTMLSelectElement, model: HTMLSelectElement, saved: Selection): void {
  provider.value = saved.provider;
  model.value = saved.model;
  provider.dataset.saved = saved.provider;
  model.dataset.saved = saved.model;
}

async function save(provider: HTMLSelectElement, model: HTMLSelectElement, status: HTMLElement): Promise<void> {
  const previousProvider = provider.dataset.saved ?? provider.value;
  const previousModel = model.dataset.saved ?? model.value;
  status.textContent = "";
  provider.disabled = true;
  model.disabled = true;
  try {
    apply(provider, model, await putSelection(provider.value, model.value));
  } catch (error) {
    provider.value = previousProvider;
    model.value = previousModel;
    status.textContent = error instanceof Error ? error.message : "Could not save the default model.";
  } finally {
    provider.disabled = false;
    model.disabled = false;
  }
}

async function loadSelection(): Promise<Selection> {
  return readSelection(await fetch(`${api}/api/default-provider`));
}

async function putSelection(provider: string, model: string): Promise<Selection> {
  return readSelection(await fetch(`${api}/api/default-provider`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, model }),
  }));
}

async function readSelection(response: Response): Promise<Selection> {
  let body: SelectionResponse = {};
  try {
    body = await response.json() as SelectionResponse;
  } catch {
    body = {};
  }
  if (!response.ok) throw new Error(body.error ?? `Default model request returned ${response.status}.`);
  if (typeof body.provider !== "string" || typeof body.model !== "string") {
    throw new Error("Default model response did not include a provider and model.");
  }
  const model = lookupModel(body.model);
  if (model.provider !== body.provider) {
    throw new Error(`Default model response pairs ${body.provider} with ${model.id}.`);
  }
  return { provider: model.provider, model: model.id };
}
