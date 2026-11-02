# image-describer cheatsheet

Agent home: `~/pi-agents-experts-grouped/image-describer/image-describer`. Launcher: `pi-image-describer` (loads only `~/pi-agents-experts-grouped/image-describer/.env`, then runs `pi`).

---

## Launcher

| Command | What it does |
| --- | --- |
| `pi-image-describer` | Interactive TUI (chat + slash commands). |
| `pi-image-describer -p "<slash command>"` | Run one slash command and exit (print mode). Paths in flags are relative to the directory you start from. Descriptions are not printed to the terminal in `-p` mode; each one is saved beside its image. Stdout gets the run line and the `Saved` paths (or the save or no-images line). A bad flag value or a per-image failure prints `[FAIL]` on stderr. |

Other `pi` flags pass through the launcher; this repo only documents `-p` for one-shot runs.

---

## TUI slash commands (this agent)

Only one custom slash command is registered:

```text
/describe-images <flags>
```

`/describe-images` does **not** start a chat model turn (`triggerTurn: false`). The first slash command in a new TUI session is also saved as the opening user message without calling the chat model.

### Flags

Every flag except `--help` needs a value. `--help` takes none, prints the flag list, and does not describe images or write settings.

| Flag | Required | Default | Purpose |
| --- | --- | --- | --- |
| `--help` | No | — | Print the flags and stop. No images, no vision API, no settings write. Other flags on the same line are ignored. |
| `--dir` | No* | `images-dir.json` | Parent folder for this run. Includes its files, and an immediate subfolder with fewer than two files. Omit to use the standing inbox. |
| `--set-default-image-describer-mode` | Yes* | — | Save default mode (`general`, `leisure`, `work`, `financial`, `venue`, `detailed`, `count`). No `--dir`, no images, no vision API. A misspelled mode prints `[FAIL]` and does not write `default-mode.json`. |
| `--set-default-image-describer-preset` | Yes* | — | Save the shared effort (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) for `general`, `leisure`, `work`, `financial`, and `venue`. Allowed only when the saved default is one of those. No images, no vision API. A misspelled level prints `[FAIL]` and does not write `preset-effort.json`. |
| `--set-default-image-describer-detailed` | Yes* | — | Save the detailed effort (same levels as preset). Allowed only when the saved default is already `detailed`. No images, no vision API. A misspelled level prints `[FAIL]` and does not write `detailed-effort.json`. |
| `--set-default-image-describer-count` | Yes* | — | Save the count effort (same levels as preset). Allowed only when the saved default is already `count`. No images, no vision API. A misspelled level prints `[FAIL]` and does not write `count-effort.json`. |
| `--set-default-image-describer-provider` | Yes* | — | Save the vision provider (`deepseek`, `openai`, `gemini`) and its model in `default-provider.json`. No images, no vision API. May be combined with `--set-default-image-describer-model`. A misspelled provider prints `[FAIL]` and does not write the file. |
| `--set-default-image-describer-model` | Yes* | — | Save the vision model (`deepseek-flash`, `gpt-6.1-sol`, `gemini-3.8-flash`) and its provider in `default-provider.json`. No images, no vision API. May be combined with `--set-default-image-describer-provider`. A misspelled model prints `[FAIL]` and does not write the file. |
| `--set-default-image-describer-language` | Yes* | — | Save the language name in `default-language.json`. No images, no vision API. A missing file means `English`. Empty text, a newline, or more than 80 characters prints `[FAIL]` and does not write the file. Do not combine it with the other save flags. |
| `--set-default-image-describer-images-dir` | Yes* | — | Save the standing inbox in `images-dir.json`. No images, no vision API. Relative paths resolve from cwd and are stored absolute. Path must exist and be a directory. Do not combine it with the other save flags. |
| `--model` | No | saved default, or `deepseek-flash` | `deepseek-flash`, `gpt-6.1-sol`, or `gemini-3.8-flash` for this run. Overrides `default-provider.json` and does not change it. |
| `--effort` | No | model-specific | `default`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. `general`, `leisure`, `work`, `financial`, and `venue` share `preset-effort.json` when that file exists; a missing file stays off on Deepseek and `default` on the other models. `detailed` uses `detailed-effort.json` or `medium`. `count` uses `count-effort.json` or `medium`. Deepseek sends `medium` as `high`. An explicit value always wins, including beside `--prompt`. `--prompt` ignores the saved effort files: with no `--effort`, `deepseek-flash` sends `none` and the other models use their documented default. |
| `--mode` | No | saved default | Preset for **this run only** (`general`, `leisure`, `work`, `financial`, `venue`, `detailed`, `count`). Ignored if `--prompt` is set. That run does not read `default-mode.json` either. |
| `--prompt` | No | built-in preset | Replace instruction for every image; metrics mode = `custom`. Ignores `--mode`, `default-mode.json`, `prompts.json`, and the saved effort files. With no `--effort`, `deepseek-flash` sends `none` (thinking off) and the other models use their documented default. `--effort` on the same command sets the level for that run. |
| `--language` | No | saved default, or `English` | Language in preset first sentence. Overrides `default-language.json` and does not change it. Ignored if `--prompt` is set. |
| `--timeout` | No | `120` | Seconds per image request. |
| `--log` | No | `./logs/metrics.sqlite` | Metrics DB path (relative to session cwd). |

