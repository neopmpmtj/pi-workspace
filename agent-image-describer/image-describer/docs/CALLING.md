# image-describer: calling contract

For another agent calling this one from the shell. Human reference: [CHEATSHEET.md](CHEATSHEET.md).

## Default call

```bash
cd ~/.pi/agent-image-describer/image-describer && pi-image-describer -p "/describe-images"
cd ~/.pi/agent-image-describer/image-describer && pi-image-describer -p "/describe-images --dir <absolute path>"
```

- Always send a slash command. Natural language starts this agent's chat model, which sends its whole prompt as a new session; the slash command does not start a chat turn.
- Run from the agent home: `logs/metrics.sqlite` and the session folder are relative to the working directory.
- Omit `--dir` to process the whole inbox (`images-dir.json`, currently `~/.pi/agent-image-describer/images`).
- Inbox layout: one UUID-named subfolder per image. A subfolder with two or more files, or an image that already has `<image>.md` beside it, is skipped.

<!-- BEGIN GENERATED: commands -->
<!-- Written by scripts/publish.ts. Change the extension code, then run npm run publish:agent. -->

## Slash commands

### /describe-images

Describe images in a directory and in immediate subfolders with fewer than two files

```text
/describe-images [--dir PATH] [--mode MODE] [--effort LEVEL] [--model ID] [--prompt TEXT] [--language NAME] [--timeout SECONDS] [--log PATH]
/describe-images --set-default-image-describer-mode MODE | --set-default-image-describer-preset LEVEL | --set-default-image-describer-detailed LEVEL | --set-default-image-describer-count LEVEL | --set-default-image-describer-provider ID | --set-default-image-describer-model ID | --set-default-image-describer-language NAME | --set-default-image-describer-images-dir PATH
/describe-images --help

Prints this text and does not describe images or write settings. Omit --dir to use images-dir.json.

--dir PATH                                     This run only. Omit to use images-dir.json.
--mode MODE                                    general, leisure, work, financial, venue, detailed, or count. This run only.
--effort LEVEL                                 default, none, minimal, low, medium, high, xhigh, or max. This run only.
--model ID                                     deepseek-flash, gpt-6.1-sol, or gemini-3.8-flash. This run only.
--prompt TEXT                                  Replace the instruction for every image. Ignores --mode.
--language NAME                                Language for this run. Ignored when --prompt is set.
--timeout SECONDS                              Seconds per image. Default 120.
--log PATH                                     Metrics database. Default ./logs/metrics.sqlite.
--set-default-image-describer-mode MODE        Save the default mode. Does not describe images.
--set-default-image-describer-preset LEVEL     Save the shared effort for general, leisure, work, financial, and venue.
--set-default-image-describer-detailed LEVEL   Save the detailed effort. Only when the default mode is detailed.
--set-default-image-describer-count LEVEL      Save the count effort. Only when the default mode is count.
--set-default-image-describer-provider ID      Save the vision provider: deepseek, openai, or gemini.
--set-default-image-describer-model ID         Save the vision model. May be combined with --set-default-image-describer-provider.
--set-default-image-describer-language NAME    Save the default language.
--set-default-image-describer-images-dir PATH  Save the standing inbox. The path must already be a directory.

A save does not describe images. Do not combine save flags, except --set-default-image-describer-provider with --set-default-image-describer-model.
```

## Tools (chat model only)

### describe_images

Describe eligible images in a directory and in immediate subfolders that contain fewer than two files, one request per file, oldest first. Skips a subfolder that already has two or more files, and skips a file whose description is already beside it. Returns filename-labelled descriptions. Does not describe images already attached to the conversation.

