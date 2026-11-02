import { api } from "./data.ts";

interface ImagesDirResponse {
  dir?: string | null;
  error?: string;
}

export async function renderImagesDir(mount: HTMLElement): Promise<void> {
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "Later runs that omit --dir use this folder. External scripts can read images-dir.json. Relative paths resolve from the agent directory.";
  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  const name = document.createElement("span");
  name.textContent = "Images directory";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "images-dir";
  input.maxLength = 4096;
  input.setAttribute("aria-label", "Images directory");
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
    const dir = await loadImagesDir();
    input.value = dir ?? "";
    input.dataset.saved = dir ?? "";
  } catch (error) {
    input.disabled = true;
    status.textContent = error instanceof Error ? error.message : "Could not load the images directory.";
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
    const dir = await putImagesDir(input.value);
    input.value = dir;
    input.dataset.saved = dir;
  } catch (error) {
    input.value = previous;
    status.textContent = error instanceof Error ? error.message : "Could not save the images directory.";
  } finally {
    input.disabled = false;
    save.disabled = input.value.trim() === (input.dataset.saved ?? "");
  }
}

async function loadImagesDir(): Promise<string | null> {
  return readImagesDir(await fetch(`${api}/api/images-dir`));
}

async function putImagesDir(dir: string): Promise<string> {
  const result = await readImagesDir(await fetch(`${api}/api/images-dir`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dir }),
  }));
  if (result === null) throw new Error("Images directory response did not include a dir.");
  return result;
}

async function readImagesDir(response: Response): Promise<string | null> {
  let body: ImagesDirResponse = {};
  try {
    body = await response.json() as ImagesDirResponse;
  } catch {
    body = {};
  }
  if (!response.ok) throw new Error(body.error ?? `Images directory request returned ${response.status}.`);
  if (body.dir === null || body.dir === undefined) return null;
  if (typeof body.dir !== "string" || !body.dir.trim()) {
    throw new Error("Images directory response did not include a dir.");
  }
  return body.dir;
}
