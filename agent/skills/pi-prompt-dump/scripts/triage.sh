#!/usr/bin/env bash
# pi-prompt-dump triage — the ONLY place an LLM call is permitted.
#
# Reads a prompt-surface diff on stdin and asks a model what changed and whether
# it matters. Everything upstream of this script is deterministic code; this
# script is invoked only by `dump.mjs --triage`.
#
# Environment:
#   PI_PROMPT_DUMP_TRIAGE_MODEL   Optional model pattern (e.g. deepseek-flash).
#   PI_PROMPT_DUMP_TRIAGE_LIMIT   Max diff characters sent (default 40000).
set -euo pipefail

MODEL="${PI_PROMPT_DUMP_TRIAGE_MODEL:-}"
LIMIT="${PI_PROMPT_DUMP_TRIAGE_LIMIT:-40000}"

diff_text="$(cat)"

if [[ -z "${diff_text//[[:space:]]/}" ]]; then
  echo "triage: empty diff, nothing to explain." >&2
  exit 0
fi

truncated_note=""
if (( ${#diff_text} > LIMIT )); then
  diff_text="${diff_text:0:LIMIT}"
  truncated_note="

(NOTE: the diff was truncated to ${LIMIT} characters. Say so explicitly if the truncation limits your answer.)"
fi

read -r -d '' instruction <<'PROMPT' || true
You are reviewing a drift report for the system prompt of a pi coding agent.
The diff below compares the CURRENT instruction surface against a stored baseline.

Answer in this exact structure, and be brief:

1. WHAT CHANGED — one bullet per distinct change, in plain language. Name the
   section (e.g. addendum, project_context, rules, available_subagents) and say
   what changed semantically, not line by line.
2. WHERE IT CAME FROM — your best inference of which file or component the
   change originated from (e.g. ~/.pi/agent/APPEND_SYSTEM.md, an AGENTS.md, a
   SKILL.md frontmatter edit, a pi or extension upgrade).
3. DOES IT MATTER — flag only: (a) unintended or suspicious changes,
   (b) contradictions with other instructions, (c) anything that would silently
   change agent behaviour in a risky way. If nothing is risky, say "nothing
   risky".
4. VERDICT — one of: INTENTIONAL-EDIT / UPGRADE-DRIFT / SUSPICIOUS.

Do not restate the diff. Do not propose rewrites unless asked.

--- DRIFT DIFF ---
PROMPT

prompt="${instruction}
${diff_text}${truncated_note}"

args=(--print --no-session --no-tools --no-extensions --no-skills --no-prompt-templates --no-context-files)
if [[ -n "$MODEL" ]]; then
  args+=(--model "$MODEL")
fi

exec pi "${args[@]}" "$prompt"
