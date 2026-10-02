# Attribution

This skill is a **vendored, unmodified copy** of `skill-creator` from Anthropic's
Agent Skills repository.

| | |
|---|---|
| **Source** | [`anthropics/skills`](https://github.com/anthropics/skills) |
| **Path** | `skills/skill-creator/` |
| **License** | Apache License 2.0 — see [`LICENSE.txt`](./LICENSE.txt), retained unmodified |
| **Fetched** | 2026-10-02 |

## Provenance

Upstream commit history for this path:

| Commit | Date | Change |
|---|---|---|
| `b9e19e6f` | 2026-04-20 | Fill in Apache 2.0 copyright notice (cosmetic) |
| `b0cbd3df` | 2026-03-06 | `skill-creator`: drop `ANTHROPIC_API_KEY` requirement from description optimizer |
| `1ed29a03` | 2026-02-06 | Update `skill-creator` and make scripts executable |

## Integrity

Vendored content is unmodified. To verify:

```bash
cd ~/.pi/agent/skills/skill-creator
sha256sum SKILL.md
# expected: dcd4803e61e913e6fc27294184cd3a71f09f5e924ff20c8a9a20173e7b3c2bcf

find . -type f -not -name ATTRIBUTION.md -not -name '*.pyc' -not -path './__pycache__/*' \
  | sort | xargs sha256sum | sha256sum
# expected: dfb48eea58f1bee6aef9c149eec5abd6938e079e7dab73c8fce6058be8dfb6fe
```

The only file added locally is this `ATTRIBUTION.md`.

## Local operating notes

This skill was written for Claude Code. Two capabilities are **dormant** here
because the `claude` CLI (Claude Code) is not installed:

- `scripts/run_eval.py` / `scripts/run_loop.py` — automated trigger-accuracy benchmarking
- `scripts/improve_description.py` — description optimizer

Both shell out to `claude -p` and authenticate via Claude Code's subscription
session. They do **not** use `ANTHROPIC_API_KEY`. Upstream `SKILL.md` already
documents these as skippable in environments without the `claude` CLI.

Fully functional with only Python + `pyyaml` (installed):

- `SKILL.md` authoring methodology (the core value)
- `scripts/quick_validate.py` — frontmatter/spec validation
- `scripts/package_skill.py` — packaging
- `scripts/generate_report.py`, `eval-viewer/` — local report viewer

### Re-enabling the eval loop later

Two paths once resources allow:

1. **Install Claude Code**, providing the `claude` CLI. No edits needed.
2. **Re-point at pi** — replace the `claude -p` subprocess calls with
   `pi --print` invocations. pi already supplies the two things upstream marks
   "requires subagents", so `run_eval.py` and blind comparison become feasible
   without Claude Code.
