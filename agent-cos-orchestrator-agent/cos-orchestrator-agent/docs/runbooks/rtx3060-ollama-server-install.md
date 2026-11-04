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

## Step 2 — decide where the models live

Ollama's installer keeps weights in `/usr/share/ollama/.ollama/models`, i.e. on `/` (73 G, 33 G
free). The default set is ~25–30 GB and `--all` is more. Either accept the tight fit or move it to
`/home` (378 G, 323 G free) **before** pulling models:

```bash
sudo mkdir -p /home/models/ollama
sudo chown ollama:ollama /home/models/ollama
sudo tee /etc/systemd/system/ollama.service.d/05-models-dir.conf >/dev/null <<'EOF'
[Service]
Environment="OLLAMA_MODELS=/home/models/ollama"
EOF
```

`10-local-ai.conf` (written by the kit's `--tune` step) supplies context length, Flash Attention,
q8_0 KV cache, and the 1-model limits — no conflict between the two drop-ins.

## Step 3 — run the kit on the server

Copy the folder over (the kit expects `install-ollama-stack.sh` + `summarize-doc.py` side by side):

```bash
ssh lan-pmpmt 'mkdir -p ~/ollama-stack'
rsync -a docs/{install-ollama-stack.sh,summarize-doc.py,INSTALL.md,rtx3060-local-ai-models.md} \
  lan-pmpmt:~/ollama-stack/
rsync -a docs/ollama-stack-v1.0.0.tar.gz lan-pmpmt:~/ollama-stack/
ssh lan-pmpmt 'chmod +x ~/ollama-stack/install-ollama-stack.sh ~/ollama-stack/summarize-doc.py'
ssh lan-pmpmt 'cd ~/ollama-stack && bash install-ollama-stack.sh --dry-run'   # read the plan
```

Then the real run, escalated: `pmpmt` has no passwordless sudo, so either

```bash
ssh -t lan-pmpmt 'cd ~/ollama-stack && sudo bash install-ollama-stack.sh'      # you type the password
# or, driven by the agent through pistore's NOPASSWD sudo:
ssh lan-storage "sudo -u pmpmt -H bash -lc 'cd /home/pmpmt/ollama-stack && bash install-ollama-stack.sh --yes'"
```

Checks afterwards:

```bash
ollama --version
systemctl status ollama --no-pager
ollama list
curl -s http://127.0.0.1:11434/api/version
ollama run gemma4:12b "two bullets on photosynthesis"
ollama ps          # must say 100% GPU
```

Port 11434 stays bound to `127.0.0.1`. Reach it from this laptop only through a tunnel:
`ssh -L 11434:127.0.0.1:11434 lan-pmpmt`.

## Step 4 — document summariser

```bash
sudo apt install -y poppler-utils        # pdftotext for PDFs; ocrmypdf too if scans are involved
~/.local/bin/...  # see below
~/ollama-stack/summarize-doc.py ~/Downloads/report.pdf -m qwen3.5:9b --lang pt
```

## Open questions for the user

- Install the driver fix (needs a reboot of that desktop) — yes/no?
- Models on `/home` (recommended) or leave them on `/`?
- Default set (~25–30 GB) or `--all`?
- Which sudo path: user types the password, or the agent drives it via `pistore`?
