# Calendar routing on the VPS: what it takes

> Decision 2026-11-04: **Telegram stays on the VPS.** The laptop keeps no bot token and no
> bridge; the VPS bridge is the only polling owner. This file is the checklist for making
> the calendar route work there, written after a read-only inspection of `neopmpmtj` on
> 2026-11-04.

## What the VPS already has

| Piece | State on `neopmpmtj` |
|---|---|
| `~/.pi` clone | present, at `f28c6dc` — **behind** the laptop (`79cd36b`) |
| `~/.pi/decision-nodes/calendar/` | **missing** (arrives with the pull) |
| `~/.pi/config.json` with `calendarNode` | **missing** (arrives with the pull) |
| python3 | 3.12.3, fine (`zoneinfo` available) |
| `gog` binary | **missing** — but `~/.config/gogcli` and `~/.local/share/gogcli` exist |
| gog agent `.env` | present (5 keys) |
| CoS `.env` | present (4 keys) |
| `~/.pi/jev-classifier/.env` (TYPESAFE_API_KEY) | **missing** |

## Steps

Run as the `pmpmt` user on the VPS.

1. **Pull the repository** (brings the node, the extension, and the `calendarNode` section
   of `~/.pi/config.json`):

   ```bash
   git -C ~/.pi pull --ff-only
   ls ~/.pi/decision-nodes/calendar/          # config.py route.py README.md tests/
   grep -c calendarNode ~/.pi/config.json   # 1
   ```

2. **Install `gog`** so the read and the write can run. The config and data dirs already
   exist, so after installing verify rather than re-authenticate:

   ```bash
   # install the same build as the laptop (0.34.0), then:
   set -a; . ~/.pi/agent-gog-workspace-agents/sm-google-workspace/.env; set +a
   gog calendar events primary --from 2026-11-09 --to 2026-11-10 -p
   ```

   A read here is the whole gate: if `gog` cannot authenticate, every calendar match on
   Telegram will be classified and then refused with `UNKNOWN - refusing to write blind`.

3. **Give the classifier its key.** `~/.pi/jev-classifier/.env` must contain
   `TYPESAFE_API_KEY=…` (same key as the laptop; never printed):

   ```bash
   python3 ~/.pi/jev-classifier/jev-classifier-multi/src/classify.py --json "lunch at Cafe Nero on Friday at 1pm" | head -5
   ```

4. **Give the extractor its key.** The node reads `DEEPSEEK_API_KEY` from
   `~/.pi/agent/.env`.

5. **Register the extension in the home that owns the bridge.**

   - If the bridge runs in the CoS home on the VPS
     (`~/.pi/agent/cos-orchestrator-agent`), it is already listed in
     that home's `settings.json` after the pull; put `telegram.json` and
     `TELEGRAM_BOT_TOKEN` there, and stop any bridge in `~/.pi/agent`.
   - If the bridge stays in `~/.pi/agent`, add the extension by absolute path so its relative
     imports still resolve:

     ```json
     "extensions": ["+~/.pi/agent/cos-orchestrator-agent/extensions/calendar-node/index.ts"]
     ```

     The delivery module is resolved as
     `~/.pi/agent/cos-orchestrator-agent/npm/node_modules/@llblab/pi-telegram/dist/api/delivery.js`.
     If that path is absent, delivery fails **closed** and the turn falls back to a relay
     reply - nothing is lost, it just costs one model turn.

6. **Only one polling owner.** Never run a bridge against the same bot token twice. Move
   ownership, do not copy it.

## Verify

```bash
# 1. the node alone, no writes, no Telegram
cd ~/.pi/decision-nodes/calendar
./route.py --text "Lunch at Cafe Nero on Friday at 1pm" --dry-run

# 2. the read only (needs gog)
./route.py --text "Meeting with Pedro at the office on Monday 9 November at 09:30"

# 3. the whole thing: send one calendar sentence to the bot on Telegram and watch the air
#    Expected: one message with "created: …" and a link, and NO model turn in /usage.
tail -1 verdicts.jsonl | python3 -m json.tool
```

A correct Telegram run costs **no model tokens**: the trace and the outcome are sent by the
extension through the bridge's delivery API, and the input is swallowed.

## Failure modes, and what they look like

| Symptom on Telegram | Cause |
|---|---|
| reply appears, `/usage` shows a turn | delivery was refused → fallback relay (bridge not bound, target unauthorized, or the delivery module path is wrong) |
| `not created: the read failed … refusing to write blind` | `gog` missing or unauthenticated on the VPS |
| `not created: no definite date/time` | extraction ran but found no resolvable slot |
| nothing at all | the hook is off: `calendarNode.enabled` in `~/.pi/config.json`, or the extension is not registered in the bridge's home |
