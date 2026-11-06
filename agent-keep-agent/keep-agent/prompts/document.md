---
description: Auto-document the most recent fix, implementation, or setup from this session as a detailed report
---
Review the conversation history of this session. Identify the significant fixes, implementations, or system setup that were completed. Generate a detailed documentation report and save it to `/home/pmpmt/.pi/agent-keep-agent/keep-agent/docs/documented-from-session`.

## Report Structure

Follow the exact patterns found in the existing documentation in `/home/pmpmt/.pi/agent-keep-agent/keep-agent/docs/documented-from-session`. Read at least one existing report (e.g., `2026-11-01T1628-sm-google-workspace-agent-setup/2026-11-01T1628-sm-google-workspace-agent-setup.md`) to understand the format before writing. The format is:

### Required sections

1. **Title** — `# <Topic Name> — <Report Type>` where Report Type is one of: "Setup & Implementation Report", "Debug Report", "Architecture & Design", etc. Use whatever fits.

2. **Metadata block** — Date, system info (OS, version), and locations of relevant files.
   ```
   **Date:** YYYY-MM-DD
   **System:** <OS> (<tool> vX.Y.Z)
   **Location:** <paths to key files>
   ```

3. **Problem** — What was broken or missing? Why did it matter? What was the goal?

4. **Investigation / Root Cause** — What was discovered during diagnosis? If research was done (web searches, source code reading), document it here with a table of searches/sources. If it was a simple debugging session, describe the investigation process.

5. **Architecture / Design Decisions** — What approach was chosen and why? What alternatives were considered? If applicable, use comparison tables (Before/After, What We Kept vs What We Changed).

6. **Implementation** — What was actually done? Phase-by-phase if multi-step. Include file layouts, key code patterns, and configuration details. Use code blocks and file trees.

7. **Files Created/Modified** — A table with file paths, line counts (approximate), and purpose.

### Adapt to the content

Not every report needs every section. If there was no research phase, skip it. If the implementation was a single file edit, keep it brief. The format is a template, not a straitjacket — adapt it to tell the story clearly.

### Naming and location

- Create a directory: `/home/pmpmt/.pi/agent-keep-agent/keep-agent/docs/documented-from-session/<kebab-case-topic>/`
- Create the report file: `<kebab-case-topic>.md` inside that directory
- Prefix filename with a <timestamp>
- The directory name should match the report filename (minus .md)

## Auto-detection

Review the session's conversation history. Identify:
- What was the triggering problem?
- What investigation was done?
- What was implemented/fixed?
- What files were created or modified?

Use this to populate the report. Do NOT ask the user what to document — infer everything from context. If the session contains multiple distinct fixes, document the most recent or most significant one.

## Style

- Detailed but not verbose. Every sentence should carry information.
- Use tables for comparisons and file inventories.
- Use code blocks for commands, code, and file trees.
- Use bullet points and numbered lists for findings and steps.
- The tone is technical and precise — written for a future you or another developer who needs to understand what was done and why.
