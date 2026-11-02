/**
 * Auto-sync: commit the workspace repo on shutdown and push to origin.
 *
 * Design notes (see ~/.pi/docs/pi-state-summary.md, "Replica Hosts"):
 * - Repo is pinned to ~/.pi. Never the session cwd: sessions run in other
 *   directories, and committing whatever repo happens to be there is wrong.
 * - Skipped inside subagents: every subagent is its own pi process, and a child
 *   must never commit the parent's half-finished work or push concurrently.
 * - session_shutdown also fires on reload/fork/session replacement, not only
 *   /quit. The handler is therefore idempotent and cheap when the tree is clean.
 * - Secret scan runs on the staged diff before committing: .gitignore only
 *   protects paths, not a token pasted into a tracked file.
 * - Push is best-effort with a timeout. If origin moved, rebase once and retry;
 *   on conflict, abort the rebase, keep the local commit, and say so loudly.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

const REPO = join(homedir(), ".pi");
const LOG_FILE = join(REPO, "logs", "auto-sync.log");
const GIT_TIMEOUT_S = 20;
const PUSH_TIMEOUT_S = 20;
const REBASE_TIMEOUT_S = 30;

const SECRET_PATTERNS: Array<[string, RegExp]> = [
	["openai-style key", /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{20,}\b/],
	["github token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
	["aws access key", /\bAKIA[0-9A-Z]{16}\b/],
	["telegram bot token", /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/],
	["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
	["google api key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
	["slack token", /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/],
];

function log(line: string): void {
	try {
		mkdirSync(join(REPO, "logs"), { recursive: true });
		appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
	} catch {
		/* logging must never break shutdown */
	}
}

function isSubagent(): boolean {
	return Object.keys(process.env).some((k) => k.startsWith("PI_SUBAGENT_"));
}

function firstLine(text: string, max = 60): string {
	const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
	return line.length > max ? `${line.slice(0, max)}…` : line;
}

function lastAssistantText(ctx: any): string {
	try {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry?.type === "message" && entry.message?.role === "assistant") {
				const content = entry.message.content;
				if (Array.isArray(content)) {
					return content
						.filter((c: any) => c?.type === "text")
						.map((c: any) => c.text)
						.join("\n");
				}
			}
		}
	} catch {
		/* session may already be torn down */
	}
	return "";
}

type SyncResult = { committed: boolean; pushed: boolean; note: string };

async function syncNow(pi: ExtensionAPI, ctx: any, opts: { push: boolean; quiet?: boolean }): Promise<SyncResult> {
	const git = (args: string[]) => pi.exec("git", ["-C", REPO, ...args]);
	const gitT = (args: string[], secs: number) => pi.exec("timeout", [String(secs), "git", "-C", REPO, ...args]);

	const status = await git(["status", "--porcelain"]);
	if (status.code !== 0) {
		return { committed: false, pushed: false, note: `git status failed: ${(status.stderr || status.stdout).trim()}` };
	}
	if (status.stdout.trim().length === 0) {
		return { committed: false, pushed: false, note: "clean" };
	}

	const add = await git(["add", "-A"]);
	if (add.code !== 0) {
		return { committed: false, pushed: false, note: `git add failed: ${(add.stderr || add.stdout).trim()}` };
	}

	// Secret gate: scan only what is about to be committed.
	const diff = await git(["diff", "--cached", "-U0"]);
	if (diff.code === 0) {
		for (const [label, re] of SECRET_PATTERNS) {
			const hit = diff.stdout.match(re);
			if (hit) {
				await git(["reset"]);
				const msg = `auto-sync: refused to commit, staged diff looks like a ${label}`;
				log(`${msg} (match length ${hit[0].length})`);
				if (ctx.hasUI && !opts.quiet) ctx.ui.notify(msg, "error");
				return { committed: false, pushed: false, note: `secret guard: ${label}` };
			}
		}
	}

	const context = firstLine(lastAssistantText(ctx)) || "session work";
	const message = `[pi:${hostname()}] ${context}`;
	const commit = await git(["commit", "-m", message]);
	if (commit.code !== 0) {
		const out = (commit.stderr || commit.stdout).trim();
		if (!/nothing to commit/i.test(out)) {
			log(`commit failed: ${out}`);
			return { committed: false, pushed: false, note: `commit failed: ${out}` };
		}
		return { committed: false, pushed: false, note: "nothing to commit" };
	}

	if (!opts.push) {
		log(`committed locally (no push): ${message}`);
		return { committed: true, pushed: false, note: message };
	}

	let push = await gitT(["push", "--quiet"], PUSH_TIMEOUT_S);
	if (push.code === 0) {
		log(`committed + pushed: ${message}`);
		return { committed: true, pushed: true, note: message };
	}

	const pushOut = `${push.stdout} ${push.stderr}`;
	log(`push failed, attempting rebase: ${pushOut.trim().slice(0, 300)}`);

	const rebase = await gitT(["pull", "--rebase", "--autostash", "--quiet"], REBASE_TIMEOUT_S);
	if (rebase.code !== 0) {
		await git(["rebase", "--abort"]);
		const msg = "auto-sync: push rejected and rebase failed — commit kept locally, needs manual attention";
		log(`${msg}: ${(rebase.stderr || rebase.stdout).trim().slice(0, 300)}`);
		if (ctx.hasUI && !opts.quiet) ctx.ui.notify(msg, "error");
		return { committed: true, pushed: false, note: "rebase failed" };
	}

	push = await gitT(["push", "--quiet"], PUSH_TIMEOUT_S);
	if (push.code === 0) {
		log(`committed + pushed after rebase: ${message}`);
		return { committed: true, pushed: true, note: message };
	}

	const msg = "auto-sync: push still failing after rebase — commit kept locally";
	log(`${msg}: ${(push.stderr || push.stdout).trim().slice(0, 300)}`);
	if (ctx.hasUI && !opts.quiet) ctx.ui.notify(msg, "error");
	return { committed: true, pushed: false, note: "push failed after rebase" };
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_shutdown", async (_event, ctx) => {
		if (isSubagent()) {
			log("skip: running as subagent");
			return;
		}
		const result = await syncNow(pi, ctx, { push: true });
		if (ctx.hasUI && result.committed) {
			ctx.ui.notify(result.pushed ? `Synced: ${result.note}` : `Committed locally: ${result.note}`, result.pushed ? "info" : "warning");
		}
	});

	pi.registerCommand("sync", {
		description: "Commit ~/.pi and push to origin (use '/sync pull' to only update)",
		handler: async (args, ctx) => {
			const mode = (args ?? "").trim().toLowerCase();
			if (mode === "pull") {
				const pull = await pi.exec("timeout", ["30", "git", "-C", REPO, "pull", "--ff-only", "--quiet"]);
				const ok = pull.code === 0;
				log(`manual pull: ${ok ? "ok" : (pull.stderr || pull.stdout).trim().slice(0, 200)}`);
				ctx.ui.notify(ok ? "Pulled (fast-forward)." : `Pull failed: ${(pull.stderr || pull.stdout).trim()}`, ok ? "info" : "error");
				return;
			}
			const result = await syncNow(pi, ctx, { push: true });
			ctx.ui.notify(
				result.committed ? (result.pushed ? `Synced: ${result.note}` : `Committed locally: ${result.note}`) : `Nothing to do (${result.note})`,
				result.pushed || (!result.committed && result.note === "clean") ? "info" : "warning",
			);
		},
	});
}
