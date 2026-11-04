# input-path

Draws the path one message travels from the moment it is typed until it reaches the model —
including the classification stops that append the `inputContainsEmail` /
`inputContainsPath` / `inputContainsUrl` / `lessThanInputWords` blocks.

```
input-path/
├── input-path.py     # generator, Python 3 stdlib only
├── input-path.svg    # current trace for this agent home (generated)
└── README.md         # this file — the text version of the trace
```

The trace is **read from the live agent home**, not written from memory: `settings.json`
(which extensions load, in what order), `~/.pi/config.json` (which classifiers are enabled and
whether they print), and each extension's own source (which hooks it registers, whether it can
end the turn, which hidden block it attaches). Turn a classifier off in `config.json`, re-run,
and it is drawn switched off.

## The trace, in words

1. **Entry.** The text arrives as one string: a TUI keystroke, a `pi -p` prompt, or a Telegram
   message. Telegram messages carry a `[telegram…]` prefix, so later hooks can tell the
   surfaces apart.
2. **`input` dispatch** (pi core). Text starting with `/` is a command, not a turn. Other text
   is handed to every `input` handler **in `settings.json` load order**; each one answers
   `continue` or `handled`, and the first `handled` ends the path there.
3. **The input hooks, in order** — all five are enabled in `config.json` today:

   | Hook | Reads | Prints | Can end the turn |
   | --- | --- | --- | --- |
   | `calendar-router` | `calendarRouter` (`mode: route`) | trace lines | **yes** |
   | `input-contains-email` | `inputContainsEmail` | `true`/`false` | no |
   | `input-contains-path` | `inputContainsPath` | `true`/`false` | no |
   | `input-contains-url` | `inputContainsUrl` | `true`/`false` | no |
   | `less-than-input-words` | `lessThanInputWords` (`words: 6`) | `true`/`false` | no |

   Only `calendar-router` can stop the path: on a match it runs the `calendar` node, delivers
   the answer itself (stdout on local surfaces, the bridge's delivery API on Telegram), and
   returns `handled` — no model turn happens. If Telegram delivery fails it returns `continue`
   instead, and the turn survives.
4. **`before_agent_start`** — the second pass, same extensions again, in the same order:
   - `calendar-router` attaches its hidden block **only** when the input hook did not already
     answer (the delivery-failed case).
   - `input-contains-email`, `input-contains-path`, `input-contains-url`,
     `less-than-input-words` each attach a hidden message (`display: false`) whose text starts
     with the block label — that is the `inputContainsEmail …` footer visible at the end of a
     message.
   - `pi-prompt-capture` observes the base system prompt and writes a capture file; it mutates
     nothing.
5. **Prompt assembly** (pi core). System prompt + `AGENTS.md` + `APPEND_SYSTEM.md` + skill and
   subagent lists + the transcript + the hidden blocks **as messages**, not as prompt sections.
   That distinction is why the blocks appear after the user text rather than inside the prompt.
6. **`before_provider_request`.** `pi-prompt-capture` reads the fully assembled payload — the
   last point where the request can be observed before it leaves the machine.
7. **Model request** → `settings.json` `defaultProvider`/`defaultModel` (currently
   `deepseek/deepseek-flash`). This is where the message reaches the model, carrying the
   classification blocks.
8. **Return trip.** `tool_result` → `secret-scrubber` rewrites tool output (API keys, tokens)
   before it joins the transcript, so secrets never reach the provider. This happens after the
   first turn, on the way *back* in.

## Draw it

```bash
cd ~/.pi/apps-scripts/svg-scripts/input-path

python3 input-path.py                  # this agent home -> input-path.svg
python3 input-path.py --list           # print the stations, write nothing
python3 input-path.py --config ~/.pi/config.json
python3 input-path.py --agent-home ~/.pi/agent-web-master/web-master --out /tmp/web.svg
python3 input-path.py --out /tmp/path.svg
```

View it:

```bash
firefox ~/.pi/apps-scripts/svg-scripts/input-path/input-path.svg
```

## Reading the picture

| Mark | Meaning |
| --- | --- |
| Phase bands | `ENTRY` → `INPUT HOOKS` → `BEFORE_AGENT_START` → `REQUEST` → `RETURN TRIP` |
| Rail colour | the phase the station belongs to |
| Red left edge + `can end the turn` chip | returning `handled` there skips the model entirely |
| `adds <label>` chip | the hidden block that station attaches to the prompt |
| `enabled` / `off` chip | the state of that extension in `config.json` |

## Output checks run

- Canvas `1240 × 2048`, 17 stations: 2 entry, 5 input hooks, 6 `before_agent_start`, 3 request, 1 return trip.
- No out-of-bounds elements; legend sits 48 px below the last card (the first draft overlapped it
  because the canvas height was guessed from a hardcoded phase count — fixed with a real layout pass).
- Regeneration is md5-identical (`5f02ecb4…` twice).
- SVG is parsed with `xml.etree` before writing, so a malformed file never lands on disk.

No rasteriser is installed on this laptop (`rsvg-convert`, `inkscape`, `cairosvg` all absent), so
the picture is structure-validated, not eyeballed — open it once in Firefox.

## Not drawn

- `chat/index.ts` (`/ask`, `/usage`), `archive/`, `cron.ts`, `auto-sync.ts` register commands and
  session hooks only — they never touch the text on its way to a chat turn, so they do not
  appear as stations.
- What the four classifiers actually match (regexes, word counting) lives in `src/` and is out
  of scope here.
