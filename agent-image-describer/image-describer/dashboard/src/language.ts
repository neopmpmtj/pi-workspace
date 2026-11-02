import { api } from "./data.ts";

interface LanguageResponse {
  language?: string;
  error?: string;
}

export async function renderDefaultLanguage(mount: HTMLElement): Promise<void> {
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Later runs use this language unless that run passes its own.";
  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  const name = document.createElement("span");
  name.textContent = "Language";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 80;
  input.setAttribute("aria-label", "Default language");
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save";
  save.disabled = true;
  const status = document.createElement("p");
  status.className = "status";
  label.append(name, input);
  field.append(label, save, status);
  mount.append(hint, field);

  try {
    const language = await loadLanguage();
    input.value = language;
    input.dataset.saved = language;
  } catch (error) {
    input.disabled = true;
    status.textContent = error instanceof Error ? error.message : "Could not load the default language.";
    return;
  }

  const refresh = (): void => {
    save.disabled = input.value.trim() === (input.dataset.saved ?? "") || input.value.trim() === "";
  };
  input.addEventListener("input", refresh);
  save.addEventListener("click", () => {
    void store(input, save, status);
  });
}

async function store(input: HTMLInputElement, save: HTMLButtonElement, status: HTMLElement): Promise<void> {
  const previous = input.dataset.saved ?? input.value;
  status.textContent = "";
  input.disabled = true;
  save.disabled = true;
  try {
    const language = await putLanguage(input.value);
    input.value = language;
    input.dataset.saved = language;
  } catch (error) {
    input.value = previous;
    status.textContent = error instanceof Error ? error.message : "Could not save the default language.";
  } finally {
    input.disabled = false;
    save.disabled = input.value.trim() === (input.dataset.saved ?? "");
  }
}

async function loadLanguage(): Promise<string> {
  return readLanguage(await fetch(`${api}/api/default-language`));
}

async function putLanguage(language: string): Promise<string> {
  return readLanguage(await fetch(`${api}/api/default-language`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language }),
  }));
}

async function readLanguage(response: Response): Promise<string> {
  let body: LanguageResponse = {};
  try {
    body = await response.json() as LanguageResponse;
  } catch {
    body = {};
  }
  if (!response.ok) throw new Error(body.error ?? `Default language request returned ${response.status}.`);
  if (typeof body.language !== "string" || !body.language.trim()) {
    throw new Error("Default language response did not include a language.");
  }
  return body.language;
}
