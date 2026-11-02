import type { ECharts } from "echarts/core";
import { getInstanceByDom, init } from "../chart.ts";
import { sessionBars, sessionLabel, type TokenCost } from "../../session-cost.ts";
import { rateLookup, type RatesSnapshot } from "../rates.ts";
import type { ChatPoint, ImagePoint } from "../../parse.ts";

const mounts = new WeakMap<HTMLElement, ECharts>();

export const tokensViz = {
  id: "session-tokens",
  title: "Tokens per session",
  source: "both" as const,
  render(el: HTMLElement, images: ImagePoint[], chats: ChatPoint[], rates: RatesSnapshot): void {
    const bars = sessionBars(images, chats, rateLookup(rates.models));
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
            `Tokens: ${bar.totalTokens}`,
            ...sideLines("Description", bar.description),
            ...sideLines("Chat", bar.chat),
            "Cached input is billed at the cached-read rate.",
          ];
          if (bar.chatEstimated) lines.push("Chat token counts missing");
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
        name: "Tokens",
        nameTextStyle: { color: "#c5d0dc" },
        axisLabel: { color: "#c5d0dc" },
      },
      series: [
        { name: "Description", type: "bar", stack: "tokens", data: bars.map((bar) => bar.description.tokens) },
        { name: "Chat", type: "bar", stack: "tokens", data: bars.map((bar) => bar.chat.tokens) },
      ],
    }, true);
  },
};

function sideLines(name: string, side: TokenCost): string[] {
  return [
    name,
    `Uncached input: ${side.uncachedInput}`,
    `Cached input: ${side.cachedInput}`,
    `Output: ${side.output}`,
  ];
}

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

function itemIndex(item: unknown): number {
  if (!item || typeof item !== "object" || !("dataIndex" in item)) return -1;
  const index = item.dataIndex;
  return typeof index === "number" ? index : -1;
}
