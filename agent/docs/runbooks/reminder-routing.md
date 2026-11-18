# Reminder routing: run it, check it, move it to the VPS

> Written 2026-11-05. Reminders ("remind me to...", "lembra-me de...") go to one exclusive
> writer: `store` (`reminders.jsonl` + a 15-minute calendar event) or `tasks` (`gog tasks`
> on the Google Tasks list named Reminders). They are separate from `docs/INBOX.md`.

## How one message flows

1. `src/jev-classify.ts` asks the multi classifier **once per message** (13 questions) and
   shares the answer with every hook. Slash commands, code blocks, and a bare path or URL
   are skipped before any call.
2. `arbiter.py` picks one winner: `reminder_done` > `reminder` > `calendar`, then bands it:
   `act` (>= 0.85) writes, `hint` (>= 0.6) asks the user, otherwise an ordinary turn. Vetoes
   (`is_past_report`, `is_question`, `about_someone_else`, `is_change_or_cancel`) block at
   >= 0.7 and cap at `hint` from 0.5.
3. The extension of the winning class runs its node with `--classifier-json`, so the node
   does not classify again. The node's extractor is a second opinion: if it reads the message
   as another kind, the write becomes a hint.

`reminderNode.writer` chooses the destination: `store` (jsonl + calendar), `tasks`
(`gog tasks add` / `done` on the Reminders list), or `off` (classify only). Sample default
is `tasks`. `/reminders`, `/reminder-done`, and `/reminder-undo` still operate the jsonl
table.

Defaults: no time means 06:00 (or the next full hour when 06:00 today has passed); no date
means the next occurrence of a stated time — today while it is still ahead, tomorrow once
it has passed — and tomorrow 06:00 when no time was stated either. Store events last 15
minutes, no freebusy check. On store done, a future event is deleted and a past one is kept.
Tasks due is the date; the local time is stored in the task notes.

## Commands (CoS home)

| Command | Effect |
|---|---|
| `/reminders [--all]` | pending table (or every status) |
| `/reminder-done <id>` | mark done, delete the future event |
| `/reminder-undo` | withdraw the newest pending reminder |
| `/calendar-undo` | delete the last event the calendar node created |
| `/jev-wrong <label>` | file the last message into `eval/jev-golden.jsonl` with the right label |

The same from a shell:

```bash
cd ~/.pi/decision-nodes/reminder
./route.py --text "Remind me to buy milk" --dry-run
./route.py --list --all
./route.py --done r-20261105-7be0
./route.py --undo
```

`REMINDER_STORE=/tmp/x.jsonl` points the table at a scratch file for live tests, so test
rows never reach git.

## Measure the classifier

```bash
cd ~/.pi/jev-classifier
python3 eval/jev-eval.py                  # cached; --no-cache to re-ask every phrase
python3 eval/jev-eval.py --lang pt
python3 eval/jev-eval.py --save eval/results-$(date +%F).json
```

Gate for any change to a class or the arbiter: **false acts stays 0**. Add every live miss to
`eval/jev-golden.jsonl` (`/jev-wrong` does it for you) before tuning.

## Sync between hosts

`reminders.jsonl` is append-only and merged with `merge=union` (`~/.pi/.gitattributes`), so
both hosts can add rows and a pull never conflicts. Status is folded from the ops (`add`,
`event`, `done`, `undo`), never edited in place.

## Moving it to the VPS

State on 2026-11-05 (read-only check): `~/.pi` at `4a6b969` (behind), `~/.pi/jev-classifier`
is an **empty, uninitialised gitlink**, no `gog`, no `~/.pi/jev-classifier/.env`.

1. On the laptop, commit and push the classifier repo, then bump the gitlink:

   ```bash
   git -C ~/.pi/jev-classifier add -A && git -C ~/.pi/jev-classifier commit -m "reminder classes, vetoes, arbiter, eval" && git -C ~/.pi/jev-classifier push
   git -C ~/.pi add jev-classifier && git -C ~/.pi commit -m "bump jev-classifier" && git -C ~/.pi push
   ```

