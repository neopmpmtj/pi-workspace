# sm-google-workspace: calling contract

For another agent calling this one from the shell. Human reference: [README.md](../README.md).

## Default call

```bash
cd ~/.pi/agent-gog-workspace-agents/sm-google-workspace && pi-sm-google-workspace -p "/inbox-new"
cd ~/.pi/agent-gog-workspace-agents/sm-google-workspace && pi-sm-google-workspace -p "List all folders in the root of my Google Drive"
```

- Run from the agent repo root (the folder holding `.env`), so relative paths and the ledger resolve.
- Two kinds of call, and the difference is whether the agent gets tools:
  - **plain language** starts a chat turn. That agent has `bash`, so it can run `gog` and actually read Gmail, Drive, Sheets, Calendar. Costs a model turn.
  - **`/ask <question>`** starts no chat turn and has no tools. It answers from the model's own memory. Never use it for anything about the account.
  - **`/gdrive-root`, `/inbox-new`, `/agenda`, `/from <sender>`, `/find <name>`** run one fixed `gog` command, shape the JSON, and print it. No model turn, no tokens, about a second.

## Output

- A chat turn prints the model's answer.
- `/ask` prints the answer on stdout and the token/cost line on stderr.
- A canned command prints tab-separated rows on stdout, one per record:

```text
# /gdrive-root
<name>\t<folder|file>\t<id>\t<modifiedTime>

# /inbox-new
<date>\t<from>\t<subject>\t<id>

# /agenda
<start>\t<end>\t<summary>\t<id>

# /from <sender>
<date>\t<from>\t<subject>\t<id>

# /find <name>
<name>\t<folder|file>\t<id>\t<modifiedTime>

# trailing line, only when rows are held back
+<held> more rows not shown (<total> total); run with --limit 0 to see all of them.
```

- Every canned command prints 20 rows unless told otherwise: `--limit N` changes that,
  `--limit 0` prints every row. When rows are held back, the last line says how many and
  points at `--limit 0`. The trailing line is not a record and does not start with a tab-separated row.
- `/from <sender>` and `/find <name>` need their argument. With none they print `Usage: ...`
  and call nothing, so a bare `/from` can never list the whole mailbox. A sender or name with
  spaces needs no quoting: everything that is not `--limit` is the term.
- `nothing found` when `gog` returns an empty list (`/agenda` with no events today included).
- A failure prints `[FAIL] <reason>` on stderr, records nothing, and exits non-zero:

```bash
pi-sm-google-workspace -p "/inbox-new" > mail.txt || echo "failed" >&2
```

## What it needs to work

| Piece | Value |
| --- | --- |
| Account | `neopmpmtj@gmail.com` (from `GOG_ACCOUNT` in the repo `.env`) |
| Granted services | `calendar`, `docs`, `drive`, `sheets` on the `default` client; Gmail answers too |
| Keyring | `file` backend; `GOG_KEYRING_PASSWORD` in the repo `.env` |
| `gog` | 0.34.0, `/home/pmpmt/.local/bin/gog` |

Without `GOG_KEYRING_PASSWORD` in a non-interactive shell, every call fails with
`no TTY available for keyring file backend password prompt`. Without `GOG_ACCOUNT`, with
`missing --account`. Both are the caller's environment to fix, not the agent's fallback to invent.

Read before writing. The canned commands are read-only by construction; anything that sends,
deletes, shares, or edits is a chat turn where the agent was asked for that change.

<!-- BEGIN GENERATED: commands -->
<!-- Written by scripts/publish.ts. Change the extension code, then run npm run publish:agent. -->

## Slash commands

### /usage

Tokens and cost: /usage · /usage --all · /usage --session · /usage <runId>

```text
/usage
/usage --all
/usage --session
/usage <runId>
/usage --help

Prints this text and does not read the ledger.

/usage            Last run.
/usage --all      Totals per provider and model.
/usage --session  This session only.
/usage <runId>    One run by id prefix.
```

### /gdrive-root

Root of Google Drive: name, folder|file, id, modified — one tab-separated row per item, 20 rows by default (--limit N). No model turn, no tokens.

