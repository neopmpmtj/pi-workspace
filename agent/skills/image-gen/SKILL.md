---
name: image-gen
description: Generate images on the home server's RTX 3060 through ComfyUI (Qwen-Image-2.1 base/turbo, SDXL-Turbo) with three modes — quick, medium (default), max — exact output sizes, a measured generation time in the reply, and a local run log. Use whenever the user asks to create, generate, draw, make or render an image, picture, photo, illustration, icon or logo. Never uses a paid cloud image API unless the user explicitly asks for one.
---

# Image generation — home server RTX 3060

All images come from **this repo's script**, which talks to ComfyUI on the home server
(`desktop` = `192.168.1.60`). Nothing is sent to a cloud provider; nothing costs money.

```bash
~/.pi/agent/scripts/gpu-image.sh "prompt"                 # medium, the default
~/.pi/agent/scripts/gpu-image.sh --out /tmp/x.png "prompt"
~/.pi/agent/scripts/gpu-image.sh --mode max "prompt"
~/.pi/agent/scripts/gpu-image.sh --mode quick --size 600 "prompt"
```

The script prints the PNG path on stdout and one summary line on stderr:

```
gpu-image: mode=medium model=base render=1024 output=600 time=54.1s seed=580732655 path=/tmp/x.png
```

## Modes — pick from the words the user used

| Mode | Model | Render | Steps | Time on the 3060 | When |
| --- | --- | --- | --- | --- | --- |
| `quick` | SDXL-Turbo | 1024² | 4 | **3–7 s** | "quick", "draft", "sketch", fast iteration |
| `medium` | Qwen-Image-2.1 **base** int8 | 1024² | 20 | **45–60 s** | default: no mode mentioned |
| `max` | Qwen-Image-2.1 **base** int8 | 2048² | 30 | **9 min** | "max", "spectacular", "best quality", "make the GPU work", "fans" |

Rules:

- **No mode in the request → `medium`.** Never ask which mode; medium is the answer.
- More than one keyword? Take the highest (`max` > `medium` > `quick`).
- Do not invent new modes. `--steps/--cfg/--size` overrides exist but only use them when the
  user asks for a specific number.

## Size

- Default deliverable: the mode's render size (1024² for quick/medium, 2048² for max).
- "600", "600x600", "make it 800 pixels": pass `--size 600`. The render stays at the mode size
  when the request is smaller and the image is downsampled with Lanczos — that keeps it crisp.
  A request **larger** than the mode render raises the render size.
- Non-square requests are **not** supported by this pipeline; deliver the nearest square and
  say so in one clause.

## What to do, in order

1. Understand the subject. If the request is one word ("a honeybee"), add only neutral craft
   words: `macro photograph`, `traditional illustration`, `3D render`, soft studio light,
   plain light background — whichever fits the subject. Never change what was asked.
2. Run the script with the chosen mode and size. One image per request unless the user asks
   for several.
3. **Look at the PNG yourself** (`read` on the path). If it is broken (two heads, text garbage,
   empty frame), regenerate once with a changed seed before delivering.
4. Attach the PNG with `telegram_attach`, then write one short message.
5. Keep the master file and quote its path.

## The reply — always these facts

One line, then the file:

> **54 s** on the 3060 · Qwen-Image-2.1 base · 1024² render → 600² · seed 580732655
> master: `/tmp/x.png`

- The seconds come from the script's `time=` field — never invent or round them away.
- Tokens: image generation uses **zero model tokens** (ComfyUI runs on the GPU, not through the
  API). Only if the user asks for the token cost of the *conversation turn*, read it from
  `~/.pi/agent/logs/ledger.sqlite` (`calls` table) and report it separately, labelled as turn
  tokens, never mixed with the generation time.
- Every run is appended to `~/.pi/agent/logs/image-runs.jsonl` by the script (mode, model, sizes,
  steps, cfg, seconds, seed, path). Check it when the user asks what was generated before.

## Changing an image that already exists

Three different tools; picking the wrong one is why an "edit" comes back as a different picture.
All three are measured on the bee from 2026-11-25.

1. **img2img — the default for a slight change.** Keeps pose, framing and background; changes
   only what the prompt names.

   ```bash
   ~/.pi/agent/scripts/gpu-image.sh --from /path/to/source.png --denoise 0.45 \
       "the same honeybee with iridescent blue wings"
   ```

   - `0.30–0.40`: colour, texture, light. `0.45–0.55`: a clear change to one element.
     `0.65+`: composition starts to move; that is a remix, not an edit.
   - 20 steps, cfg 3.5, base model; ~17 s for a 600² source.
   - Output size follows the source (rounded down to a multiple of 16, e.g. 600 → 592).

2. **Inpaint — for one region** (remove an object, add a hat). Needs a mask, so ask the user to
   mark it, or derive a rough mask from a bounding box. Not wired into `gpu-image.sh` yet; say so
   rather than pretending.

3. **Qwen-Image-2.1 reference mode — for "same subject, new scene".** `--edit` splices the source
   into the DiT as a vision reference; it follows the instruction strongly but **re-synthesises
   pose and background** (measured: a perched bee became a bee on a yellow flower). Use only when
   the user wants the subject kept and the scene changed.

Rules:

- **Seed reuse does not make an edit.** Same seed + changed prompt = a new image; it only
  reproduces an image from an identical prompt on the same model build.
- Keep the source file path in the reply and the run log; "make its wings blue" refers to the
  last delivered master unless the user names another file.
- Deliver the edited image and state the technique: `edited img2img, denoise 0.45, 17 s,
  from /tmp/m1.png`. Never imply it is a fresh generation.
- If the user gives no source and asks for a change, use the most recent image from
  `~/.pi/agent/logs/image-runs.jsonl`.

## When it fails

- The script exits 2 with a reason. Report it plainly: server unreachable, ComfyUI down, model
  missing, prompt rejected.
- Try once more (transient CUDA/queue errors happen). Then stop.
- **Never** fall back to OpenAI `gpt-image-*`, Gemini, or any paid API unless the user explicitly
  names that provider.
- Diagnose with `ssh desktop 'systemctl --user status comfyui; journalctl --user -u comfyui -n 30'`.

## Prompt craft that works with this model

- Photorealism: name the medium ("macro photograph", "35mm", "studio softbox"), the background
  ("plain light cream"), and detail ("every hair visible, translucent wings").
- Illustrations: name the style ("flat vector", "watercolour", "woodcut") — Qwen respects it.
- Put composition before details: subject → action/pose → setting → light → quality words.
- Negative prompt stays default (`blurry, low quality, watermark, text`) unless asked.

## Do not

- Do not call `sha`/other CLIs or upload to cloud storage; the image is delivered from this host.
- Do not run `pip install` or change models mid-request.
- Do not add the image to git, the inbox, or any docs unless the user asks.
