import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("commit", {
    description: "Stage all changes and commit (git add -A && git commit)",
    handler: async (args, ctx) => {
      const message = args?.trim() || "checkpoint";

      const addResult = await pi.exec("git", ["add", "-A"], { cwd: ctx.cwd });
      if (addResult.code !== 0) {
        ctx.ui.notify((addResult.stderr || addResult.stdout).trim() || "git add failed", "error");
        return;
      }

      const { stdout, stderr, code } = await pi.exec("git", ["commit", "-m", message], { cwd: ctx.cwd });

      const output = (stdout + stderr).trim();

      if (code === 0) {
        ctx.ui.notify(output || "Committed", "info");
      } else if (/nothing to commit/i.test(output)) {
        ctx.ui.notify(output, "info");
      } else {
        ctx.ui.notify(output || "Commit failed", "error");
      }
    },
  });
}