- `dir`: Parent directory for this run only. Includes files directly inside it, and images in an immediate subfolder with fewer than two files. A subfolder with two or more files is skipped. Omit to use the path in images-dir.json. Required only when that file is missing, unless a save field is set.
- `model`: Model id for this run. Overrides the saved default. Default deepseek-flash when no default is saved. Also gpt-6.1-sol or gemini-3.8-flash.
- `effort`: default, none, minimal, low, medium, high, xhigh, or max. When omitted, general, leisure, work, financial, and venue use the saved preset effort if preset-effort.json exists; otherwise deepseek-flash sends none (thinking off) and other models omit the override. detailed uses its own saved level, medium until its settings dropdown changes it. count does the same with count-effort.json. Deepseek sends medium as high. An explicit effort overrides the saved level for one run. A custom prompt ignores every saved level.
- `prompt`: Replacement instruction used for every image in the run.
- `mode`: Preset for this run: general, leisure, work, financial, venue, detailed, or count. detailed is an exhaustive description and uses its saved effort (medium by default) unless effort is set. count singles out each recurring shape and gives its count, and uses its own saved effort (medium by default) unless effort is set. The other presets share one saved effort when preset-effort.json exists. Overrides the saved default and does not change it. Ignored when prompt is set.
- `setDefaultImageDescriberMode`: Save this mode as the default for later runs. Exactly one mode stays on. Does not describe images. Do not combine with setDefaultImageDescriberPreset, setDefaultImageDescriberDetailed, setDefaultImageDescriberCount, setDefaultImageDescriberProvider, setDefaultImageDescriberModel, setDefaultImageDescriberLanguage, or setDefaultImageDescriberImagesDir.
- `setDefaultImageDescriberPreset`: Save the shared effort for general, leisure, work, financial, and venue. Allowed only when the saved default is one of those modes. Does not describe images. none, minimal, low, medium, high, xhigh, or max.
- `setDefaultImageDescriberDetailed`: Save the detailed-mode effort. Allowed only when the saved default mode is already detailed. Does not describe images. none, minimal, low, medium, high, xhigh, or max.
- `setDefaultImageDescriberCount`: Save the count-mode effort. Allowed only when the saved default mode is already count. Does not describe images. none, minimal, low, medium, high, xhigh, or max.
- `setDefaultImageDescriberProvider`: Save the default vision provider and its model. deepseek, openai, or gemini. Does not describe images. May be combined with setDefaultImageDescriberModel when that model belongs to the provider. Do not combine with setDefaultImageDescriberMode, setDefaultImageDescriberPreset, setDefaultImageDescriberDetailed, setDefaultImageDescriberCount, setDefaultImageDescriberLanguage, or setDefaultImageDescriberImagesDir.
- `setDefaultImageDescriberModel`: Save the default vision model and the provider that owns it. deepseek-flash, gpt-6.1-sol, or gemini-3.8-flash. Does not describe images. May be combined with setDefaultImageDescriberProvider when the model belongs to that provider. Do not combine with setDefaultImageDescriberMode, setDefaultImageDescriberPreset, setDefaultImageDescriberDetailed, setDefaultImageDescriberCount, setDefaultImageDescriberLanguage, or setDefaultImageDescriberImagesDir.
- `setDefaultImageDescriberLanguage`: Save this language name as the default for later runs that omit language. Does not describe images. A missing save still uses English. language on a describe run overrides the save for that run and does not write it. Do not combine with setDefaultImageDescriberMode, setDefaultImageDescriberPreset, setDefaultImageDescriberDetailed, setDefaultImageDescriberCount, setDefaultImageDescriberProvider, setDefaultImageDescriberModel, or setDefaultImageDescriberImagesDir.
- `setDefaultImageDescriberImagesDir`: Save this directory as the standing inbox in images-dir.json. Does not describe images. Later runs that omit dir use this path. Relative paths resolve from the session working directory and are stored absolute. The path must already exist and be a directory. Do not combine with setDefaultImageDescriberMode, setDefaultImageDescriberPreset, setDefaultImageDescriberDetailed, setDefaultImageDescriberCount, setDefaultImageDescriberProvider, setDefaultImageDescriberModel, or setDefaultImageDescriberLanguage.
- `language`: Language name for this run. Overrides the saved default and does not change it. Default English when no default is saved. Ignored when prompt is set.
- `timeout`: Seconds per image request. Default 120.
- `log`: Metrics database path. Default ./logs/metrics.sqlite under the working directory.

<!-- END GENERATED: commands -->

Save flags write a settings file and make no vision call. Use them only when the user asks to change a standing default.

## Output

- stdout: `Run <id>: N succeeded, N failed, N unprocessed.`, then one `Saved <path>.` line per file written (the run log under `logs/descriptions/`, then each `<image>.md`). Paths are relative to the working directory. Descriptions are not printed.
- stdout with nothing to do: `No eligible images in <dir>.` A save flag prints its `Saved ...` line.
- stderr: `[FAIL] <reason>` for a bad flag, a missing key, or a per-image failure. No `[FAIL]` line means no failure.

## Reading results

- Latest run, every success: `~/.pi/agent-image-describer/image-describer/front-and-center.md`.
- One image: `<image>.md` beside the image.
- Read these only when the user asks about the content. Do not open the image itself.
