# Reminder routing: run it, check it, move it to the VPS

> Written 2026-11-05. Reminders ("remind me to...", "lembra-me de...") are logged in
> `~/.pi/decision-nodes/reminder/reminders.jsonl` and get a 15-minute calendar event.
> They are separate from `docs/INBOX.md`.

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

Defaults: no time means 06:00 (or the next full hour when 06:00 today has passed); no date
means the next occurrence of a stated time — today while it is still ahead, tomorrow once
it has passed — and tomorrow 06:00 when no time was stated either. Events last 15 minutes,
no freebusy check. On done, a future event is deleted and a past one is kept.

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
