# Venv for multiclass-hotword-cnn on the LAN server (192.168.1.60)

Set up 2026-11-09 by the CoS agent over `ssh lan-pmpmt`. Training box = the LAN server's
RTX 3060, **GPU route** (not the README's CPU route for laptops).

## Where things are

| Item | Path (on 192.168.1.60) |
| --- | --- |
| Clone root | `/home/pmpmt/python/multiclass-hotword-cnn` |
| Real project dir (has `requirements.txt`, `src/`, `config/`) | `/home/pmpmt/python/multiclass-hotword-cnn/multiclass-hotword-cnn` |
| Venv | `<project>/.venv` (5.6 G) |
| Setup script | `/home/pmpmt/python/setup-venv.sh` (re-runnable, idempotent) |
| Install log | `/home/pmpmt/python/venv-setup.log` |

The repo has a nested folder of the same name — the inner one is the project. `cd` there, not
to the clone root.

## Prerequisites (already present on the box)

`build-essential`, `portaudio19-dev`, `python3-dev` — needed so PyAudio compiles (no wheel).
No `pip` module on the system python (Ubuntu), so the venv supplies its own via `ensurepip`.

## Install

```bash
cd ~/python/multiclass-hotword-cnn/multiclass-hotword-cnn
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip wheel
.venv/bin/python -m pip install "torch>=2.0.0"     # default PyPI wheel = CUDA build
.venv/bin/python -m pip install -r requirements.txt
```

Or just re-run `~/python/setup-venv.sh` (nohup-able, ~7 min, mostly download).

Do **not** use `--index-url https://download.pytorch.org/whl/cpu` here: that is the laptop
route and would throw away the GPU. Do not pass `--upgrade` to the requirements install.

## Verify (what "done" means)

```bash
.venv/bin/python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
.venv/bin/python -c "import torch; a=torch.randn(1024,1024,device='cuda'); print((a@a).sum().item())"   # real kernel
PYTHONPATH=src .venv/bin/python -c "import hotword, onnxruntime, pyaudio; print('ok')"
PYTHONPATH=src .venv/bin/python -m hotword.cli.validate_config
```

Result on 2026-11-09: python 3.12.3, torch 2.15.0+cu132, cuda True, CUDA 13.2, cuDNN 92600,
driver 595.99.02, RTX 3060 12 GB, GPU matmul ok, all imports ok, `validate_config` clean
("Hey Jesse" / "go", 1200 ms @ 16 kHz, train on GPU).

Free space check before installing: `/home` 301 G free, `/` 31 G free. `.venv` is 5.6 G.

## Running

```bash
cd ~/python/multiclass-hotword-cnn/multiclass-hotword-cnn
source .venv/bin/activate
export PYTHONPATH=src
python -m hotword.cli.train
```

## Notes

- `prepare_data` downloads Google Speech Commands (~2 GB) into the project — check `/home`
  space (301 G free, fine).
- Inference on the Pi needs `requirements-infer.txt` only (no torch, no librosa).
- `lan-agent` cannot help with this tree: it is pinned to `remoteRoot=/home/pistore/storage`
  and runs as user `pistore`, which cannot read `/home/pmpmt`. Use `ssh lan-pmpmt`.
