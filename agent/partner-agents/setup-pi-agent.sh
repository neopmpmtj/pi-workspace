#!/usr/bin/env bash
# setup-pi-agent.sh — Create a new Pi agent identity
#
# Usage: ./setup-pi-agent.sh
# Creates a new agent directory under ~/.pi/<name> with AGENTS.md,
# extensions, bash alias, and a git + GitHub (public) backup.
#
# Uses everything from our curriculum:
#   - PI_CODING_AGENT_DIR (agent identities)
#   - System prompt composition (AGENTS.md generation)
#   - Extension sharing (copy from central tooling shared/)
#   - Sub-agents (starter .md for delegation)
#   - Memory pipeline (optional session-summarizer setup)

set -euo pipefail

# ── Colors ──
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}══════════════════════════════════════════${NC}"
echo -e "${BLUE}   Pi Agent Setup — Create a new identity${NC}"
echo -e "${BLUE}══════════════════════════════════════════${NC}"
echo ""

# ── Step 1: Gather information ──
read -p "$(echo -e "${GREEN}Agent name${NC} (e.g., researcher, writer, coder): ")" AGENT_NAME
AGENT_NAME=$(echo "$AGENT_NAME" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')

if [ -z "$AGENT_NAME" ]; then
  echo -e "${RED}Error: Agent name is required.${NC}"
  exit 1
fi

# ~/.pi is Pi's home directory, not a scratch dir — refuse names that collide.
case "$AGENT_NAME" in
  agent|docs|cron|apps-scripts|html|sessions-memory|sessions-summaries|sessions-summarizer|web-search-cache|postgres-migration|partner-agents|explore-discover|genesis-tester)
    echo -e "${RED}Error: '$AGENT_NAME' is a reserved Pi directory name.${NC}"
    exit 1 ;;
esac

AGENT_DIR="$HOME/.pi/$AGENT_NAME"

if [ -d "$AGENT_DIR" ]; then
  echo -e "${YELLOW}Warning: $AGENT_DIR already exists.${NC}"
  read -p "Overwrite? (y/N): " CONFIRM
  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Aborted."
    exit 0
  fi
fi

echo ""
read -p "$(echo -e "${GREEN}What does this agent do?${NC} (one sentence): ")" PURPOSE
read -p "$(echo -e "${GREEN}Default model${NC} [deepseek-chat]: ")" MODEL
MODEL=${MODEL:-deepseek-chat}

echo ""
echo -e "${GREEN}Available tools:${NC}"
echo "  1) read, grep, find, ls       (read-only)"
echo "  2) read, write, edit, bash     (full access)"
echo "  3) read, grep, find, ls, bash  (read + shell)"
echo "  4) Custom"
read -p "Choose [2]: " TOOL_CHOICE
case ${TOOL_CHOICE:-2} in
  1) TOOLS="read, grep, find, ls" ;;
  2) TOOLS="read, write, edit, bash" ;;
  3) TOOLS="read, grep, find, ls, bash" ;;
  4) read -p "Enter tools (comma-separated): " TOOLS ;;
  *) TOOLS="read, write, edit, bash" ;;
esac

echo ""
read -p "$(echo -e "${GREEN}Thinking level${NC} (off/minimal/low/medium/high) [low]: ")" THINKING
THINKING=${THINKING:-low}

echo ""
read -p "$(echo -e "${GREEN}Create bash alias?${NC} (e.g., pi-${AGENT_NAME}) [Y/n]: ")" MAKE_ALIAS
MAKE_ALIAS=${MAKE_ALIAS:-y}

echo ""
read -p "$(echo -e "${GREEN}Set up memory pipeline?${NC} (session-summarizer) [y/N]: ")" SETUP_MEMORY
SETUP_MEMORY=${SETUP_MEMORY:-n}

echo ""
read -p "$(echo -e "${GREEN}Create sub-agent .md file?${NC} (for orchestrator delegation) [y/N]: ")" MAKE_SUBAGENT
MAKE_SUBAGENT=${MAKE_SUBAGENT:-n}