2. On the VPS:

   ```bash
   git -C ~/.pi pull --ff-only
   git -C ~/.pi submodule update --init jev-classifier   # or clone neopmpmtj/jev-classifier into it
   ls ~/.pi/jev-classifier/jev-classifier-multi/src/arbiter.py
   ```

3. Put `TYPESAFE_API_KEY=...` in `~/.pi/jev-classifier/.env`, and install `gog` (see
   `calendar-routing-on-vps.md`, steps 2-4).

Until step 2 lands, the classifier answer has no `winner`, and both hooks fail open:
every message becomes an ordinary model turn. Nothing is written by mistake.

## Failure modes

| Symptom | Cause |
|---|---|
| every reminder becomes a model turn | no `winner` in the classifier JSON (old jev-classifier) or `reminderNode.enabled` is off |
| `downgraded`, "second opinion" | the extractor read it as calendar or other; nothing written |
| `no-match` on "I did X" | no pending reminder matched with >= 0.7; the pending list is shown |
| reminder logged, event `failed` | `gog` missing or unauthenticated; the row stays pending |

## This host: writer is `tasks` (since 2026-11-07)

`pi-config set reminderNode.writer tasks` — `~/.pi/config.json` previously had no `writer`
key, so `pi-config get reminderNode` reported the default `store` and reminders went to
`reminders.jsonl` + a 15-minute calendar event. The hook passes `--writer tasks` to
`route.py` on every message (`src/reminder-node.ts`), so the config value is the only switch.

Verified after the flip:

- `route.py --text ... --writer tasks --dry-run` → `do:reminder:tasks`
- a real run created the Google Task on the `Reminders` list (`bVZhcmpkbWR4bUs4WldLNg`),
  wrote no `reminders.jsonl` row and no calendar event (test task deleted afterwards)
- `npm test` (`test/reminder-node.test.ts`, 20 tests) passes, including the write-switch test

Consequences: `/reminders`, `/reminder-done <id>` and `/reminder-undo` operate on the jsonl
store, so they are now empty/no-ops for new reminders — new ones live in Google Tasks and are
closed by restating ("I bought the X") or by asking tasks-agent.

Known limitation: Google Tasks `due` is date-only. A reminder with a stated time keeps the
date and loses the time (the time survives only in the node's note line).

## Two gotchas when switching to `writer: tasks`

**1. The hook only knows about `writer` since commit `956502e` (2026-11-07 19:06).** Pi loads
`src/` and `extensions/` at startup, so a pi process older than that code silently runs the
previous behaviour: it reads `reminderNode` but ignores `writer`, takes the `store` path, and
logs a jsonl row. That is exactly what a Telegram turn did at 19:28 on a pi started 18:35 —
`do:reminder:log` + `do:reminder:calendar failed`. `pi-config set reminderNode.writer tasks`
alone is not enough; `systemctl --user restart pi-cos.service` (from an SSH shell, never from
inside the agent) is. Tell-tale: `~/.pi/config.json` says `tasks`, and the verdict in
`verdicts.jsonl` still shows `do:reminder:log`.

**2. `gog` was not on the service PATH.** `~/.pi/agent/bin/gog` is the only binary on this host;
`~/.local/bin/gog` did not exist, and the pi process PATH contains `~/.local/bin` but *not*
`~/.pi/agent/bin`. Tool shells masked this (pi prepends its own bin dir), so every hand-run
probe succeeded while the hook failed with
`gog not runnable: [Errno 2] No such file or directory: 'gog'`. Fixed with:

```bash
ln -sfn ~/.pi/agent/bin/gog ~/.local/bin/gog    # what CALLING.md in the sibling homes assumes
```

Check any future host with the service PATH, not yours:

```bash
env -i HOME=$HOME PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/bin \
  bash -c 'command -v gog && gog --version'
```
