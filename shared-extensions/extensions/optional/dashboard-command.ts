/**
 * dashboard-command.ts — /dashboard slash command with TUI overlay.
 *
 * Opens an overlay panel listing all extensions, their status,
 * and memory pipeline info. Uses @earendil-works/pi-tui components.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text, Spacer, Box } from "@earendil-works/pi-tui";
import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

function getExtensions(dir: string): Array<{ name: string; active: boolean }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".ts.disabled"))
    .map((f) => ({
      name: f.replace(".disabled", ""),
      active: !f.endsWith(".disabled"),
    }))
    .filter(
      (ext, i, arr) => arr.findIndex((e) => e.name === ext.name) === i,
    );
}

function getMemoryStatus(sessionSummariesDir: string): {
  captures: number;
  lastCapture: string;
} {
  let captures = 0;
  let lastCapture = "none";
  if (existsSync(sessionSummariesDir)) {
    const files = readdirSync(sessionSummariesDir).filter((f) =>
      f.endsWith(".json"),
    );
    captures = files.length;
    if (files.length > 0) {
      const stats = files
        .map((f) => ({
          name: f,
          mtime: statSync(join(sessionSummariesDir, f)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      lastCapture = stats[0].mtime.toLocaleString();
    }
  }
  return { captures, lastCapture };
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("dashboard", {
    description: "Show extension health and memory pipeline status",

    handler: async (_args: string, ctx) => {
      const extensionsDir = join(import.meta.dirname);
      const sessionsDir =
        process.env.PI_SESSION_SUMMARIES_PATH ||
        join(import.meta.dirname, "..", "..", "session-summaries");

      const extensions = getExtensions(extensionsDir);
      const memory = getMemoryStatus(sessionsDir);
      const active = extensions.filter((e) => e.active).length;
      const inactive = extensions.filter((e) => !e.active).length;

      // Build the overlay panel using pi-tui components
      await ctx.ui.custom<string | null>(
        (tui, theme, _keybindings, done) => {
          const container = new Container();

          // Title
          const title = new Box(1, 0, (text) => theme.bg("toolSuccessBg", text));
          title.addChild(new Text("══ Extensions Dashboard ══", 1, 0));
          container.addChild(title);
          container.addChild(new Spacer(1));

          // Summary line
          const summary =
            `${active} active, ${inactive} suppressed, ${extensions.length} total`;
          container.addChild(new Text(` ${summary}`, 1, 0));
          container.addChild(new Spacer(1));

          // Extension list
          for (const ext of extensions.sort((a, b) =>
            a.name.localeCompare(b.name),
          )) {
            const dot = ext.active
              ? theme.fg("success", "●")
              : theme.fg("dim", "●");
            const status = ext.active ? "" : " (suppressed)";
            container.addChild(
              new Text(`  ${dot} ${ext.name}${status}`, 1, 0),
            );
          }

          container.addChild(new Spacer(1));

          // Memory pipeline section
          const memTitle = new Box(1, 0, (text) => theme.bg("toolPendingBg", text));
          memTitle.addChild(new Text("══ Memory Pipeline ══", 1, 0));
          container.addChild(memTitle);
          container.addChild(new Spacer(1));
          container.addChild(
            new Text(`  Captures: ${memory.captures}`, 1, 0),
          );
          container.addChild(
            new Text(`  Last: ${memory.lastCapture}`, 1, 0),
          );
          container.addChild(new Spacer(2));
          container.addChild(
            new Text(" Press any key to close ", 1, 0),
          );

          // Close on any key
          setTimeout(() => {
            process.stdin.once("data", () => done(null));
          }, 100);

          return container;
        },
        { overlay: true },
      );
    },
  });
}
