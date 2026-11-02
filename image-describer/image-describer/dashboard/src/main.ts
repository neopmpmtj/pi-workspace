import { getInstanceByDom } from "./chart.ts";
import { loadRows, subscribe, type Rows } from "./data.ts";
import { renderPrompts } from "./prompts.ts";
import { visualizations } from "./registry.ts";
import { renderCountEffort, renderDetailedEffort, renderPresetEffort } from "./effort.ts";
import { renderImagesDir } from "./images-dir.ts";
import { renderDefaultLanguage } from "./language.ts";
import { renderDefaultProvider } from "./provider.ts";
import { renderSettings } from "./settings.ts";
import { chatViz } from "./viz/chat.ts";
import { imagesViz } from "./viz/images.ts";
import { tokensViz } from "./viz/tokens.ts";
import "./style.css";

const app = document.querySelector("#app");
if (!(app instanceof HTMLElement)) throw new Error("Missing #app");

const status = document.createElement("p");
status.className = "status";
status.textContent = "loading";
const heading = document.createElement("h1");
heading.textContent = "Image describer";
const nav = document.createElement("nav");
const header = document.createElement("header");
header.append(heading, nav, status);
app.append(header);

const views = {
  metrics: view("Metrics"),
  settings: view("Settings"),
};
type ViewId = keyof typeof views;

const mode = settingsGroup(views.settings.panel, "Mode");
void renderSettings(settingsBlock(mode, "Default"));
const effort = settingsBlock(mode, "Effort");
effort.className = "fields";
void renderPresetEffort(effort);
void renderDetailedEffort(effort);
void renderCountEffort(effort);
void renderDefaultLanguage(settingsBlock(mode, "Language"));
void renderImagesDir(settingsBlock(mode, "Images directory"));

const model = settingsGroup(views.settings.panel, "Model");
void renderDefaultProvider(settingsBlock(model));

void renderPrompts(settingsGroup(views.settings.panel, "Prompts"));

const mounts = new Map<string, HTMLElement>();
for (const viz of visualizations) mounts.set(viz.id, section(views.metrics.panel, viz.title));

window.addEventListener("hashchange", show);
show();

try {
  const rows = await loadRows();
  paint(rows);
  subscribe(rows, () => paint(rows), (next) => {
    status.textContent = next;
  });
} catch (error) {
  status.textContent = error instanceof Error ? error.message : "Dashboard API unavailable.";
}

function view(label: string): { link: HTMLAnchorElement; panel: HTMLElement } {
  const id = label.toLowerCase();
  const link = document.createElement("a");
  link.href = `#${id}`;
  link.textContent = label;
  nav.append(link);
  const panel = document.createElement("div");
  panel.id = id;
  (app as HTMLElement).append(panel);
  return { link, panel };
}

function section(parent: HTMLElement, title: string): HTMLElement {
  const wrapper = document.createElement("section");
  const h2 = document.createElement("h2");
  h2.textContent = title;
  const mount = document.createElement("div");
  wrapper.append(h2, mount);
  parent.append(wrapper);
  return mount;
}

function settingsGroup(parent: HTMLElement, title: string): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = "settings-group";
  const h2 = document.createElement("h2");
  h2.textContent = title;
  const body = document.createElement("div");
  wrapper.append(h2, body);
  parent.append(wrapper);
  return body;
}

function settingsBlock(parent: HTMLElement, title?: string): HTMLElement {
  const block = document.createElement("section");
  block.className = "settings-block";
  const mount = document.createElement("div");
  if (title) {
    const heading = document.createElement("h3");
    heading.textContent = title;
    block.append(heading);
  }
  block.append(mount);
  parent.append(block);
  return mount;
}

function show(): void {
  const requested = location.hash.slice(1);
  const active: ViewId = requested in views ? requested as ViewId : "metrics";
  for (const [id, { link, panel }] of Object.entries(views)) {
    const on = id === active;
    panel.hidden = !on;
    if (on) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (active === "metrics") {
    for (const plot of Array.from(views.metrics.panel.querySelectorAll<HTMLElement>(".plot"))) {
      getInstanceByDom(plot)?.resize();
    }
  }
}

function paint(rows: Rows): void {
  for (const viz of visualizations) {
    const mount = mounts.get(viz.id);
    if (!mount) continue;
    if (viz === chatViz || viz === tokensViz) viz.render(mount, rows.images, rows.chat, rows.rates);
    else if (viz === imagesViz) viz.render(mount, rows.images);
  }
}
