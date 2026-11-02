import type { ECharts } from "echarts/core";
import { getInstanceByDom, init } from "../chart.ts";
import { sessionBars, sessionLabel, type TokenCost } from "../../session-cost.ts";
import { rateLookup, type RatesSnapshot } from "../rates.ts";
import type { ChatPoint, ImagePoint } from "../../parse.ts";

const mounts = new WeakMap<HTMLElement, ECharts>();
const notes = new WeakMap<HTMLElement, HTMLParagraphElement>();

export const chatViz = {
  id: "chat-cost",
  title: "Chat cost",
  source: "both" as const,
  render(el: HTMLElement, images: ImagePoint[], chats: ChatPoint[], rates: RatesSnapshot): void {
    const bars = sessionBars(images, chats, rateLookup(rates.models));
    noteFor(el).textContent = ratesNote(rates);
    const chart = chartFor(el);
    chart.setOption({
      backgroundColor: "transparent",
      textStyle: { color: "#e7ecf2" },
      legend: { top: 0, textStyle: { color: "#e7ecf2" } },
      tooltip: {
        trigger: "axis",
        formatter(params: unknown) {
          const items = Array.isArray(params) ? params : [params];
          const bar = bars[itemIndex(items[0])];
          if (!bar) return "";
          const lines = [
            bar.recordedAt,
            bar.id,
            `Total: $${money(bar.totalCost)}`,
            `Tokens: ${bar.totalTokens}`,
            ...sideLines("Description", bar.description),
            ...sideLines("Chat", bar.chat),
          ];
          if (bar.chatEstimated) lines.push("Chat estimated from recorded cost");
          if (Math.abs(bar.chat.cost - bar.chatRecordedCost) > 1e-9) {
            lines.push(`Recorded chat cost: $${money(bar.chatRecordedCost)}`);
          }
          if (bar.rateUnset) lines.push("Rate unset");
          return lines.join("<br>");
        },
      },
      grid: { left: 16, right: 16, top: 48, bottom: 8, containLabel: true },
      xAxis: {
        type: "category",
        data: bars.map((bar) => sessionLabel(bar.recordedAt, bar.id, bars)),
        axisLabel: { color: "#c5d0dc", rotate: 30, width: 160, overflow: "truncate" },
      },
      yAxis: {
        type: "value",
        name: "Dollars",
        nameTextStyle: { color: "#c5d0dc" },
        axisLabel: { color: "#c5d0dc", formatter: (value: number) => Number(value).toFixed(6) },
      },
      series: [
        { name: "Description", type: "bar", stack: "cost", data: bars.map((bar) => bar.description.cost) },
        { name: "Chat", type: "bar", stack: "cost", data: bars.map((bar) => bar.chat.cost) },
      ],
    }, true);
  },
};

function chartFor(el: HTMLElement): ECharts {
  const existing = mounts.get(el);
  if (existing) return existing;
  const plot = document.createElement("div");
  plot.className = "plot";
  el.append(plot);
  const chart = getInstanceByDom(plot) ?? init(plot);
  window.addEventListener("resize", () => chart.resize());
  mounts.set(el, chart);
  return chart;
}

function noteFor(el: HTMLElement): HTMLParagraphElement {
  const existing = notes.get(el);
  if (existing) return existing;
  const note = document.createElement("p");
  note.className = "hint";
  el.prepend(note);
  notes.set(el, note);
  return note;
}

function ratesNote(rates: RatesSnapshot): string {
  if (rates.source === "file") return `Rates from model-rates.json, updated ${rates.updatedAt}. Each call uses the rate in effect when it was recorded.`;
  if (rates.error) return `Built-in rates. ${rates.error}`;
  return "Built-in rates. model-rates.json was not found.";
}

function sideLines(name: string, side: TokenCost): string[] {
  return [
    name,
    `Uncached input: ${side.uncachedInput} = $${money(side.uncachedInputCost)}`,
    `Cached input: ${side.cachedInput} = $${money(side.cachedInputCost)}`,
    `Output: ${side.output} = $${money(side.outputCost)}`,
    `Subtotal: $${money(side.cost)}`,
  ];
}

function money(value: number): string {
  return value.toFixed(6);
}

function itemIndex(item: unknown): number {
  if (!item || typeof item !== "object" || !("dataIndex" in item)) return -1;
  const index = item.dataIndex;
  return typeof index === "number" ? index : -1;
}
