# Ollama Stack — RTX 3060 12GB / Linux

One-shot installer for a local document-AI box: Ollama + GPU tuning + a
document-focused model set, plus a map-reduce summarizer for PDFs and text.

**Target:** Linux (Ubuntu/Debian/Fedora/Arch and similar), NVIDIA RTX 3060 12GB,
16GB+ system RAM, ~40GB free disk for the full optional set (~30GB for defaults).
The script is generic: any NVIDIA GPU with enough VRAM works.

---

## Quick start

```bash
# 1. Copy this folder to the target machine, then:
cd ollama-stack
chmod +x install-ollama-stack.sh summarize-doc.py

# 2. Dry run first (no changes):
bash install-ollama-stack.sh --dry-run

# 3. Install + pull models:
sudo bash install-ollama-stack.sh
```

When it finishes you'll have:

- Ollama installed and enabled as a systemd service
- Service tuned for a 12GB card (16K context, Flash Attention, q8_0 KV cache)
- These models pulled:
  - `gemma4:12b` — daily driver, vision, best all-round
  - `qwen3.5:9b` — fast, long context, excellent Portuguese
  - `qwen2.5vl:7b` — scanned docs / charts / OCR
  - `nomic-embed-text` — embeddings for RAG/search

Test:

```bash
ollama run gemma4:12b "Summarize the concept of photosynthesis in 3 bullets."
ollama ps          # should show 100% GPU
```

---

## Options

| Flag | Meaning |
|---|---|
| `--models "m1 m2"` | Replace the default model list |
| `--all` | Also pull `phi4`, `deepseek-r1:14b`, `llama3.1:8b`, `lfm3-audio` |
| `--tts` | Also pull `lfm3-audio` (Ollama-native TTS, 18 languages incl. PT) |
| `--no-tune` | Skip the systemd tuning drop-in |
| `--dry-run` | Print actions, change nothing |
| `--yes` | Non-interactive |
| `--log FILE` | Custom log path |

Examples:

```bash
sudo bash install-ollama-stack.sh --tts
sudo bash install-ollama-stack.sh --models "gemma4:12b qwen3.5:9b"
sudo bash install-ollama-stack.sh --all
```

Logs default to `./logs/install-ollama-<timestamp>.log`.

---

## What the tuning does

The installer writes `/etc/systemd/system/ollama.service.d/10-local-ai.conf`:

```ini
[Service]
Environment="OLLAMA_CONTEXT_LENGTH=16384"
Environment="OLLAMA_KEEP_ALIVE=30m"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
```

Why:

- **16K context** — Ollama's 4K default truncates real documents.
- **q8_0 KV cache** — roughly halves KV-cache VRAM vs f16, letting you keep 16K context on 12GB.
- **Flash Attention** — faster and lower memory on supported GPUs.
- **1 parallel / 1 loaded model** — prevents two models fighting over 12GB.

To change later, edit the drop-in and `sudo systemctl restart ollama`.

---

## Summarizing documents

`summarize-doc.py` extracts text, chunks it, summarizes each chunk, then combines
the results. It works with any Ollama model.

```bash
# Basic
./summarize-doc.py report.pdf

# Choose model + Portuguese output
./summarize-doc.py report.pdf -m qwen3.5:9b --lang pt

# Custom output + keep intermediate chunk summaries
./summarize-doc.py book.pdf -o book-summary.md --keep-chunks

# Plain text / markdown works too
./summarize-doc.py notes.md --lang en
```

Output defaults to `<input>.summary.md`, with a header recording model, language
and size. Progress and timing go to stderr; the summary file stays clean.

PDF extraction needs **poppler-utils** (`pdftotext`) or **pypdf**:

```bash
sudo apt install poppler-utils      # Debian/Ubuntu
sudo dnf install poppler-utils      # Fedora
pip install pypdf                   # fallback
```

For scanned PDFs (no text layer), OCR first:

```bash
sudo apt install ocrmypdf
ocrmypdf input.pdf output.pdf
./summarize-doc.py output.pdf
```

Or use the vision model directly:

```bash
ollama run qwen2.5vl:7b "Extract all text from this page as markdown: /path/page.png"
```

---

## Model notes

| Model | Pull | Size | Vision | Best for |
|---|---|---|---|---|
| Gemma 4 12B | `gemma4:12b` | ~8 GB | ✅ | Best all-round; summaries, Q&A, images |
| Qwen3.5 9B | `qwen3.5:9b` | 6.6–7.6 GB | ✅ | Speed, long docs, Portuguese |
| Qwen2.5-VL 7B | `qwen2.5vl:7b` | 6.0 GB | ✅ | Scans, tables, charts, OCR, JSON output |
| Phi-4 14B | `phi4` | ~9 GB | ❌ | Dense reasoning, tight summaries |
| DeepSeek-R1 14B | `deepseek-r1:14b` | ~9 GB | ❌ | Hard analysis (slower — thinks first) |
| Llama 3.1 8B | `llama3.1:8b` | 4.9 GB | ❌ | Fast, reliable baseline |
| LFM3-Audio 2B | `lfm3-audio` | ~2 GB | audio | TTS + STT, 18 languages, Linux OK |

> All Ollama chat models are instruction-tuned by default; there is no separate
> "instruct" tag.

### More models (not installed by default)

```bash
ollama pull qwen3:14b          # 9.3 GB, text-only, strong reasoning
ollama pull mistral-nemo       # ~7 GB, 128K context, multilingual
ollama pull deepseek-ocr       # ~3 GB, OCR specialist → markdown
ollama pull granite3.2-vision:2b  # ~2 GB, tables/charts extraction
```

---

## Troubleshooting

**`ollama ps` shows CPU instead of GPU**
- Check `nvidia-smi` works.
- Driver 525+ required; 550+ recommended.
- `journalctl -u ollama -n 100 --no-pager` for CUDA errors.
- If VRAM is tight, lower context: `OLLAMA_CONTEXT_LENGTH=8192`.

**Model loads but generation is very slow**
- It's spilling to CPU. Use a smaller quant/model or lower `num_ctx`.
- `nvidia-smi` during generation shows VRAM usage; if ~100%, that's the cause.

**API not reachable**
```bash
systemctl status ollama
curl http://127.0.0.1:11434/api/version
```

**Port already in use**
```bash
ss -ltnp | grep 11434
```

**Re-run tuning after editing the drop-in**
```bash
sudo systemctl daemon-reload && sudo systemctl restart ollama
```

---

## Security

- Ollama binds to `127.0.0.1:11434` by default. **Do not expose it to the LAN or
  internet** — it has no authentication.
- If you need remote access, put it behind an SSH tunnel or a reverse proxy with auth.
- Models are downloaded from ollama.com; the installer uses the official install script.

---

## Uninstall

```bash
sudo systemctl disable --now ollama
sudo rm -f /etc/systemd/system/ollama.service.d/10-local-ai.conf
sudo systemctl daemon-reload
sudo rm -f /usr/local/bin/ollama
sudo rm -rf /usr/share/ollama
sudo userdel ollama 2>/dev/null || true
```

(Remove only what you added; keep the drop-in's `.bak-*` if you want to restore
previous settings.)

---

## Files

```
ollama-stack/
├── install-ollama-stack.sh   # installer + tuner + verifier
├── summarize-doc.py          # map-reduce document summarizer
├── INSTALL.md                # this file
└── logs/                     # created on first run
```

Version 1.0.0 — 2026-11-04.