```text
/gdrive-root [--limit N]

Lists what sits in the root of Google Drive, one tab-separated row per item:

  <name>	<folder|file>	<id>	<modifiedTime>

--limit N   Rows to print, 0 or more. Default 20. 0 prints all.

Runs `gog drive ls --json --results-only`, so there is no model turn and no tokens. When rows are held back, one trailing line says how many and how to see them. An empty result prints `nothing found`.
```

### /inbox-new

Unread mail newer than N hours (default 24): date, from, subject, id, 20 rows by default (--limit N). No model turn, no tokens.

```text
/inbox-new [--hours N] [--limit N]

Lists unread mail newer than N hours, one tab-separated row per message:

  <date>	<from>	<subject>	<id>

--hours N   1 to 720. Default 24.
--limit N   Rows to print, 0 or more. Default 20. 0 prints all.

Runs `gog gmail search 'is:unread newer_than:Nh' --json --results-only`, so there is no model turn and no tokens. When rows are held back, one trailing line says how many and how to see them. An empty result prints `nothing found`.
```

### /agenda

Today's events on the primary calendar: start, end, summary, id — 20 rows by default (--limit N). No model turn, no tokens.

```text
/agenda [--limit N]

Lists today's events on the primary calendar, one tab-separated row per event:

  <start>	<end>	<summary>	<id>

--limit N   Rows to print, 0 or more. Default 20. 0 prints all.

Runs `gog calendar events primary --today --all-pages --json --results-only` in this machine's timezone, so there is no model turn and no tokens. Times are what Google returns (RFC3339); an all-day event prints its date instead. When rows are held back, one trailing line says how many and how to see them. An empty result prints `nothing found`, which means no events today, not a failure.
```

### /from

Unread mail from one sender: date, from, subject, id — /from <sender> [--limit N], 20 rows by default. No sender, no search. No model turn, no tokens.

```text
/from <sender> [--limit N]

Lists unread mail from one sender, one tab-separated row per message:

  <date>	<from>	<subject>	<id>

<sender>    An email address or a name. Everything that is not --limit is the sender.
--limit N   Rows to print, 0 or more. Default 20. 0 prints all.

The sender is required. Without it the command prints this usage and searches nothing, so a bare /from can never turn into a whole-mailbox listing.

Runs `gog gmail list 'is:unread from:"<sender>"' --all --json --results-only`, so there is no model turn and no tokens. When rows are held back, one trailing line says how many and how to see them. An empty result prints `nothing found`.
```

### /find

Drive files whose name contains a term: name, folder|file, id, modified — /find <name> [--limit N], 20 rows by default. No model turn, no tokens.

```text
/find <name> [--limit N]

Lists Drive files whose name contains a term, one tab-separated row per file:

  <name>	<folder|file>	<id>	<modifiedTime>

<name>      Words to look for in the file name. Everything that is not --limit is the name.
--limit N   Rows to print, 0 or more. Default 20. 0 prints all.

The name is required. Without it the command prints this usage and searches nothing.

Runs `gog drive ls --query "name contains '<name>'" --all --max 1000 --json --results-only`, across every file the account can see, so there is no model turn and no tokens. When rows are held back, one trailing line says how many and how to see them. An empty result prints `nothing found`.
```

### /ask

One request, no chat turn: /ask "question" [--model gpt-6.1-sol] [--effort low] [--timeout 60]. Save defaults with --set-default-model.

```text
/ask "question" [--provider ID] [--model ID] [--effort LEVEL] [--timeout SECONDS]
/ask --set-default-provider ID | --set-default-model ID | --set-default-effort LEVEL
/ask --help

Prints this text and does not send a request or write default-model.json.

--provider ID                  deepseek, openai, or google.
--model ID                     Model id, or provider/id.
--effort LEVEL                 off, default, minimal, low, medium, high, xhigh, or max.
--timeout SECONDS              Seconds before the request is aborted.
--set-default-provider ID      Save the default provider. No request. May be combined with --set-default-model.
--set-default-model ID         Save the default model. No request. May be combined with --set-default-provider.
--set-default-effort LEVEL     Save the default effort. No request. Use it alone.

A save cannot be combined with a question or a run flag.
```

## Tools (chat model only)

None.

<!-- END GENERATED: commands -->
