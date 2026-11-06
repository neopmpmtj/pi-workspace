# Local AI on an RTX 3060 — Model Shortlist (Ollama)

_Researched 2026-11-04. Assumes RTX 3060 **12GB** (the common variant), Linux, Ollama 0.40.14+.
If yours is the 8GB 3060, use the "8GB fallback" column/notes — otherwise the same picks apply with lower quants/short context._

---

## TL;DR — what to install first

| Role | Model | Pull |
|---|---|---|
| Daily driver (read/summarize, vision) | **Gemma 4 12B** | `ollama pull gemma4:12b` |
| Fast + long context + Portuguese | **Qwen3.5 9B** | `ollama pull qwen3.5:9b` |
| Scanned PDFs / OCR / tables | **Qwen2.5-VL 7B** | `ollama pull qwen2.5vl:7b` |
| Heavy reasoning | **Phi-4 14B** or **DeepSeek-R1 14B** | `ollama pull phi4` / `ollama pull deepseek-r1:14b` |
| TTS (native Ollama) | **LFM3-Audio 2B** (Linux OK since v0.40.14) | `ollama pull lfm3-audio` |
| TTS (best quality, outside Ollama) | **Kokoro-82M** | Python/ONNX |
| Image generation (outside Ollama) | **FLUX.1 dev GGUF Q4/Q5** in ComfyUI | Hugging Face + ComfyUI |

> **Note:** All chat models in Ollama are already **instruction-tuned** ("instruct") by default. There is no separate "instruct" tag to hunt for.

---

## 1) Best LLMs that fit and run well

Sorted by usefulness for document reading/summarizing on a 12GB card.

| # | Model | Params | Download | VRAM (Q4/Q5) | Context | Vision | Notes |
|---|---|---|---|---|---|---|---|
| 1 | **Gemma 4 12B** | 12B dense | ~7.7–8.0 GB | ~10.0–10.4 GB @ 32K ctx (Q6_K) | 128K | ✅ | Best all-round 12GB pick. Strong DocVQA/OCR-ish skills, configurable thinking, 140+ languages. |
| 2 | **Qwen3.5 9B** | 9B | 6.6–7.6 GB | ~7–9 GB | 256K | ✅ | Fastest strong model (~50 tok/s on 3060), 201 languages — excellent Portuguese. Best for long documents if you keep ctx ≤16K. |
| 3 | **Qwen3 14B** | 14B | 9.3 GB | ~10–11 GB @ 8–16K ctx | 32K native (YaRN 131K) | ❌ | Previous gen but still very capable; good reasoning, mature tooling. |
| 4 | **Phi-4 14B** | 14B | ~9 GB | ~9–10 GB @ short ctx | 16K | ❌ | Dense reasoning, excellent at tight summaries and Q&A over text. Text-only. |
| 5 | **DeepSeek-R1 14B (distill)** | 14B | ~9 GB | ~9–10 GB | 64K+ | ❌ | Chain-of-thought reasoning; slower because it "thinks" first. Good for hard analysis, overkill for routine summaries. |
| 6 | **Mistral Nemo 12B** | 12B | ~7 GB | ~8 GB | 128K | ❌ | Solid multilingual, long context, permissive license. |
| 7 | **Llama 3.1 8B** | 8B | 4.9 GB | ~6 GB | 128K | ❌ | Boring, reliable baseline. Great if you want maximum speed/headroom. |
| 8 | **Qwen3.5 4B** | 4B | 3.3–4.0 GB | ~4–5 GB | 256K | ✅ | Speed/VRAM fallback; still surprisingly good for summaries. |

### Stretch / not recommended as daily driver
- **Qwen3.8 27B** — 18GB download; squeezes into 12GB only at IQ3_XS with ~8K context and zero margin. Vision ✅. Quality is a step up, speed is a step down.
- **gpt-oss 20B** — MoE, ~13GB at Q4; runs with partial CPU offload. Text only.
- **Mistral Small 3.2 24B** — ~14GB Q4; partial offload, slower. Good quality if you don't mind the spill.

### 8GB 3060 fallback
Use `gemma4:e4b`, `qwen3.5:4b`, or `qwen3.5:9b` at Q4 with 8K context. Skip 14B models.

---

## 2) Vision / document-understanding models (for scans, PDFs, charts)

| Model | Pull | Size | Why use it |
|---|---|---|---|
| **Gemma 4 12B** | `gemma4:12b` | ~8 GB | Best general vision+text combo; handles pages, diagrams, photos. |
| **Qwen3.5 9B** | `qwen3.5:9b` | 6.6–7.6 GB | Strong document/screenshot understanding, very fast. |
| **Qwen2.5-VL 7B** | `qwen2.5vl:7b` | 6.0 GB | Dedicated doc/chart/OCR model. Structured output (JSON), bounding boxes, invoice/table extraction. 125K ctx. |
| **DeepSeek-OCR 3B** | `deepseek-ocr` | ~3 GB | OCR specialist — converts pages/figures to clean markdown. Very token-efficient. |
| **Granite 3.2 Vision 2B** | `granite3.2-vision:2b` | ~2 GB | Tiny, purpose-built for tables/charts/infographics extraction. |
| **Llama 3.2 Vision 11B** | `llama3.2-vision:11b` | ~7.8 GB | Older but solid general image reasoning. |

**Recommended pipeline for scanned PDFs:** DeepSeek-OCR or Qwen2.5-VL to extract text/markdown → Gemma 4 12B or Qwen3.5 9B to summarize.

---

## 3) Text-to-speech (TTS)

