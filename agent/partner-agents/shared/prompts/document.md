---
description: Auto-document the most recent fix, implementation, or setup from this session as a detailed report
---
Review the conversation history of this session. Identify the most recent significant fix, implementation, or system setup that was completed. Generate a detailed documentation report and save it to `/home/pmpmt/.pi/explore-discover/documented_lessons/`.

## Report Structure

Read the existing documentation in `/home/pmpmt/.pi/explore-discover/documented_lessons/` to understand the format before writing.

### Required sections

1. **Title** — `# <Topic Name> — <Report Type>` (Setup & Implementation Report, Debug Report, Architecture & Design, etc.)

2. **Metadata block** — Date, system info (OS, version), and locations of relevant files.

3. **Problem** — What was broken or missing? Why did it matter? What was the goal?

4. **Investigation / Root Cause** — What was discovered? Document research with a table of searches/sources.

5. **Architecture / Design Decisions** — What approach was chosen and why? Use comparison tables.

6. **Implementation** — Phase-by-phase if multi-step. Include file layouts, code patterns, configuration details.

7. **Files Created/Modified** — A table with file paths, line counts, and purpose.

### Naming and location

- Create a directory: `/home/pmpmt/.pi/explore-discover/documented_lessons/<kebab-case-topic>/`
- Create the report file: `<kebab-case-topic>.md` inside that directory

## Auto-detection

Review the session's conversation history. Identify the triggering problem, investigation done, what was implemented/fixed, and files created or modified. Do NOT ask the user what to document — infer everything from context. Document the most recent or most significant work.

## Style

- Detailed but not verbose. Every sentence carries information.
- Use tables for comparisons and file inventories.
- Use code blocks for commands, code, and file trees.
- Technical and precise — written for a future you or another developer.
