# ComfyUI on the RTX 3060 — local image generation

**Trigger:** we need to create images, not just read them, and the cloud path costs money
(`gpt-image-*`). The home server has a 3060 and is free.

**Status:** live 2026-11-25 — ComfyUI user service on `127.0.0.1:8188`, Qwen-Image-2.1 turbo
int8 + SDXL-Turbo, first real images rendered and delivered over Telegram.

---

## 1. What is installed

| Piece | Path / value |
| --- | --- |
| ComfyUI | `~/ComfyUI` (git, `main`) + `custom_nodes/ComfyUI-GGUF` |
| Python | `~/venvs/comfy` (`torch 2.15.0+cu132`, CUDA ok) |
| Service | user unit `comfyui.service`, `WantedBy=default.target`, linger **on**, `Restart=on-failure` |
| Listen | `127.0.0.1:8188` — localhost only, never exposed |
| Output | `~/ComfyUI/output/` |

Models in `~/ComfyUI/models` (~20 GB):

| File | Size | Role |
| --- | --- | --- |
| `checkpoints/sd_xl_turbo_1.0_fp16.safetensors` | 6.9 GB | SDXL-Turbo, 4 steps, drafts |
| `diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors` | 7.3 GB | Qwen-Image-2.1 turbo, quality |
| `text_encoders/qwen3vl_8b_w4a8.safetensors` | 6.2 GB | its Qwen3-VL-8B text encoder |
| `vae/qwen_image_2.1_vae_bf16.safetensors` | 0.65 GB | its VAE |

## 2. Measured on this card (1024², single image)

| Model | Steps | Cold | Warm |
| --- | --- | --- | --- |
| SDXL-Turbo | 4 | 6–8 s | **1–3 s** |
| Qwen-Image-2.1 turbo int8 | 8 | 13–17 s | **10 s** |

Quality: Qwen-Image-2.1 is clearly the better image (photoreal, follows the prompt); SDXL-Turbo
is the fast drafting tool.

## 3. Use it

From the VPS (or any host with the repo):

```bash
~/.pi/agent/scripts/gpu-image.sh "a lighthouse on a cliff at dusk, photograph"
~/.pi/agent/scripts/gpu-image.sh --out ~/Pictures/fox.png --seed 42 "a red fox in snow"
echo "a vintage motorcycle in the rain" | ~/.pi/agent/scripts/gpu-image.sh -
```

The script ssh's to `desktop`, runs `~/ComfyUI/gen.py` (prompt on stdin), copies the PNG back
and prints its path. `GPU_IMAGE_HOST` overrides the target.

Directly on the server, with the API already running:

```bash
printf '%s' "a red fox in snow" | ~/venvs/comfy/bin/python ~/ComfyUI/gen.py --out /tmp/fox.png
```

## 4. The workflow (what the nodes must be)

Qwen-Image-2.1 is a 2026 architecture and has exact requirements:

- **UNETLoader** (not the GGUF loader) with `qwen_image_2.1_turbo_int8_convrot.safetensors`.
  The community `ComfyUI-GGUF` node rejects the Qwen-Image-2.1 GGUF builds with
  **"Unknown model architecture!"** — the int8_convrot safetensors is the supported path.
- **CLIPLoader** `type=qwen_image` with `qwen3vl_8b_w4a8.safetensors` (Qwen3-VL-8B, 8B).
- **TextEncodeQwenImage21** — it returns positive, negative **and the 64-channel latent**.
  Do not build an `EmptyLatentImage` (4ch) or `EmptySD3LatentImage` (16ch); only this node's
  third output has the right shape. It also accepts reference images for image-to-image.
- **VAELoader** `qwen_image_2.1_vae_bf16.safetensors`, then `UNETLoader` output → KSampler
  (euler/simple, 8 steps, cfg 1.0 for the turbo build) → VAEDecode → SaveImage.

SDXL-Turbo is the ordinary checkpoint graph: `CheckpointLoaderSimple` → `EmptyLatentImage`
1024² → KSampler 4 steps, cfg 1.0, euler_ancestral → VAEDecode.

## 5. Operate

```bash
systemctl --user status comfyui
journalctl --user -u comfyui -n 50 --no-pager
curl -s http://127.0.0.1:8188/system_stats | jq '.devices[0] | {name, vram_total, vram_free}'
systemctl --user restart comfyui
```

Reboot survival is through `loginctl enable-linger pmpmt` (done).

## 6. Traps seen

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Unknown model architecture!` | ComfyUI-GGUF has no Qwen-Image-2.1 loader yet | use `*_int8_convrot.safetensors` with `UNETLoader` |
| `git: command not found` | fresh Omarchy/Ubuntu install | `sudo apt install git` |
| process dies when the ssh session ends | started with `nohup … &` inside an ssh one-liner | run it as the `comfyui.service` user unit |
| CUDA OOM on a second model | both models resident | ComfyUI offloads automatically; let the first prompt load |
| `.config/systemd/user` missing | never created on this box | `mkdir -p ~/.config/systemd/user` before the first unit |

## 7. Bigger models (12 GB ceiling)

Qwen-Image-2.1 bf16 (14 GB transformer) and FLUX.1-dev (23.8 GB) do not fit; their GGUF Q4–Q8
builds do, but the loader must support the architecture. The int8 build above is the fastest
route to quality on this card.
