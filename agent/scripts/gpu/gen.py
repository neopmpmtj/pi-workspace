#!/usr/bin/env python3
"""gen.py — one image from the running ComfyUI on the home server.

    ~/venvs/comfy/bin/python ~/ComfyUI/gen.py --out /tmp/fox.png <<'EOF'
    a red fox in snow, photograph
    EOF

The prompt comes from stdin (no shell quoting traps). Uses Qwen-Image-2.1 turbo
int8 at 1024x1024, 8 steps, cfg 1.0 — the measured default on the RTX 3060.
Prints the absolute path of the PNG on success; non-zero exit on failure.
"""
import argparse
import json
import os
import random
import sys
import time
import urllib.request

HOST = "http://127.0.0.1:8188"

def post(prompt):
    data = json.dumps({"prompt": prompt, "client_id": "gen"}).encode()
    req = urllib.request.Request(HOST + "/prompt", data=data,
                                 headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=60))
    if "prompt_id" not in r:
        raise RuntimeError(f"ComfyUI rejected the workflow: {r}")
    return r["prompt_id"]

def wait(pid, timeout):
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = json.load(urllib.request.urlopen(HOST + "/history/" + pid, timeout=30))
        if pid in h:
            return h[pid]
        time.sleep(1)
    raise TimeoutError(f"prompt {pid} still running after {timeout}s")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="")
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--cfg", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--negative", default="blurry, low quality, watermark, text")
    ap.add_argument("--model", choices=["turbo", "base"], default="turbo")
    ap.add_argument("--timeout", type=int, default=600)
    a = ap.parse_args()

    prompt = sys.stdin.read().strip()
    if not prompt:
        sys.exit("gen.py: empty prompt on stdin")

    seed = a.seed if a.seed is not None else random.randint(1, 2**31 - 1)
    out = a.out or f"/tmp/gpu-image-{int(time.time())}.png"

    wf = {
      "1": {"class_type": "UNETLoader", "inputs": {
            "unet_name": ("qwen_image_2.1_turbo_int8_convrot.safetensors" if a.model == "turbo"
                          else "qwen_image_2.1_int8_convrot.safetensors"),
            "weight_dtype": "default"}},
      "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_8b_w4a8.safetensors", "type": "qwen_image", "device": "default"}},
      "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"}},
      "4": {"class_type": "TextEncodeQwenImage21", "inputs": {"clip": ["2", 0], "prompt": prompt, "negative_prompt": a.negative, "resolution": a.size}},
      "5": {"class_type": "KSampler", "inputs": {"seed": seed, "steps": a.steps, "cfg": a.cfg, "sampler_name": "euler",
            "scheduler": "simple", "denoise": 1.0, "model": ["1", 0], "positive": ["4", 0], "negative": ["4", 1], "latent_image": ["4", 2]}},
      "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["3", 0]}},
      "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": "gen"}},
    }

    t0 = time.time()
    hist = wait(post(wf), a.timeout)
    imgs = [i for o in hist.get("outputs", {}).values() for i in o.get("images", [])]
    if not imgs:
        sys.exit("gen.py: ComfyUI returned no image")
    src = os.path.join(os.path.expanduser("~/ComfyUI/output"), imgs[-1]["filename"])
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    os.replace(src, out)
    print(f"{os.path.abspath(out)}")
    print(f"seed={seed} time={time.time()-t0:.1f}s", file=sys.stderr)

if __name__ == "__main__":
    main()
