import type { ECharts } from "echarts/core";
import { init } from "../chart.ts";
import type { ImagePoint } from "../../parse.ts";

const mounts = new WeakMap<HTMLElement, { select: HTMLSelectElement; plot: HTMLElement; chart: ECharts }>();
const latest = new WeakMap<HTMLElement, ImagePoint[]>();

export const imagesViz = {
  id: "image-metrics",
  title: "Image duration and tokens",
  source: "images" as const,
  render(el: HTMLElement, rows: ImagePoint[]): void {
    latest.set(el, rows);
    const ui = mount(el);
    const modes = [...new Set(rows.map((row) => row.mode))].sort();
    const selected = ui.select.value || "all";
    ui.select.replaceChildren();
    ui.select.append(option("all", "All modes"));
    for (const mode of modes) ui.select.append(option(mode, mode));
    ui.select.value = selected === "all" || modes.includes(selected) ? selected : "all";
    const shown = ui.select.value === "all" ? rows : rows.filter((row) => row.mode === ui.select.value);
    const counts = new Map<string, number>();
    for (const row of shown) counts.set(row.filename, (counts.get(row.filename) ?? 0) + 1);
    ui.chart.setOption({
      backgroundColor: "transparent",
      textStyle: { color: "#e7ecf2" },
      tooltip: {
        trigger: "axis",
        formatter(params: unknown) {
          const items = Array.isArray(params) ? params : [params];
          const index = itemIndex(items[0]);
          const row = shown[index];
          if (!row) return "";
          return [
            row.filename,
            `${row.mode} · ${row.effort} · ${row.language} · ${row.model} · ${row.status}`,
            `Duration: ${row.apiDurationSeconds ?? "none"} s`,
            `Tokens: ${row.totalTokens ?? "none"}`,
          ].join("<br>");
        },
      },
      legend: { top: 0, textStyle: { color: "#e7ecf2" } },
      grid: { left: 16, right: 16, top: 48, bottom: 8, containLabel: true },
      xAxis: {
        type: "category",
        data: shown.map((row) => label(row, counts)),
        axisLabel: { color: "#c5d0dc", rotate: 30, width: 140, overflow: "truncate" },
      },
      yAxis: [
        { type: "value", name: "Seconds", nameTextStyle: { color: "#c5d0dc" }, axisLabel: { color: "#c5d0dc" } },
        { type: "value", name: "Tokens", nameTextStyle: { color: "#c5d0dc" }, axisLabel: { color: "#c5d0dc" } },
      ],
      series: [
        { name: "Duration", type: "bar", yAxisIndex: 0, data: shown.map((row) => row.apiDurationSeconds) },
        { name: "Tokens", type: "line", yAxisIndex: 1, data: shown.map((row) => row.totalTokens) },
      ],
    }, true);
  },
};

function mount(el: HTMLElement): { select: HTMLSelectElement; plot: HTMLElement; chart: ECharts } {
  const existing = mounts.get(el);
  if (existing) return existing;
  const select = document.createElement("select");
  select.addEventListener("change", () => {
    const rows = latest.get(el);
    if (rows) imagesViz.render(el, rows);
  });
  const plot = document.createElement("div");
  plot.className = "plot";
  el.append(select, plot);
  const chart = init(plot);
  window.addEventListener("resize", () => chart.resize());
  const created = { select, plot, chart };
  mounts.set(el, created);
  return created;
}

function label(row: ImagePoint, counts: Map<string, number>): string {
  return (counts.get(row.filename) ?? 0) > 1 ? `${row.filename} (${row.runId.slice(0, 8)})` : row.filename;
}

function option(value: string, text: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = text;
  return element;
}

function itemIndex(item: unknown): number {
  if (!item || typeof item !== "object" || !("dataIndex" in item)) return -1;
  const index = item.dataIndex;
  return typeof index === "number" ? index : -1;
}
