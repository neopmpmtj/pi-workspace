---
name: Project dashboard
overview: Add a project dashboard on port 8786. The landing page starts and stops agent dashboards in new browser tabs. The settings page is sectioned by concern, and every field it shows can be edited.
todos:
  - id: keep-port
    content: Move the keep-agent dashboard default port to 8790
    status: completed
  - id: project-server
    content: Add the ~/.pi/dashboard server on 8786 with start, stop, and open-tab
    status: completed
  - id: landing
    content: "Landing page: per-agent Start and Stop, plus Start all and Stop all, with each agent's effective model beside the row"
    status: completed
  - id: settings
    content: Sectioned settings page that reads and writes every control-plane field it shows
    status: completed
isProject: false
---

# Project dashboard

The `~/.pi` project is not an agent and has no dashboard. Each live agent already has one. This adds a project dashboard on `http://127.0.0.1:8786`. The landing page starts and stops those dashboards. The settings page is a sectioned editor of the project's control plane: every field on that page can be changed, and fields that do not belong together stay in their own section.

## What you asked for

- A dashboard for the project, separate from the cos orchestrator and the other agents.
- A dedicated settings page with the project's settings visible and editable, grouped so each kind of setting has its own section.
- A landing page with Start and Stop on each agent, plus Start all and Stop all. Starting a dashboard opens it in a new browser tab.

## What the settings page edits

Every value the page shows is saved back to the file it came from. The page does not grow into an editor for the whole repo.

Edited, in their own sections:

- [config.json](/home/pmpmt/.pi/config.json). One card per gate: `enabled`, and the other fields in that section (`words`, `print`, `mode`, `writes`).
- [agent-modes-config.json](/home/pmpmt/.pi/agent-modes-config.json). `inputPhrase.enabled`, exactly one of `normal` or `advanced`, each option's `allowBlank`, and the phrase strings including `append1`. `append1` stays a string that is always appended, including blank. A blank option phrase is kept only when that option's `allowBlank` is boolean `true`. The save refuses a section that is on with zero options or with both options on.
- Each live agent's `settings.json`: provider, model, thinking level, tools, enabled models, packages, and extension entries. An extension switch rewrites `+path` (load) and `-path` (unload) and leaves the path in the list. Keep-agent has no `extensions` array today; its card shows that and can add one only when an extension path is entered. Other keys in the file (`theme`, changelog versions, compaction) are preserved and are not fields on this page.

When `default-model.json` exists beside an agent, the launcher uses it ahead of `settings.json`. Editing provider, model, or thinking writes that file when it is present, and writes `settings.json` when it is not, so the value on screen is the value the next launch uses.

Left out on purpose:

- secrets: `.env`, `auth.json`, `telegram.json`, key files
- copies and the scaffold: `agent-keep-agent copy`, `agent-cos-orchestrator-agent`, `agent-template-new-agent`, `##agent`
- skill configs, cron jobs, eval results, and prompt captures
- the dashboard listen port. That is process status on the landing page, not a setting in these JSON files
- starting or stopping the `pi` process. This page starts dashboards. A live `pi` keeps the extensions and `settings.json` it loaded at startup. `config.json` and `agent-modes-config.json` are read on each user message

The per-agent Start and Stop stay. Start all does not replace opening one dashboard.

## Landing page

One section, four rows. Each row shows the effective provider and model, the port, Start, Stop, and Open. A link goes to Settings. The editors are not repeated here.

- cos orchestrator, [agent/cos-orchestrator-agent/dashboard/server.ts](/home/pmpmt/.pi/agent/cos-orchestrator-agent/dashboard/server.ts), port 8787
- image describer, [agent-image-describer/image-describer/dashboard/server.ts](/home/pmpmt/.pi/agent-image-describer/image-describer/dashboard/server.ts), port 8788
- web master, [agent-web-master/web-master/dashboard/server.ts](/home/pmpmt/.pi/agent-web-master/web-master/dashboard/server.ts), port 8789
- keep agent, [agent-keep-agent/keep-agent/dashboard/server.ts](/home/pmpmt/.pi/agent-keep-agent/keep-agent/dashboard/server.ts). Its default is also 8787, so Start all cannot run it beside the orchestrator. Change that default to 8790.

Google Workspace is on the settings page only. It has no dashboard.

Start runs `npm run dashboard` in that agent home with `DASHBOARD_PORT` set, then `xdg-open` on `http://127.0.0.1:<port>` so the existing browser opens a new tab. Stop kills the process this dashboard started. If the port is already taken by a dashboard started elsewhere, the row shows running and Open still opens the tab. Stop does not kill a process it did not start. Start all and Stop all walk the four rows.

## Settings page

Own page at `/settings`. The page is a stack of sections, each with a heading and one card per item. A save button belongs to that card, so saving the calendar gate does not write an agent's model.

- Project gates. Six cards, one per key in `config.json`.
- Input phrase. One card.
- Agents. Five cards, in this order:
  - [agent/cos-orchestrator-agent](/home/pmpmt/.pi/agent/cos-orchestrator-agent)
  - [agent-keep-agent/keep-agent](/home/pmpmt/.pi/agent-keep-agent/keep-agent)
  - [agent-web-master/web-master](/home/pmpmt/.pi/agent-web-master/web-master)
  - [agent-image-describer/image-describer](/home/pmpmt/.pi/agent-image-describer/image-describer)
  - [agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace](/home/pmpmt/.pi/agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace)

Inside an agent card, three subsections: Model (provider, model, thinking, enabled models), Tools, Extensions. Packages sit under Extensions only when that file has a `packages` array. A note under Extensions says the running agent keeps its old list until it is started again.

Numbers stay numbers (`words` is an integer of 1 or more). Booleans stay booleans. `mode` stays the string already used (`route` or `dry`). A bad value is rejected on that card and the file is not written.

## Where it lives

New app at [dashboard/](/home/pmpmt/.pi/dashboard) under `~/.pi`: `server.ts`, `public/index.html`, `public/settings.html`, `public/app.js`, `public/style.css`. Localhost only. It does not replace any agent dashboard and it is not one of the rows it starts.
