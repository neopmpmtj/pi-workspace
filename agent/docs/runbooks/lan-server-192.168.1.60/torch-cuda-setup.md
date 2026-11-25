# PyTorch + CUDA on the RTX 3060 — install and self-test

**Trigger:** jobs on the home server need `torch` with CUDA. On 2026-11-25 the box had the
driver but **no pip and no torch at all** (`ModuleNotFoundError: torch`, `No module named pip`).

**Status:** done and measured 2026-11-25 — `torch 2.6.0+cu124`, `cuda.is_available() = True`,
5.77 TFLOP/s sustained fp32 matmul on the RTX 3060.

---

## 1. What the box already had

| Item | Value |
| --- | --- |
| GPU | `NVIDIA GeForce RTX 3060`, 12288 MiB (8.6 / Ampere) |
| Driver | `595.99.02` — new enough for CUDA 12.x |
| `nvidia-smi` | works; 176 MiB used at idle |
| Python | 3.12.3 (Ubuntu 24.04, PEP 668 "externally managed") |
| `nvcc` | absent — **not needed**, the wheels carry their own CUDA runtime |
| Disk | 791 GB free on `/` |
| sudo | NOPASSWD for the agent |

## 2. Install (one venv, no system packages)

```bash
ssh home-server '
  sudo -n apt-get update -qq
  sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-venv python3-pip
  python3 -m venv ~/venvs/torch
  ~/venvs/torch/bin/pip install -q --upgrade pip
  ~/venvs/torch/bin/pip install -q torch --index-url https://download.pytorch.org/whl/cu124
  ~/venvs/torch/bin/pip install -q numpy
'
```

- `cu124` wheels = CUDA 12.4 runtime bundled. Any 12.x driver works (595.99 does).
- Venv lives at `~/venvs/torch`; always call `~/venvs/torch/bin/python`, never the system one.
- ~2.6 GB of site-packages; install took a few minutes on the LAN.

## 3. Self-test

```bash
ssh home-server '~/venvs/torch/bin/python - <<"PY"
import time, torch
print(torch.__version__, torch.version.cuda, torch.cuda.is_available())
print(torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))
n = 4096
a = torch.randn(n, n, device="cuda"); b = torch.randn(n, n, device="cuda")
torch.cuda.synchronize(); t0 = time.perf_counter()
for _ in range(10): c = a @ b
torch.cuda.synchronize(); dt = time.perf_counter() - t0
print(f"{10*2*n**3/dt/1e12:.2f} TFLOP/s")
PY'
```

Measured on 2026-11-25:

| Metric | Value |
| --- | --- |
| torch / CUDA | `2.6.0+cu124` / 12.4 |
| `cuda.is_available()` | `True` |
| 10 × 4096² fp32 matmul | 0.238 s → **5.77 TFLOP/s** |
| One 4096² fp32 matmul, CPU | 0.253 s (so the GPU wins by ~10× here) |
| VRAM used by the test | 200 MiB allocated, 278 MiB reserved |

## 4. Traps

| Symptom | Cause | Fix |
| --- | --- | --- |
| `No module named pip` | Ubuntu 24.04 ships pip out of the venv only | `apt install python3-venv python3-pip`, then create the venv |
| `externally-managed-environment` on `pip install` | PEP 668 | always use the venv, never `sudo pip` |
| `Failed to initialize NumPy` warning | numpy not in the venv | `~/venvs/torch/bin/pip install numpy` |
| `cuda.is_available()` false | a CPU-only wheel got installed | reinstall with `--index-url https://download.pytorch.org/whl/cu124` |
| `nvidia-smi` fine but torch fails | driver older than the wheel's CUDA major | install a `cu121`/`cu118` build instead |

## 5. Layout after install

```
~/venvs/torch/          # python + torch + numpy, per-user
~/venvs/torch/bin/python
```

No system-wide packages were added beyond `python3-venv`/`python3-pip`; nothing else changed.
Ollama keeps its own runtime and is unaffected.
