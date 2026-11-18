# Runbook: Ollama + RTX 3060 on the LAN server (192.168.1.60)

Target: `pmpmt@192.168.1.60` (`pmpmt-B550-AORUS-ELITE-V2`, Ubuntu 24.04.4, kernel
`7.0.0-42-generic`, `GA106 [GeForce RTX 3060 Lite Hash Rate]`, 15 GB RAM, `pmpmt`'s home on
`/dev/nvme0n1p7` with 323 GB free).
Source kit: `docs/install-ollama-stack.sh`, `docs/summarize-doc.py`, `docs/INSTALL.md`,
`docs/rtx3060-local-ai-models.md`, `docs/ollama-stack-v1.0.0.tar.gz` — downloaded 2026-11-04 from
Drive `The Wall / RTX 3060 - Local LLM Setup (Ollama)` (folder ID `1XzE5MF6ZXD1TRnXn9SXCbBsenkBB4ccL`).

The kit itself contains **no host or IP reference** — it is generic ("any NVIDIA GPU with enough
VRAM"). The match to `.60` is by hardware: that box is the only machine here with an RTX 3060.

## Blocker found 2026-11-04 — FIXED 2026-11-04 06:03

```
nvidia-smi  → "couldn't communicate with the NVIDIA driver"
modinfo nvidia → ERROR: Module nvidia not found
journalctl -g nvidia → modprobe: FATAL: Module nvidia not found in /lib/modules/7.0.0-42-generic
```

- `nvidia-driver-570-open` (570.211.01) **is** installed (`dpkg -l`), Secure Boot is **disabled**.
- `dkms` is **not installed**, so no kernel module was ever (re)built for the running kernel.
- The kernel is `7.0.0-42-generic`; the driver's modules predate it.

Everything below installs fine without the driver, but every model would run on **CPU** (~1–2 tok/s
on a 12B model) instead of the GPU. Fix the driver first.

## Step 1 — driver — DONE 2026-11-04 06:03 (root via `pistore`'s NOPASSWD sudo)

Root cause: the only nvidia module package present was `linux-modules-nvidia-570-open-6.17.0-22-generic`,
built for kernel **6.17.0-22** while the box boots **7.0.0-42**; `dkms` was not installed, so nothing
rebuilt it. No prebuilt `linux-modules-nvidia-570-open-7.0.0-42-generic` exists in the archive.

What was run:

```bash
sudo apt-get update
sudo apt-get install -y dkms                                  # 3.0.11-1ubuntu13
sudo apt-get install -y nvidia-driver-595-open                # 595.99.02, pulls nvidia-dkms-595-open
sudo systemctl reboot
```

`nvidia-driver-570-open` was deliberately not reinstalled: its DKMS candidate is 570.86.10, older
than the installed 570.211.01 userspace, so module and library would mismatch. 595 is the series
`ubuntu-drivers devices` already recommended, and the swap removes the stale 570 libraries plus the
6.17.0-22 module packages (16 removed, 16 installed).

Result after reboot:

```
nvidia-smi → NVIDIA GeForce RTX 3060, 12288 MiB, driver 595.99.02, CUDA 13.2, compute 8.6
dkms status → nvidia/595.99.02, 7.0.0-42-generic, x86_64: installed
lsmod → nvidia, nvidia_modeset, nvidia_uvm, nvidia_drm  (all autoloaded at boot)
```

The module was also loaded live before rebooting (`modprobe nvidia`, `nvidia_uvm`), so the reboot
was not a shot in the dark. Secure Boot is disabled, so no MOK enrolment was needed.

Note for later: `apt` reported **145 packages not upgraded** during this work. Not touched —
unrelated to the driver, worth a separate maintenance window.

Original diagnosis, kept for reference:

## Step 2 — models on `/home` — DONE 2026-11-04

Ollama's default is `/usr/share/ollama/.ollama/models` on `/` (73 G, 30 G free after the driver work).
Weights now live on the data partition instead:

```bash
install -d -m 750 -o ollama -g ollama /home/models/ollama
systemctl stop ollama && cp -a /usr/share/ollama/.ollama/models/. /home/models/ollama/
chown -R ollama:ollama /home/models/ollama && rm -rf /usr/share/ollama/.ollama/models
cat > /etc/systemd/system/ollama.service.d/05-models-dir.conf <<'EOF'
[Service]
Environment="OLLAMA_MODELS=/home/models/ollama"
EOF
systemctl daemon-reload && systemctl start ollama
```

Both drop-ins are active and complementary: `05-models-dir.conf` (weights location) and
`10-local-ai.conf` (written by the kit: 16K ctx, Flash Attention, q8_0 KV, 1 parallel / 1 model).
Result: **20 GB of weights on `/home`, `/` untouched at 30 G free.**

## Step 3 — kit installed — DONE 2026-11-04 06:08–06:47

```bash
rsync -a docs/{install-ollama-stack.sh,summarize-doc.py,INSTALL.md,rtx3060-local-ai-models.md} \
  lan-pmpmt:~/ollama-stack/
ssh lan-storage "sudo -n bash -c 'cd /home/pmpmt/ollama-stack && bash install-ollama-stack.sh --yes --models \"nomic-embed-text\"'"
```

Install first with only the 274 MB embed model, so the weights directory could be moved to `/home`
before the 21 GB came down. Then the rest via `~/ollama-stack/pull-all.sh` (nohup, logs in
`~/ollama-stack/logs/pull.log`), ~9.5 MB/s throughout.

| Model | Size | Pulled |
| --- | ---: | --- |
| `gemma4:12b` | 8.0 GB | 06:22 |
| `qwen3.5:9b` | 6.6 GB | 06:35 |
| `qwen2.5vl:7b` | 6.0 GB | 06:47 |
| `nomic-embed-text` | 274 MB | 06:08 |

Ollama `0.40.14`, service `enabled`/`active`, API on `127.0.0.1:11434` only.

Measured on the card (warm):

| Model | Speed | Notes |
| --- | ---: | --- |
| `gemma4:12b` | ~49–65 tok/s | thinking model |
| `qwen3.5:9b` | ~55 tok/s | thinking model |
| `qwen2.5vl:7b` | ~14–26 tok/s | no thinking, direct answers |

`ollama ps` reports **100% GPU** and `CONTEXT 16384`; VRAM peaks around 8.9 GB of 12 GB.

### Two defects in the kit, both handled

1. **`summarize-doc.py` was broken for the two thinking models it ships with.** It read only
   `response`, so `gemma4:12b` and `qwen3.5:9b` burned the token budget inside the `thinking` field
   and returned an empty `response` → `RuntimeError: empty response from model`. Patched locally
   (`docs/summarize-doc.py`, pushed to the server): the request now sends `"think": false`, and if
   a model still returns only reasoning, the reasoning text is used rather than failing.
2. The kit's own smoke test requests a chat completion from `nomic-embed-text`, which is an
   embedding model, so the run always ends with `ERR Smoke test request failed`. Cosmetic: the model
   is present and lists correctly.

## Step 4 — document summariser — DONE 2026-11-04

`poppler-utils` was already installed (`pdftotext 24.02.0`). End-to-end test, chunk-and-combine over
a 39,549-character PDF:

```bash
ssh lan-pmpmt 'cd ~/ollama-stack && ./summarize-doc.py "$HOME/Downloads/Talus terms and conditions.pdf" \
  -m gemma4:12b --lang en'
# 4 chunks + combine, 59.2 s total → ~/Downloads/Talus terms and conditions.pdf.summary.md
```

The summary is coherent and correctly identifies the document as a TELUS International AI
contributor agreement, with key points and section structure.

## Still open

- Reach it from this laptop only through a tunnel: `ssh -L 11434:127.0.0.1:11434 lan-pmpmt`.
  Do not expose 11434 — Ollama has no authentication.
- `--all` extras (`phi4`, `deepseek-r1:14b`, `llama3.1:8b`, `lfm3-audio`, ~25 GB more) not pulled.
- 145 pending apt upgrades on the server, untouched.