\*A describe run needs `--dir` or a configured `images-dir.json`. A save run needs exactly one of `--set-default-image-describer-mode`, `--set-default-image-describer-preset`, `--set-default-image-describer-detailed`, `--set-default-image-describer-count`, `--set-default-image-describer-provider`, `--set-default-image-describer-model`, `--set-default-image-describer-language`, or `--set-default-image-describer-images-dir` (`--set-default-image-describer-provider` and `--set-default-image-describer-model` may be used together). Do not combine save flags across groups.

Use single or double quotes inside the flag value when needed (parser supports both).

### TUI examples

```text
/describe-images
/describe-images --help
/describe-images --dir ./photos --mode leisure
/describe-images --dir ./inbox --mode financial --model deepseek-flash
/describe-images --mode work --language Portuguese
/describe-images --model gpt-6.1-sol --effort high --timeout 180
/describe-images --prompt "Describe this image and transcribe its visible text."
/describe-images --prompt "List the colors." --effort high
/describe-images --log ./logs/custom.sqlite
/describe-images --set-default-image-describer-mode financial
/describe-images --set-default-image-describer-preset low
/describe-images --set-default-image-describer-detailed medium
/describe-images --set-default-image-describer-count medium
/describe-images --set-default-image-describer-language Portuguese
/describe-images --set-default-image-describer-images-dir ../images
```

### Modes (quick)

| Mode | Use for |
| --- | --- |
| `general` | Default sections (subject, composition, …). |
| `leisure` | Personal photos, diary-style. |
| `work` | Notices, workplace, slides; heavy transcription. |
| `financial` | Invoices, receipts, line items, totals. |
| `venue` | Calendar-style title, venue, date/time. |
| `detailed` | Exhaustive description. Uses the saved effort (`medium` by default) unless `--effort` is set. Deepseek sends `medium` as `high`. The Settings dropdown changes the saved level. |
| `count` | One count per recurring shape. If no kind was named, counts every recurring kind. Uses the saved effort (`medium` by default) unless `--effort` is set. Deepseek sends `medium` as `high`. The Settings dropdown changes the saved level. |

`--mode` = one run, and it is ignored when `--prompt` is set. That run does not read `default-mode.json`. With no `--effort`, `deepseek-flash` sends `none`; `--effort` on the same command sets the level. `--set-default-image-describer-mode` = persist in `default-mode.json` (same as dashboard Settings). `--set-default-image-describer-language` persists `default-language.json`; a missing file means `English`, and `--language` overrides it for one run. `--set-default-image-describer-images-dir` persists `images-dir.json`; omit `--dir` to use that inbox. `--set-default-image-describer-preset`, `--set-default-image-describer-detailed`, and `--set-default-image-describer-count` persist the three effort files. The preset flag is allowed only when the saved default is `general`, `leisure`, `work`, `financial`, or `venue`. The detailed flag is allowed only when it is `detailed`. The count flag is allowed only when it is `count`. Preset effort, detailed effort, and count effort are separate dropdowns, stored in `preset-effort.json`, `detailed-effort.json`, and `count-effort.json`. Exactly one dropdown is enabled: preset for the shared modes, detailed only for `detailed`, and count only for `count`.