read -p "$(echo -e "${GREEN}Copy optional extensions?${NC} (specialized tools: calculator, git, etc.) [y/N]: ")" COPY_OPTIONAL
COPY_OPTIONAL=${COPY_OPTIONAL:-n}

# ── Step 2: Create directory structure ──
echo ""
echo -e "${BLUE}Creating $AGENT_DIR...${NC}"

mkdir -p "$AGENT_DIR"
mkdir -p "$AGENT_DIR/extensions"
mkdir -p "$AGENT_DIR/prompts"
mkdir -p "$AGENT_DIR/skills"
mkdir -p "$AGENT_DIR/sessions"

# ── Step 3: Generate AGENTS.md ──
echo -e "${BLUE}Generating AGENTS.md...${NC}"

AGENT_TITLE=$(echo "$AGENT_NAME" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2))}1')

cat > "$AGENT_DIR/AGENTS.md" << AGENTEOF
# $AGENT_TITLE Agent

$PURPOSE

## How to Work

- Be concise and direct.
- Use your available tools to accomplish tasks.
- Report clearly what you did and any issues encountered.
- If you're unsure about something, ask for clarification.

## Available Tools

$(echo "$TOOLS" | tr ',' '\n' | sed 's/^/- **/;s/$/**/')

## Model

- Default: **$MODEL**
- Thinking level: **$THINKING**

## Reporting Protocol

When you complete a task, end with:

1. **What you did** — specific files changed, actions taken
2. **Current state** — is the work complete or in-progress?
3. **Next steps** — anything that needs follow-up
AGENTEOF

# ── Step 4: Copy shared extensions (core always, optional opt-in) ──
echo -e "${BLUE}Copying shared extensions...${NC}"

SHARED_DIR="$HOME/.pi/agent/partner-agents/shared"
CORE_EXTS="$SHARED_DIR/extensions/core"
OPTIONAL_EXTS="$SHARED_DIR/extensions/optional"

