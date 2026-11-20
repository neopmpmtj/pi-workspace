# Local models on the RTX 3060 (Ollama)

Measured inventory of what this 12 GB card can actually run. Re-measure with the commands at
the bottom whenever a model is added; numbers here are from 2026-11-19, Ollama 0.40.14,
llamacpp runner.

## The card

| Fact | Value |
| --- | --- |
| GPU | NVIDIA GeForce RTX 3060 |
| VRAM | 12288 MiB (~11.9 GB usable, ~0.3 GB taken by the desktop) |
| Ollama weights | `/home/models/ollama` (279 GB free on `/home`) |

Rule of thumb: the model file plus KV cache must fit in ~11.5 GB. Ollama silently spills a
few percent to CPU (visible as `PROCESSOR 4%/96% CPU/GPU`) rather than failing, which costs
some speed — adjust `num_ctx` rather than accepting the split.

## Installed models

| Model | Size on disk | Typical resident | Notes |
| --- | --- | --- | --- |
| `deepseek-r1:14b` | 9.0 GB | 10 GB, 100% GPU @ 16k ctx | reasoning model: emits long thinking before answering |
| `deepseek-coder-v2:16b` | 8.9 GB | 10 GB, 100% GPU @ 8k ctx / 11 GB + 4% CPU spill @ 16k | MoE, ~2.4 B active → fast |
| `gemma4:12b` | 8.0 GB | ~9 GB | general chat |
| `qwen3.5:9b` | 6.6 GB | ~7.5 GB | general chat, comfortable headroom |
| `qwen2.5vl:7b` | 6.0 GB | ~7 GB | vision-language |
| `nomic-embed-text` | 0.3 GB | tiny | embeddings |

## Measured performance (2026-11-19)

| Model | Context | Loaded | GPU share | Throughput |
| --- | --- | --- | --- | --- |
| `deepseek-r1:14b` | 16384 | 10 GB | 100% GPU | ~34 tok/s |
| `deepseek-coder-v2:16b` | 16384 | 11 GB | 96% GPU / 4% CPU | ~90 tok/s |
| `deepseek-coder-v2:16b` | 8192 | 10 GB | 100% GPU | ~90 tok/s |
| `deepseek-coder-v2:16b` | 4096 | 9.5 GB | 100% GPU | ~90 tok/s |

Practical settings:

- **Coding:** `deepseek-coder-v2:16b` with `num_ctx` ≤ 8192 for a clean 100% GPU load. It is
  ~2.5× faster than the 14 B because only ~2.4 B parameters are active per token.
- **Reasoning:** `deepseek-r1:14b` at 16k is fine; give it a generous `num_predict`
  (≥ 300) or the budget is eaten by `<｜end▁of▁thinking｜>` tokens and the answer comes back
  empty. Ask for a direct answer if you want it short.
- **Do not plan on both at once** — 10 GB + 11 GB > 12 GB, so Ollama evicts one when the
  other loads. Sequential use only.

Not runnable here: `deepseek-r1:32b` (≈20 GB), `deepseek-v3`/`v3.1` (671 B MoE),
`deepseek-v2.5` (236 B). The 14 B/16 B DeepSeek builds are distilled/retuned models, not the
frontier mixture.

## Re-measure

```bash
ssh lan-pmpmt 'nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader'
ssh lan-pmpmt 'ollama list'
# load one and read the split + speed
ssh lan-pmpmt 'curl -s localhost:11434/api/generate -d "{\"model\":\"deepseek-coder-v2:16b\",\
\"prompt\":\"hi\",\"stream\":false,\"options\":{\"num_predict\":8,\"num_ctx\":8192}}" >/dev/null; ollama ps'
```