---

## Shell one-shots (`-p`)

Same strings as in the TUI, wrapped for the launcher:

```bash
pi-image-describer -p "/describe-images"
pi-image-describer -p "/describe-images --mode financial"
pi-image-describer -p "/describe-images --dir ../images"
pi-image-describer -p "/describe-images --set-default-image-describer-mode leisure"
pi-image-describer -p "/describe-images --set-default-image-describer-preset low"
pi-image-describer -p "/describe-images --set-default-image-describer-detailed medium"
pi-image-describer -p "/describe-images --set-default-image-describer-count medium"
pi-image-describer -p "/describe-images --set-default-image-describer-language Portuguese"
pi-image-describer -p "/describe-images --set-default-image-describer-images-dir ../images"
```

Combine any valid flags in one `-p` string.

---

## Chat in the TUI (uses the chat model)

Natural language (“check for new images”, “describe the inbox”) uses tools, not slash commands:

| Tool | Role |
| --- | --- |
| `describe_images` | Same fields as `/describe-images` (`dir`, `model`, `effort`, `prompt`, `mode`, `setDefaultImageDescriberMode`, `setDefaultImageDescriberPreset`, `setDefaultImageDescriberDetailed`, `setDefaultImageDescriberCount`, `setDefaultImageDescriberProvider`, `setDefaultImageDescriberModel`, `setDefaultImageDescriberLanguage`, `setDefaultImageDescriberImagesDir`, `language`, `timeout`, `log`). Omit `dir` to use `images-dir.json`. |
| `read` | Single image already attached in chat. |
| `grep`, `find`, `ls` | Explore the workspace. |

No `bash`, `write`, or `edit` in this agent.

Changing mode, a saved effort, the saved vision provider, the saved language, or the images inbox via chat (`setDefaultImageDescriberMode`, `setDefaultImageDescriberPreset`, `setDefaultImageDescriberDetailed`, `setDefaultImageDescriberCount`, `setDefaultImageDescriberProvider`, `setDefaultImageDescriberModel`, `setDefaultImageDescriberLanguage`, or `setDefaultImageDescriberImagesDir`) still avoids vision calls but **does** use a chat turn. Prefer `/describe-images --set-default-image-describer-mode …` or `-p` for no chat LLM. A misspelled value, an invalid language, or a missing images directory is an error and does not write the file.

---

## Outputs and config files

| Path | Contents |
| --- | --- |
| `<image-folder>/<filename>.md` | Per-image description, beside that image. A folder with this second file is skipped on the next run. |
| `logs/metrics.sqlite` | One row per image (duration, tokens, mode, effort, language, status; not description text). |
| `logs/summaries.sqlite` | One row per image whose description opened with `## Summary`: that paragraph, the absolute image directory, the filename, the time, the mode, the language, the model, and the run id. |
| `~/pi-agents-experts-grouped/image-describer/image-describer/default-mode.json` | Which preset is default (exactly one `true`). |
| `~/pi-agents-experts-grouped/image-describer/image-describer/default-provider.json` | Saved vision provider and model. A missing file means `deepseek-flash`. |
| `~/pi-agents-experts-grouped/image-describer/image-describer/default-language.json` | Saved language name. A missing file means `English`. |
| `~/pi-agents-experts-grouped/image-describer/image-describer/images-dir.json` | Standing images inbox (`{ "dir": "/absolute/path" }`). External scripts read this file. A missing file requires `--dir`. |
| `~/pi-agents-experts-grouped/image-describer/image-describer/prompts.json` | Optional per-mode prompt overrides (dashboard or manual). |
| `~/pi-agents-experts-grouped/image-describer/image-describer/front-and-center.md` | Latest run that described images. Header has the run id, time, and absolute directory. Body is every success in that run. |
| `sessions/**/*.jsonl` | Session history (dashboard chat cost). |
| `~/pi-agents-experts-grouped/image-describer/model-rates.json` | USD rates per model with effective dates, written by an external service. Missing or malformed means the built-in rates. Template: `model-rates.example.json`. |