COPIED=0
if [ -d "$CORE_EXTS" ]; then
  for ext in "$CORE_EXTS"/*; do
    if [ -f "$ext" ]; then
      cp "$ext" "$AGENT_DIR/extensions/"
      COPIED=$((COPIED + 1))
    fi
  done
fi
echo -e "  ${GREEN}Copied $COPIED core extensions${NC}"

if [ "$COPY_OPTIONAL" = "y" ] || [ "$COPY_OPTIONAL" = "Y" ]; then
  OPT_COPIED=0
  if [ -d "$OPTIONAL_EXTS" ]; then
    for ext in "$OPTIONAL_EXTS"/*; do
      if [ -f "$ext" ]; then
        cp "$ext" "$AGENT_DIR/extensions/"
        OPT_COPIED=$((OPT_COPIED + 1))
      fi
    done
  fi
  echo -e "  ${GREEN}Copied $OPT_COPIED optional extensions${NC}"
fi

# ── Step 5: Copy prompt template (template __AGENT_DIR__ → this agent) ──
PROMPT_SRC="$SHARED_DIR/prompts/document.md"
if [ -f "$PROMPT_SRC" ]; then
  cp "$PROMPT_SRC" "$AGENT_DIR/prompts/document.md"
  sed -i "s|__AGENT_DIR__|$AGENT_DIR|g" "$AGENT_DIR/prompts/document.md"
  echo -e "  ${GREEN}Copied /document prompt template (paths templated)${NC}"
fi

# ── Step 6: Create sub-agent .md ──
if [ "$MAKE_SUBAGENT" = "y" ] || [ "$MAKE_SUBAGENT" = "Y" ]; then
  SUBAGENT_DIR="$HOME/.pi/agent/agents"
  mkdir -p "$SUBAGENT_DIR"
  SUBAGENT_FILE="$SUBAGENT_DIR/$AGENT_NAME.md"
  
  if [ -f "$SUBAGENT_FILE" ]; then
    echo -e "  ${YELLOW}Sub-agent $SUBAGENT_FILE already exists — skipping${NC}"
  else
    cat > "$SUBAGENT_FILE" << SUBEOF
---
name: $AGENT_NAME
description: $PURPOSE
tools: $TOOLS
model: $MODEL
thinking: $THINKING
---

$(cat "$AGENT_DIR/AGENTS.md")
SUBEOF
  echo -e "  ${GREEN}Created sub-agent: ~/.pi/agent/agents/$AGENT_NAME.md${NC}"
  fi
fi

# ── Step 7: Create .env reference ──
cat > "$AGENT_DIR/.env" << ENVEOF
# Pi agent environment — loaded by pi when using this agent identity
# Add your API keys here or reference ~/.pi/agent/.env

# PI_CODING_AGENT_DIR is set by the bash alias, not here
ENVEOF

# ── Step 8: Set up memory pipeline ──
if [ "$SETUP_MEMORY" = "y" ] || [ "$SETUP_MEMORY" = "Y" ]; then
  echo -e "${BLUE}Setting up memory pipeline...${NC}"

  # Per-agent snapshot inbox + curated memory (both git-ignored, see template)
  mkdir -p "$AGENT_DIR/session-summaries"
  mkdir -p "$AGENT_DIR/sessions-memory"

  # Copy session-memory.ts and pin its snapshot dir to THIS agent.
  # The shared default is <agent>/extensions/../../session-summaries — the
  # parent of a grouped agent (shared by every partner agent). Replace that
  # fallback with an absolute per-agent path so the inbox is unambiguous.
  SESSION_MEMORY_SRC="$SHARED_DIR/extensions/optional/session-memory.ts"
  if [ -f "$SESSION_MEMORY_SRC" ]; then
    cp "$SESSION_MEMORY_SRC" "$AGENT_DIR/extensions/session-memory.ts"
    SM_OLD='join(import.meta.dirname, "..", "..", "session-summaries")'
    if grep -qF "$SM_OLD" "$AGENT_DIR/extensions/session-memory.ts"; then
      sed -i "s|$SM_OLD|\"$AGENT_DIR/session-summaries\"|" "$AGENT_DIR/extensions/session-memory.ts"
      echo -e "  ${GREEN}Copied and configured session-memory.ts${NC}"
    else
      echo -e "  ${YELLOW}Warning: session-memory.ts fallback pattern changed — snapshot dir NOT pinned to $AGENT_DIR${NC}"
      echo -e "  ${YELLOW}Set PI_SESSION_SUMMARIES_PATH manually in the agent environment.${NC}"
    fi
  fi

  # Copy the summarizer INTO the agent workspace (tracked by its repo; state
  # and logs are git-ignored) and point it at this agent's inbox/output.
  SUMMARIZER_SRC="$SHARED_DIR/session-summarizer"
  SUMMARIZER_DST="$AGENT_DIR/session-summarizer"
  if [ -d "$SUMMARIZER_SRC" ] && [ ! -d "$SUMMARIZER_DST" ]; then
    cp -r "$SUMMARIZER_SRC" "$SUMMARIZER_DST"
    sed -i "s|__AGENT_DIR__|$AGENT_DIR|g" "$SUMMARIZER_DST/summarizer-config.json"
    echo -e "  ${GREEN}Copied summarizer to $SUMMARIZER_DST (paths templated)${NC}"
  fi
fi

# ── Step 9: Add bash alias ──
if [ "$MAKE_ALIAS" = "y" ] || [ "$MAKE_ALIAS" = "Y" ]; then
  ALIAS_LINE="alias pi-$AGENT_NAME='PI_CODING_AGENT_DIR=$AGENT_DIR pi'"
  
  if grep -q "pi-$AGENT_NAME" "$HOME/.bashrc" 2>/dev/null; then
    echo -e "  ${YELLOW}Alias 'pi-$AGENT_NAME' already exists in .bashrc${NC}"
  else
    echo "" >> "$HOME/.bashrc"
    echo "# Pi $AGENT_NAME agent" >> "$HOME/.bashrc"
    echo "$ALIAS_LINE" >> "$HOME/.bashrc"
    echo -e "  ${GREEN}Added alias: pi-$AGENT_NAME${NC}"
    echo -e "  ${YELLOW}Run: source ~/.bashrc${NC} (or open a new terminal)"
  fi
fi

# ── Step 10: Git + GitHub backup ──
echo ""
echo -e "${BLUE}Setting up git + GitHub backup...${NC}"

# Canonical .gitignore (excludes sessions, summaries, secrets, runtime deps)
GITIGNORE_TEMPLATE="$HOME/.pi/agent/partner-agents/gitignore.template"
if [ -f "$GITIGNORE_TEMPLATE" ]; then
  cp "$GITIGNORE_TEMPLATE" "$AGENT_DIR/.gitignore"
else
  cat > "$AGENT_DIR/.gitignore" << GITIGNOREEOF
sessions/
session-summaries/
sessions-memory/
.env
*.key
*.pem
npm/
bin/
node_modules/
*.log
__pycache__/
GITIGNOREEOF
fi

# Shared secrets as symlinks — no keys ever enter this repo
ln -sf "$HOME/.pi/agent/auth.json" "$AGENT_DIR/auth.json"
ln -sf "$HOME/.pi/agent/models-store.json" "$AGENT_DIR/models-store.json"

# Init + first commit
if [ ! -d "$AGENT_DIR/.git" ]; then
  git -C "$AGENT_DIR" init -q -b main
fi
git -C "$AGENT_DIR" add -A
git -C "$AGENT_DIR" commit -q -m "init: $AGENT_NAME partner agent" || echo -e "  ${YELLOW}Nothing to commit yet${NC}"

# Create the public GitHub repo (or reuse an existing one)
REPO="neopmpmtj/$AGENT_NAME"
if gh repo view "$REPO" >/dev/null 2>&1; then
  echo -e "  ${YELLOW}GitHub repo $REPO already exists — wiring remote${NC}"
  git -C "$AGENT_DIR" remote remove origin 2>/dev/null || true
  git -C "$AGENT_DIR" remote add origin "https://github.com/$REPO.git"
else
  echo -e "  ${GREEN}Creating public repo: $REPO${NC}"
  gh repo create "$REPO" --public --source "$AGENT_DIR" --push
fi
git -C "$AGENT_DIR" push -u origin main 2>/dev/null || true

# Register in the central partner-agent registry (deduped)
REGISTRY="$HOME/.pi/agent/partner-agents/partner-agents.list"
touch "$REGISTRY"
grep -qxF "$AGENT_DIR" "$REGISTRY" || echo "$AGENT_DIR" >> "$REGISTRY"
echo -e "  ${GREEN}Registered in $REGISTRY${NC}"

# ── Done ──
echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}   Agent '$AGENT_NAME' is ready!${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo -e "  Directory: ${BLUE}$AGENT_DIR${NC}"
echo -e "  Start:     ${BLUE}pi-$AGENT_NAME${NC}  (after source ~/.bashrc)"
echo ""
echo -e "  Files created:"
echo -e "    ${GREEN}✓${NC} $AGENT_DIR/AGENTS.md"
echo -e "    ${GREEN}✓${NC} $AGENT_DIR/extensions/ ($COPIED extensions)"
echo -e "    ${GREEN}✓${NC} $AGENT_DIR/prompts/"
echo -e "    ${GREEN}✓${NC} $AGENT_DIR/skills/"
echo -e "    ${GREEN}✓${NC} $AGENT_DIR/.env"
[ "$MAKE_SUBAGENT" = "y" ] || [ "$MAKE_SUBAGENT" = "Y" ] && echo -e "    ${GREEN}✓${NC} ~/.pi/agent/agents/$AGENT_NAME.md (sub-agent)"
[ "$SETUP_MEMORY" = "y" ] || [ "$SETUP_MEMORY" = "Y" ] && echo -e "    ${GREEN}✓${NC} Memory pipeline configured"
echo ""
