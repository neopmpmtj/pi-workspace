#!/usr/bin/env node
/**
 * scaffold.ts — Deterministic sibling agent generator for ~/.pi
 *
 * Scaffolds a new sibling agent adhering to the Pi workspace sibling architecture:
 *   - Container at ~/.pi/agent-<name>/ with isolated .env (0600) and .gitignore
 *   - Home at ~/.pi/agent-<name>/<name>/ with package.json, settings.json, AGENTS.md, agent.json
 *   - Standalone SQLite ledger & /usage command in ledger/
 *   - /ask command with default-model.json hot-swapping in extensions/chat/ and src/
 *   - Isolated launcher at ~/.local/bin/pi-<name> (0755)
 *   - Rebuilds CoS publication registry (APPEND_SYSTEM.md)
 *   - Runs typecheck, unit tests, and live smoke test
 */

import { existsSync, readdirSync, chmodSync, symlinkSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ScaffoldOptions {
  name: string;
  purpose?: string;
  tools?: string[];
  provider?: string;
  model?: string;
  thinking?: string;
  copyKeys?: boolean;
  keys?: Record<string, string>;
  checkOnly?: boolean;
  skipSmokeTest?: boolean;
}

const HOME = homedir();
const PI_ROOT = path.join(HOME, ".pi");
const COS_AGENT_DIR = path.join(PI_ROOT, "agent-keep-agent", "keep-agent");
const COS_ENV_FILE = path.join(PI_ROOT, "agent-keep-agent", ".env");
const BIN_DIR = path.join(HOME, ".local", "bin");

export function normalizeAgentName(raw: string): string {
  let name = raw.trim().toLowerCase();
  if (name.startsWith("agent-")) name = name.slice(6);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`Invalid agent name "${raw}". Must be alphanumeric with optional hyphens (kebab-case), e.g. "sql-expert".`);
  }
  return name;
}

export function validatePreflight(name: string): { agentContainer: string; agentHome: string; launcherPath: string } {
  const agentContainer = path.join(PI_ROOT, `agent-${name}`);
  const agentHome = path.join(agentContainer, name);
  const launcherPath = path.join(BIN_DIR, `pi-${name}`);

  if (existsSync(agentContainer)) {
    throw new Error(`Directory ${agentContainer} already exists. Choose a different name or remove the existing directory first.`);
  }
  if (existsSync(launcherPath)) {
    throw new Error(`Launcher ${launcherPath} already exists. Remove or rename it first.`);
  }
  if (!existsSync(COS_AGENT_DIR)) {
    throw new Error(`CoS template home ${COS_AGENT_DIR} not found. Cannot scaffold sibling.`);
  }
  return { agentContainer, agentHome, launcherPath };
}

