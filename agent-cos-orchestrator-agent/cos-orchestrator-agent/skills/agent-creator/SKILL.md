---
name: agent-creator
description: Scaffold and register a new sibling agent in ~/.pi/agent-<name>/<name> with an isolated launcher, standalone SQLite ledger, /ask and /usage commands, default model hot-swapping, and automatic CoS publication. Use when asked to create, scaffold, bootstrap, or set up a new agent, new sibling agent, or new pi agent.
---

# Agent Creator

Scaffold a new, self-contained sibling agent in the `~/.pi` workspace matching the architecture of existing siblings (`web-master`, `image-describer`, `sm-google-workspace`).

The new sibling has:
- **Location:** `~/.pi/agent-<name>/<name>/` (config home set as `PI_CODING_AGENT_DIR`)
- **Credentials:** `~/.pi/agent-<name>/.env` (mode 600, isolated from other agents)
- **Launcher:** `~/.local/bin/pi-<name>` (mode 755, hot-swaps provider/model via `default-model.json`)
- **Commands:** `/ask` (zero-token canned queries straight to provider registry) and `/usage` (token & cost reports)
- **Ledger:** Standalone SQLite ledger in `logs/ledger.sqlite` using Node's native `node:sqlite`
- **Manifest:** `agent.json` published to CoS via `scripts/fetch-publications.ts`
- **Documentation:** `docs/CALLING.md` and `docs/INBOX.md`
- **Git:** Sibling files created in `~/.pi` and left unstaged for user review

---

## Invocation & Elicitation Flow

When invoked, guide the user through these 4 parameters (elicit if not already provided in the prompt):

1. **Name:** Agent name in kebab-case (e.g. `sql-expert`, `doc-reviewer`).
   - If user provides `agent-foo`, normalize to `foo`.
2. **Purpose:** One-sentence description of the agent's role (defaults to `Specialized assistant for <name>`).
3. **Tools:** Minimal by default (`read,bash`). Ask if specific tools are needed or if none are wanted.
4. **Credentials:** Ask whether to copy provider keys (`DEEPSEEK_API_KEY`, etc.) from CoS's `.env`, or provide explicit keys.

---

## Execution

Run the deterministic scaffolding script via bash:

```bash
node --experimental-strip-types \
  ~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent/skills/agent-creator/scripts/scaffold.ts \
  --name <name> \
  --purpose "<purpose>" \
  --tools "<tools>" \
  --provider deepseek \
  --model deepseek-flash \
  --thinking low \
  --copy-keys
```

### CLI Flags
- `--name <name>`: Required. Kebab-case identifier.
- `--purpose "<text>"`: Role description for `agent.json` and `AGENTS.md`.
- `--tools "read,bash"`: Comma-separated list of enabled tools.
- `--provider <id>`: Default provider (default: `deepseek`).
- `--model <id>`: Default model (default: `deepseek-flash`).
- `--thinking <level>`: Default thinking level (default: `low`).
- `--copy-keys`: Copies `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` from CoS's `.env`.
- `--check`: Preflight verification without writing files.
- `--skip-smoke-test`: Skip live provider smoke test.

---

## Verification & Post-Scaffold Checks

The script automatically:
1. Runs local unit tests (`args.test.ts`, `effective.test.ts`) in the new agent home.
2. Runs `npm run fetch:publications` in CoS home so `APPEND_SYSTEM.md` immediately lists the new sibling in the delegation table.
3. Runs a smoke test via `pi-<name> -p '/ask "ping"'`.
4. Leaves all newly created files in `~/.pi` unstaged for git review.

Report the final paths, launcher command, smoke test status, and review instructions to the user.