### Ollama-native
| Model | Status | Size | Languages | License |
|---|---|---|---|---|
| **LFM3-Audio 2B** (`lfm3-audio`) | ✅ Linux + Windows since Ollama **v0.40.14** (3 Nov 2026) | ~1.5–2.4 GB | 18, incl. **Portuguese** | LFM Open License v1.0 |
| **Phonon** (`phonon`) | ⚠️ macOS only (Apple Silicon) | ~40M–small | EN/FR/DE/ES/PT | English Apache 2.0; others CC BY-NC 4.0 |

LFM3-Audio is an audio-in/audio-out model (STT + TTS + translation). TTS is exposed through the OpenAI-compatible `/v1/audio/speech` endpoint. Quality is good, not studio-grade.

### Better quality, outside Ollama (still fully local)
| Model | Size | VRAM | License | Notes |
|---|---|---|---|---|
| **Kokoro-82M** | 327 MB | ~1–2 GB (or CPU) | Apache 2.0 | Best quality/effort ratio. 54 voices, 8 languages. The default choice. |
| **Piper** | 63–137 MB/voice | CPU only | MIT voices / GPL code | Tiny, instant, robotic-ish. Great for notifications/assistants. |
| **XTTS-v2** | 1.87 GB | ~4–5 GB | CPML **non-commercial** | Voice cloning from ~6s of reference audio. |
| **F5-TTS** | ~300M | ~4–6 GB | CC-BY-NC | Best naturalness; non-commercial. |
| **Fish-Speech** | ~0.5–1B | ~5–8 GB | check repo | Strong cloning; heavier setup. |

**Recommendation:** Kokoro for narration/summaries read aloud; LFM3-Audio if you want one toolchain (Ollama) for everything; XTTS-v2 only for personal voice-cloning experiments.

---

## 4) Image generation

### Ollama reality check (Nov 2026)
- Ollama shipped experimental image generation on **macOS only** (Jan 2026), then **removed it in v0.32.6** (Aug 2026). It is still absent in v0.40.14.
- It **never worked on Linux or Windows**.
- The library still lists `x/z-image-turbo` and `x/flux2-klein`, but pulling them and running gives *"image generation models are not currently supported."*

**Verdict: do not use Ollama for images. Use ComfyUI** (same GPU, coexists fine with Ollama).

### ComfyUI models that fit 12GB
| Model | File size | Time/image on 3060 | License | Notes |
|---|---|---|---|---|
| **FLUX.1 dev GGUF Q4/Q5** | 6.8–12 GB | ~12–18 s @1024 | FLUX non-commercial (dev) | Best open quality; use Q5_K_S + FP8 T5 encoder for the sweet spot. |
| **FLUX.1 schnell FP8** | ~12 GB | ~2–3 s @1024, 4 steps | Apache 2.0 | Fast iteration, commercial-friendly. |
| **FLUX.2 Klein 4B FP8** | 9.5 GB | fast | Apache 2.0 | Newest small Flux; readable text, reference edits. |
| **SDXL 1.0** | 6.9 GB | ~6–8 s @1024 | OpenRAIL++ | Huge LoRA/ControlNet ecosystem; still the pragmatic daily driver. |
| **SD 3.5 Medium** | 9.9 GB + encoders | ~8–12 s | Stability Community (free under $1M revenue) | Good prompt adherence. |
| **Z-Image Turbo (6B)** | 13 GB FP8 | ~10–15 s | Apache 2.0 | Great photorealism + bilingual text, but tight on 12GB (offload needed). |

Install ComfyUI, download GGUF/FP8 checkpoints from Hugging Face, and keep Ollama running for text. They only compete for VRAM while both are loaded.

---

## 5) Practical setup tips for document work

1. **Raise Ollama's context** — default is 4K, too small for documents:
   ```bash
   export OLLAMA_CONTEXT_LENGTH=16384
   export OLLAMA_FLASH_ATTENTION=1
   export OLLAMA_KV_CACHE_TYPE=q8_0
   export OLLAMA_KEEP_ALIVE=30m
   ```
   Or per request: `"options": {"num_ctx": 16384}`.
2. **Verify full GPU offload:** `ollama ps` should show `100% GPU`; watch `nvidia-smi` during a run.
3. **Long PDFs:** extract text with `pdftotext` or PyMuPDF, chunk into 2–4K-token pieces, summarize each, then summarize the summaries (map-reduce). Don't dump a 200-page PDF into one prompt.
4. **RAG/embeddings:** `ollama pull nomic-embed-text` or `mxbai-embed-large` for semantic search over your documents.
5. **Quant choice:** Q4_K_M is the default; Q5_K_M/Q6_K if it fits with your context; Q8 only for small models.
6. **Model management:** `ollama list`, `ollama rm <model>`, `ollama show <model>`.

---

## Sources
- Ollama library pages: qwen3.5, gemma4, qwen3.8, deepseek-r1, qwen2.5vl, lfm3-audio, deepseek-ocr, granite3.2-vision
- Ollama blog: "Speech models in Ollama" (24 Oct 2026), "Image generation (experimental)" (20 Jan 2026), Ollama v0.40.14 release notes (3 Nov 2026)
- SpecPicks: "Best Local LLM for 12GB VRAM 2026", "Local TTS on RTX 3060 12GB", "Local image gen on RTX 3060"
- Aliteq: "Best local LLM for a 12GB GPU (Nov 2026)"
- VDF.ai: "Best Local Image Generation Models 2026"
- Local AI Master: Ollama image generation status (2 Nov 2026)