**Image types:** JPEG/JPG, PNG, WebP, GIF, TIFF, BMP, HEIC/HEIF (HEIC may fail decode locally). Oldest-first ordering. GIF/TIFF: first frame only.

**Env keys:** `DEEPSEEK_API_KEY` (default model); optional `OPENAI_API_KEY`, `GEMINI_API_KEY`.

---

## Dashboard (browser + local CLI)

**Run locally**

```bash
cd ~/pi-agents-experts-grouped/image-describer/image-describer && npm run dashboard          # API → 127.0.0.1:8788
cd ~/pi-agents-experts-grouped/image-describer/image-describer/dashboard && npm run dev      # UI → http://127.0.0.1:5173
```

**URLs**

| URL | View |
| --- | --- |
| `http://127.0.0.1:5173/#metrics` | Charts (image + chat). |
| `http://127.0.0.1:5173/#settings` | Mode (including language), model, and prompt sections. |

**Build static site**

```bash
cd ~/pi-agents-experts-grouped/image-describer/image-describer/dashboard && npm install && npm run build
```

**Useful env (API)**

```bash
DASHBOARD_HOST=...
DASHBOARD_PORT=...
DASHBOARD_ORIGIN=http://127.0.0.1:<vite-port>   # comma-separated; default includes 5173
DASHBOARD_ROOT=...                             # project root with logs
VITE_API_URL=http://127.0.0.1:8788             # for production build
```

**Restart API if port stuck**

```bash
fuser -k 8788/tcp && npm run dashboard
```

**HTTP API (optional `curl`)**

| Method | Path |
| --- | --- |
| GET | `/api/images`, `/api/chat`, `/api/events` |
| GET, PUT | `/api/default-mode` |
| GET, PUT | `/api/detailed-effort` (`PUT` body: `{"effort":"low"}`) |
| GET, PUT | `/api/count-effort` (`PUT` body: `{"effort":"low"}`; a missing file reads as `medium` and is not created) |
| GET, PUT | `/api/preset-effort` (`PUT` body: `{"effort":"high"}`; a missing file reads as `none` and is not created) |
| GET, PUT | `/api/default-provider` (`PUT` body: `{"provider":"openai"}`, `{"model":"gemini-3.8-flash"}`, or both when the model belongs to that provider. A missing file reads as `deepseek-flash` and is not created) |
| GET, PUT | `/api/default-language` (`PUT` body: `{"language":"Portuguese"}`. A missing file reads as `English` and is not created) |
| GET, PUT | `/api/images-dir` (`PUT` body: `{"dir":"/path/to/images"}`. A missing file reads as `{ "dir": null }` and is not created) |
| GET | `/api/prompts` |
| PUT, DELETE | `/api/prompts/<mode>` (`PUT` body: `{"prompt":"..."}`, max 4000 chars) |

---

## Project maintenance CLI

From `~/pi-agents-experts-grouped/image-describer/image-describer`:

```bash
npm install
npm test
npm run typecheck
npm run dashboard
```

---

## Mental model

```text
/describe-images                                          → use images-dir.json, vision API per file, no chat turn
/describe-images --dir ...                                → one-run override of the inbox
/describe-images --set-default-image-describer-mode       → write default-mode.json only, no vision, no chat turn
/describe-images --set-default-image-describer-preset     → write preset-effort.json only, when the default is general, leisure, work, financial, or venue
/describe-images --set-default-image-describer-detailed   → write detailed-effort.json only, when the default is already detailed
/describe-images --set-default-image-describer-count      → write count-effort.json only, when the default is already count
/describe-images --set-default-image-describer-images-dir → write images-dir.json only
A misspelled mode or effort                               → [FAIL] on stderr, session message, no file change
A conversion or request failure                           → [FAIL] on stderr, session message, no description file
pi-image-describer -p "..."                               → same as slash command, non-interactive
Chat + describe_images                                    → chat LLM + vision when describing a directory
Dashboard Settings                                        → same files as the save flags and prompts.json
```

Full detail: [README.md](../README.md). For another agent calling this one: [CALLING.md](CALLING.md).
