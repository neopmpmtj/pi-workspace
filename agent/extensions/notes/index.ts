import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ── In-memory state (scoped to this session) ──
let notes: Array<{ id: number; timestamp: number; text: string }> = [];

function listNotes(): string {
  if (notes.length === 0) return "(no notes yet)";
  return notes
    .map((n) => `[${n.id}] ${new Date(n.timestamp).toLocaleTimeString()} — ${n.text}`)
    .join("\n");
}

export default function (pi: ExtensionAPI) {
  console.log("[NOTES] Session notes extension loaded");

  // ═══════════════════════════════════════════════════
  // TOOL: save_note — callable by the LLM
  // ═══════════════════════════════════════════════════
  pi.registerTool({
    name: "save_note",
    label: "Save Note",
    description: "Save a note to the current Pi session. Use this to bookmark findings, decisions, or anything worth remembering later.",
    promptSnippet: "Save a note to the session (bookmark findings, decisions, etc.)",
    promptGuidelines: [
      "Use save_note to bookmark important findings, decisions, or context the user might need later in this session.",
    ],
    parameters: Type.Object({
      text: Type.String({ description: "The note text to save" }),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const note = {
        id: notes.length + 1,
        timestamp: Date.now(),
        text: params.text,
      };
      notes.push(note);

      // Persist to session file (survives /reload)
      pi.appendEntry({
        type: "extension_data",
        extensionId: "notes",
        data: note,
      });

      // Feedback to the LLM
      ctx.ui.notify(`Note #${note.id} saved`, "info");

      return {
        content: [{ type: "text", text: `Note #${note.id} saved: "${params.text}"` }],
        details: { noteId: note.id, totalNotes: notes.length },
      };
    },
  });

  // ═══════════════════════════════════════════════════
  // COMMAND: /notes — user-facing
  // ═══════════════════════════════════════════════════
  pi.registerCommand("notes", {
    description: "List all session notes",
    handler: async (_args, ctx) => {
      const output = listNotes();
      ctx.ui.notify(output, "info");

      // If there are notes, offer to copy one
      if (notes.length > 0) {
        const choice = await ctx.ui.select(
          "Pick a note to copy to clipboard (Esc to cancel):",
          notes.map((n) => `[${n.id}] ${n.text.slice(0, 60)}`),
        );
        if (choice !== undefined) {
          const selected = notes[choice];
          ctx.ui.notify(`Copied: "${selected.text}"`, "info");
          // Clipboard via bash
          const { execSync } = require("node:child_process");
          try {
            execSync("xclip -selection clipboard", { input: selected.text });
          } catch {
            // xclip may not be available — that's fine
          }
        }
      }
    },
  });

  // ═══════════════════════════════════════════════════
  // HOOK: block dangerous notes (demo of tool_call hook)
  // ═══════════════════════════════════════════════════
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "save_note") return;
    if (event.input.text && event.input.text.length > 500) {
      const ok = await ctx.ui.confirm(
        "Long Note",
        `This note is ${event.input.text.length} characters. Save anyway?`,
      );
      if (!ok) return { block: true, reason: "Note too long — user declined" };
    }
  });

  // ═══════════════════════════════════════════════════
  // EVENT: restore notes from session on reload
  // ═══════════════════════════════════════════════════
  pi.on("session_start", async (_event, ctx) => {
    // Rebuild notes from any persisted entries in this session
    const entries = ctx.sessionManager.getEntries();
    notes = [];
    for (const entry of entries) {
      if (entry.type === "extension_data" && entry.extensionId === "notes" && entry.data) {
        notes.push(entry.data as any);
      }
    }
    if (notes.length > 0) {
      console.log(`[NOTES] Restored ${notes.length} notes from session`);
    }
  });
}