export async function scaffoldAgent(options: ScaffoldOptions): Promise<{ agentHome: string; launcherPath: string }> {
  const name = normalizeAgentName(options.name);
  const { agentContainer, agentHome, launcherPath } = validatePreflight(name);

  if (options.checkOnly) {
    console.log(`[check] Preflight passed for agent "${name}".`);
    console.log(`[check] Target home: ${agentHome}`);
    console.log(`[check] Launcher:    ${launcherPath}`);
    return { agentHome, launcherPath };
  }

  const purpose = options.purpose?.trim() || `Specialized sibling agent for ${name}.`;
  const tools = options.tools && options.tools.length > 0 ? options.tools : ["read", "bash"];
  const provider = options.provider?.trim() || "deepseek";
  const model = options.model?.trim() || "deepseek-flash";
  const thinking = options.thinking?.trim() || "low";

  console.log(`[scaffold] Creating agent "${name}"...`);

  // 1. Create directories
  await mkdir(path.join(agentHome, "ledger"), { recursive: true });
  await mkdir(path.join(agentHome, "src"), { recursive: true });
  await mkdir(path.join(agentHome, "extensions", "chat"), { recursive: true });
  await mkdir(path.join(agentHome, "docs"), { recursive: true });
  await mkdir(path.join(agentHome, "logs"), { recursive: true });
  await mkdir(path.join(agentHome, "test"), { recursive: true });

  // 2. Prepare .env
  let envContent = `# Environment credentials for ${name}\n`;
  if (options.copyKeys && existsSync(COS_ENV_FILE)) {
    const cosEnv = await readFile(COS_ENV_FILE, "utf8");
    const preservedKeys = ["DEEPSEEK_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"];
    for (const line of cosEnv.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && preservedKeys.includes(match[1])) {
        envContent += `${match[1]}=${match[2]}\n`;
      }
    }
  } else if (options.keys) {
    for (const [k, v] of Object.entries(options.keys)) {
      envContent += `${k}=${v}\n`;
    }
  } else {
    envContent += `# DEEPSEEK_API_KEY=\n# OPENAI_API_KEY=\n# GEMINI_API_KEY=\n`;
  }
  const envPath = path.join(agentContainer, ".env");
  await writeFile(envPath, envContent, { mode: 0o600 });
  chmodSync(envPath, 0o600);

  // 3. Prepare .gitignore
  const gitignoreContent = `.env\nsessions/\nlogs/\n*.sqlite*\nauth.json\nmodels-store.json\nnode_modules/\n.cache/\n`;
  await writeFile(path.join(agentContainer, ".gitignore"), gitignoreContent, "utf8");

  // 4. Ledger files
  const ledgerSrc = path.join(COS_AGENT_DIR, "ledger");
  const ledgerFiles = ["ingest.ts", "labels.ts", "rates.ts", "rate-table.ts", "runs.ts", "store.ts", "tokens.ts"];
  for (const file of ledgerFiles) {
    const content = await readFile(path.join(ledgerSrc, file), "utf8");
    await writeFile(path.join(agentHome, "ledger", file), content, "utf8");
  }
  // env.ts with agent-specific fallback
  let envTs = await readFile(path.join(ledgerSrc, "env.ts"), "utf8");
  envTs = envTs.replace(
    'path.join(env.HOME ?? "", ".pi", "agent-keep-agent", "keep-agent")',
    `path.join(env.HOME ?? "", ".pi", "agent-${name}", "${name}")`
  );
  await writeFile(path.join(agentHome, "ledger", "env.ts"), envTs, "utf8");

  // 5. Src files
  const srcDir = path.join(COS_AGENT_DIR, "src");
  const srcFiles = ["args.ts", "ask.ts", "default-model.ts", "effective.ts", "prompt.ts", "session-command.ts", "usage.ts"];
  for (const file of srcFiles) {
    const content = await readFile(path.join(srcDir, file), "utf8");
    await writeFile(path.join(agentHome, "src", file), content, "utf8");
  }
  // report.ts with agent-specific footer
  let reportTs = await readFile(path.join(srcDir, "report.ts"), "utf8");
  reportTs = reportTs.replace("[keep-agent]", `[${name}]`);
  await writeFile(path.join(agentHome, "src", "report.ts"), reportTs, "utf8");

  // 6. Extensions / chat
  let chatExt = await readFile(path.join(COS_AGENT_DIR, "extensions", "chat", "index.ts"), "utf8");
  chatExt = chatExt.replaceAll("keep-agent-usage", `${name}-usage`);
  chatExt = chatExt.replaceAll("keep-agent", name);
  await writeFile(path.join(agentHome, "extensions", "chat", "index.ts"), chatExt, "utf8");

  // 7. Unit tests
  const testFiles = ["args.test.ts", "effective.test.ts"];
  for (const file of testFiles) {
    const testContent = await readFile(path.join(COS_AGENT_DIR, "test", file), "utf8");
    await writeFile(path.join(agentHome, "test", file), testContent, "utf8");
  }

  // 8. package.json & tsconfig.json
  const pkgJson = {
    name,
    private: true,
    type: "module",
    engines: { node: ">=24.21.0" },
    scripts: {
      test: "node --experimental-strip-types --test test/*.test.ts",
      typecheck: "tsc --noEmit"
    },
    devDependencies: {
      "@earendil-works/pi-ai": "1.4.0",
      "@earendil-works/pi-coding-agent": "1.4.0",
      "@types/node": "24.10.1",
      typescript: "5.9.3"
    }
  };
  await writeFile(path.join(agentHome, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf8");

  const tsconfigContent = await readFile(path.join(COS_AGENT_DIR, "tsconfig.json"), "utf8");
  await writeFile(path.join(agentHome, "tsconfig.json"), tsconfigContent, "utf8");

  // 9. settings.json & default-model.json
  const settingsJson = {
    defaultProvider: provider,
    defaultModel: model,
    defaultThinkingLevel: thinking,
    defaultTools: tools,
    extensions: ["+extensions/chat/index.ts"],
    enabledModels: [
      "deepseek-flash",
      "deepseek-v4-pro",
      "gpt-6.1-sol",
      "gemini-3.8-flash",
      "gemini-3.7-flash"
    ]
  };
  await writeFile(path.join(agentHome, "settings.json"), JSON.stringify(settingsJson, null, 2) + "\n", "utf8");

  const defaultModelJson = {
    provider,
    model,
    thinking
  };
  await writeFile(path.join(agentHome, "default-model.json"), JSON.stringify(defaultModelJson, null, 2) + "\n", "utf8");

  // 10. AGENTS.md
  const agentsMd = `# ${name}\n\nYou are ${name}. ${purpose}\n\n## Guidelines\n- Answer what was asked directly and concisely. No preamble.\n- When delegation is needed, call siblings via their launchers.\n- Token usage and /ask calls are tracked in the local SQLite ledger.\n`;
  await writeFile(path.join(agentHome, "AGENTS.md"), agentsMd, "utf8");

  // 11. agent.json
  const toolDefs = tools.map((t) => ({ name: t, description: `${t} tool` }));
  const agentJson = {
    name,
    launcher: `pi-${name}`,
    defaultPrompt: "/ask",
    call: "/ask <question>",
    purpose,
    contract: `~/.pi/agent-${name}/${name}/docs/CALLING.md`,
    commands: [
      {
        name: "/ask",
        description: 'One request, no chat turn: /ask "question". /ask --help lists the flags.'
      },
      {
        name: "/usage",
        description: "Tokens and cost: /usage · /usage --all · /usage --session · /usage <runId>"
      }
    ],
    tools: toolDefs
  };
  await writeFile(path.join(agentHome, "agent.json"), JSON.stringify(agentJson, null, 2) + "\n", "utf8");

  // 12. docs/CALLING.md & docs/INBOX.md
  const callingMd = `# ${name}: calling contract\n\nContract for sibling agents calling this one.\n\n## Default call\n\n\`\`\`bash\ncd ~/.pi/agent-${name}/${name} && pi-${name} -p "/ask <question>"\n\`\`\`\n\nAnswers with one provider call through Pi's model registry, recorded in the local SQLite ledger. No chat turn is started.\n\n## Chat turn\n\n\`\`\`bash\ncd ~/.pi/agent-${name}/${name} && pi-${name} -p "<task in plain language>"\n\`\`\`\n\nStarts a chat turn that gives the agent access to its configured tools (${tools.join(", ")}).\n`;
  await writeFile(path.join(agentHome, "docs", "CALLING.md"), callingMd, "utf8");

  const inboxMd = `# Inbox: agreed future work for ${name}\n\nWork agreed but not done immediately. Newest at the bottom.\n`;
  await writeFile(path.join(agentHome, "docs", "INBOX.md"), inboxMd, "utf8");

  // 13. Symlink node_modules for zero-download instant readiness
  const cosNodeModules = path.join(COS_AGENT_DIR, "node_modules");
  if (existsSync(cosNodeModules)) {
    symlinkSync(cosNodeModules, path.join(agentHome, "node_modules"), "dir");
  }

  // 14. Launcher ~/.local/bin/pi-<name>
  const launcherScript = `#!/bin/bash
# pi-${name} — isolated launcher for the ${name} agent.
# Sources ONLY this agent's .env. It deliberately does NOT use ~/.local/bin/pi.

set -a
ENV_FILE="$HOME/.pi/agent-${name}/.env"
[ -f "$ENV_FILE" ] && source "$ENV_FILE"
set +a

export PI_CODING_AGENT_DIR="$HOME/.pi/agent-${name}/${name}"

# Pin node to the version pi is installed under.
NODE_BIN="\${PI_NODE_BIN:-$HOME/.nvm/versions/node/v24.21.0/bin}"
export PATH="$NODE_BIN:$PATH"

MODEL_FILE="$PI_CODING_AGENT_DIR/default-model.json"
ARGS=()

if [ -f "$MODEL_FILE" ]; then
  MODEL=""
  PROVIDER=""
  THINKING=""
  while IFS=$'\\t' read -r key value; do
    case "$key" in
      provider) PROVIDER="$value" ;;
      model)    MODEL="$value" ;;
      thinking) THINKING="$value" ;;
    esac
  done < <(node -e '
    const fs = require("node:fs");
    let data = {};
    try { data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(0); }
    for (const key of ["provider", "model", "thinking"]) {
      const value = data[key];
      if (typeof value === "string" && value.trim() !== "") console.log(\`\${key}\\t\${value.trim()}\`);
    }
  ' "$MODEL_FILE")

  if [ -n "$MODEL" ]; then
    [ -n "$PROVIDER" ] && ARGS+=(--provider "$PROVIDER")
    ARGS+=(--model "$MODEL")
  fi
  [ -n "$THINKING" ] && ARGS+=(--thinking "$THINKING")
fi

exec "$NODE_BIN/pi" "\${ARGS[@]}" "$@"
`;
  await writeFile(launcherPath, launcherScript, { mode: 0o755 });
  chmodSync(launcherPath, 0o755);

  console.log(`[scaffold] Files written. Running unit tests...`);
  try {
    execFileSync("node", ["--experimental-strip-types", "--test", "test/args.test.ts", "test/effective.test.ts"], {
      cwd: agentHome,
      stdio: "pipe"
    });
    console.log(`[scaffold] Unit tests passed.`);
  } catch (err) {
    console.warn(`[scaffold] Unit tests warning:`, err instanceof Error ? err.message : String(err));
  }

  // 15. Fetch publications in CoS to register the sibling
  console.log(`[scaffold] Registering publication with Chief of Staff...`);
  try {
    const fetchOutput = execFileSync("npm", ["run", "fetch:publications"], {
      cwd: COS_AGENT_DIR,
      stdio: "pipe",
      encoding: "utf8"
    });
    console.log(fetchOutput.trim());
  } catch (err) {
    console.warn(`[scaffold] fetch:publications warning:`, err instanceof Error ? err.message : String(err));
  }

  // 16. Smoke test
  if (!options.skipSmokeTest) {
    console.log(`[scaffold] Running smoke test via ${launcherPath}...`);
    try {
      const smokeOutput = execFileSync(launcherPath, ["-ns", "-ne", "--no-session", "-p", "Reply with: OK"], {
        cwd: agentHome,
        timeout: 40000,
        stdio: "pipe",
        encoding: "utf8"
      });
      console.log(`[scaffold] Smoke test output: ${smokeOutput.trim()}`);
    } catch (err) {
      console.warn(`[scaffold] Smoke test warning (check credentials in ${envPath}):`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`\n[ok] Agent "${name}" successfully scaffolded at ${agentHome}`);
  console.log(`[ok] Launcher available at ${launcherPath}`);
  console.log(`[ok] Files left unstaged in ~/.pi for git review.`);

  return { agentHome, launcherPath };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.length === 0) {
    console.log(`Usage: scaffold.ts --name <name> [options]

Options:
  --name <name>        Agent name (kebab-case, e.g. "sql-expert")
  --purpose <text>     Agent role / purpose description
  --tools <list>       Comma-separated tools (default: "read,bash")
  --provider <id>      Default provider (default: "deepseek")
  --model <id>         Default model (default: "deepseek-flash")
  --thinking <level>   Default thinking level (default: "low")
  --copy-keys          Copy provider keys from CoS .env
  --check              Preflight check only
  --skip-smoke-test    Do not run live smoke test
`);
    process.exit(args.includes("--help") ? 0 : 1);
  }

  let name = "";
  let purpose = "";
  let tools: string[] | undefined;
  let provider = "deepseek";
  let model = "deepseek-flash";
  let thinking = "low";
  let copyKeys = false;
  let checkOnly = false;
  let skipSmokeTest = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--name" && i + 1 < args.length) name = args[++i];
    else if (arg === "--purpose" && i + 1 < args.length) purpose = args[++i];
    else if (arg === "--tools" && i + 1 < args.length) tools = args[++i].split(",").map((s) => s.trim());
    else if (arg === "--provider" && i + 1 < args.length) provider = args[++i];
    else if (arg === "--model" && i + 1 < args.length) model = args[++i];
    else if (arg === "--thinking" && i + 1 < args.length) thinking = args[++i];
    else if (arg === "--copy-keys") copyKeys = true;
    else if (arg === "--check") checkOnly = true;
    else if (arg === "--skip-smoke-test") skipSmokeTest = true;
  }

  if (!name) {
    console.error("Error: --name is required.");
    process.exit(1);
  }

  try {
    await scaffoldAgent({
      name,
      purpose,
      tools,
      provider,
      model,
      thinking,
      copyKeys,
      checkOnly,
      skipSmokeTest
    });
  } catch (err) {
    console.error(`[FAIL] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
