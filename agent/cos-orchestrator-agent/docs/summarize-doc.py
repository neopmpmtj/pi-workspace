#!/usr/bin/env python3
"""
summarize-doc.py — local document summarizer for Ollama.

Extracts text from a PDF/TXT/MD file, splits it into chunks, summarizes each
chunk with a local Ollama model (map), then combines the chunk summaries into
one final summary (reduce). Stdlib only; PDF extraction needs either
`pdftotext` (poppler-utils) or the `pypdf` package.

Part of the ollama-stack bundle. See INSTALL.md.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Iterable

VERSION = "1.0.0"
DEFAULT_API = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
if not DEFAULT_API.startswith("http"):
    DEFAULT_API = f"http://{DEFAULT_API}"
DEFAULT_MODEL = "gemma4:12b"


# --------------------------------------------------------------------------- #
# Logging
# --------------------------------------------------------------------------- #
def ts() -> str:
    return time.strftime("%H:%M:%S")


def log(msg: str) -> None:
    print(f"[{ts()}] {msg}", file=sys.stderr, flush=True)


def die(msg: str, code: int = 1) -> "NoReturn":
    print(f"[{ts()}] ERROR: {msg}", file=sys.stderr, flush=True)
    raise SystemExit(code)


# --------------------------------------------------------------------------- #
# Text extraction
# --------------------------------------------------------------------------- #
def extract_pdf(path: Path) -> str:
    """Extract text from a PDF using pdftotext, falling back to pypdf."""
    if shutil.which("pdftotext"):
        try:
            out = subprocess.run(
                ["pdftotext", "-layout", "-enc", "UTF-8", str(path), "-"],
                capture_output=True,
                text=True,
                timeout=180,
                check=False,
            )
            if out.returncode == 0 and out.stdout.strip():
                return out.stdout
            log(f"pdftotext returned {out.returncode}; trying pypdf")
        except Exception as exc:  # noqa: BLE001 - keep going to fallback
            log(f"pdftotext failed ({exc}); trying pypdf")

    try:
        from pypdf import PdfReader  # type: ignore
    except Exception:  # noqa: BLE001
        die(
            "PDF extraction needs 'pdftotext' (install poppler-utils) or pypdf "
            "(pip install pypdf). Neither is available."
        )

    try:
        reader = PdfReader(str(path))
        pages = []
        for i, page in enumerate(reader.pages, 1):
            try:
                pages.append(page.extract_text() or "")
            except Exception as exc:  # noqa: BLE001
                log(f"WARN: page {i} failed to extract: {exc}")
        text = "\n\n".join(pages)
    except Exception as exc:  # noqa: BLE001
        die(f"Failed to read PDF: {exc}")

    if not text.strip():
        die("PDF contains no extractable text (likely a scanned document). "
            "Run OCR first (e.g. ocrmypdf) or use a vision model.")
    return text


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return extract_pdf(path)
    if suffix in {".txt", ".md", ".markdown", ".rst", ".csv", ".log", ".json"}:
        for enc in ("utf-8", "utf-8-sig", "latin-1"):
            try:
                return path.read_text(encoding=enc)
            except UnicodeDecodeError:
                continue
            except Exception as exc:  # noqa: BLE001
                die(f"Failed to read {path}: {exc}")
        die(f"Could not decode {path} as text")
    die(f"Unsupported file type '{suffix}'. Use PDF, TXT, MD, RST, CSV, JSON or LOG.")


def clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# --------------------------------------------------------------------------- #
# Chunking
# --------------------------------------------------------------------------- #
def chunk_text(text: str, max_chars: int) -> list[str]:
    """Split on paragraph boundaries, then hard-split any oversized paragraph."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    buf: list[str] = []
    size = 0

    def flush() -> None:
        nonlocal buf, size
        if buf:
            chunks.append("\n\n".join(buf).strip())
            buf, size = [], 0

    for para in paragraphs:
        if len(para) > max_chars:
            flush()
            for i in range(0, len(para), max_chars):
                chunks.append(para[i : i + max_chars])
            continue
        if size + len(para) + 2 > max_chars:
            flush()
        buf.append(para)
        size += len(para) + 2

    flush()
    return [c for c in chunks if c.strip()]


# --------------------------------------------------------------------------- #
# Ollama client
# --------------------------------------------------------------------------- #
class OllamaClient:
    def __init__(self, api: str, model: str, timeout: int = 900):
        self.api = api.rstrip("/")
        self.model = model
        self.timeout = timeout

    def generate(self, prompt: str, num_ctx: int = 16384, temperature: float = 0.2) -> str:
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            # Gemma 4 / Qwen3.5 are thinking models: without this the whole token
            # budget is spent in the `thinking` field and `response` comes back
            # empty. Ollama ignores the flag for models that do not think.
            "think": False,
            "options": {"num_ctx": num_ctx, "temperature": temperature},
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.api}/api/generate",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        last_error: Exception | None = None
        for attempt in (1, 2):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read().decode("utf-8", errors="replace")
                parsed = json.loads(raw)
                text = (parsed.get("response") or "").strip()
                if not text:
                    # Fallback for a model that overrides `think: false`: use its
                    # reasoning trace rather than failing with an empty summary.
                    text = (parsed.get("thinking") or "").strip()
                if not text:
                    raise RuntimeError("empty response from model")
                return text
            except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt == 1:
                    log(f"WARN: request failed ({exc}); retrying once...")
                    time.sleep(2)
        die(f"Ollama request failed after 2 attempts: {last_error}", 4)

    def check(self) -> None:
        try:
            with urllib.request.urlopen(f"{self.api}/api/version", timeout=5) as resp:
                json.loads(resp.read().decode("utf-8", errors="replace"))
        except Exception as exc:  # noqa: BLE001
            die(f"Cannot reach Ollama at {self.api}: {exc}. Is 'ollama serve' running?", 2)


# --------------------------------------------------------------------------- #
# Prompts
# --------------------------------------------------------------------------- #
LANG_NAMES = {"en": "English", "pt": "Portuguese"}

MAP_PROMPT = """You are a precise document analyst. Summarize the section below in {lang}.

Rules:
- Keep all key facts, names, numbers, dates and conclusions.
- Use short bullet points; no preamble.
- Do not invent anything that is not in the text.
- If the section is mostly boilerplate, say so briefly.

SECTION:
---
{text}
---
"""

REDUCE_PROMPT = """You are a precise document analyst. Combine the section summaries below into ONE coherent summary in {lang}.

Structure:
## Overview
2-4 sentences describing the document.

## Key points
- The most important facts and arguments.

## Numbers and dates
- Only the important figures, dates and names.

## Conclusions / actions
- What the document concludes or asks for. If none, write "None stated".

Rules: do not invent details; merge duplicates; keep it under 500 words.

SECTION SUMMARIES:
---
{text}
---
"""


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Summarize a PDF/TXT/MD document with a local Ollama model."
    )
    p.add_argument("input", help="Path to the document")
    p.add_argument("-m", "--model", default=DEFAULT_MODEL, help=f"Ollama model (default: {DEFAULT_MODEL})")
    p.add_argument("-o", "--out", help="Output markdown path (default: <input>.summary.md)")
    p.add_argument("--lang", choices=sorted(LANG_NAMES), default="en", help="Summary language (default: en)")
    p.add_argument("--chunk-chars", type=int, default=12000, help="Characters per chunk (default: 12000)")
    p.add_argument("--num-ctx", type=int, default=16384, help="Context window per request (default: 16384)")
    p.add_argument("--api", default=DEFAULT_API, help=f"Ollama API base (default: {DEFAULT_API})")
    p.add_argument("--timeout", type=int, default=900, help="Per-request timeout in seconds (default: 900)")
    p.add_argument("--keep-chunks", action="store_true", help="Write chunk files to a temp dir and print the path")
    p.add_argument("-v", "--verbose", action="store_true", help="Verbose progress")
    p.add_argument("--version", action="version", version=f"%(prog)s {VERSION}")
    return p


def main(argv: Iterable[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    src = Path(args.input).expanduser()
    if not src.is_file():
        die(f"Input file not found: {src}")

    if args.chunk_chars < 1000:
        die("--chunk-chars must be at least 1000")
    if args.num_ctx < 2048:
        die("--num-ctx must be at least 2048")

    t_start = time.time()
    log(f"summarize-doc v{VERSION} · model={args.model} · lang={args.lang}")

    log(f"Extracting text from {src.name} ...")
    text = clean_text(extract_text(src))
    if not text:
        die("No text extracted from document")
    log(f"Extracted {len(text):,} characters (~{len(text)//4:,} tokens)")

    chunks = chunk_text(text, args.chunk_chars)
    log(f"Split into {len(chunks)} chunk(s) of up to {args.chunk_chars:,} characters")

    client = OllamaClient(args.api, args.model, timeout=args.timeout)
    client.check()

    chunk_dir: Path | None = None
    if args.keep_chunks:
        chunk_dir = Path(tempfile.mkdtemp(prefix="summarize-doc-"))
        log(f"Chunk files: {chunk_dir}")

    summaries: list[str] = []
    failures = 0
    for i, chunk in enumerate(chunks, 1):
        log(f"Summarizing chunk {i}/{len(chunks)} ({len(chunk):,} chars) ...")
        t0 = time.time()
        try:
            summary = client.generate(
                MAP_PROMPT.format(lang=LANG_NAMES[args.lang], text=chunk),
                num_ctx=args.num_ctx,
            )
            summaries.append(summary)
            if chunk_dir is not None:
                (chunk_dir / f"chunk-{i:03d}.txt").write_text(chunk, encoding="utf-8")
                (chunk_dir / f"summary-{i:03d}.md").write_text(summary, encoding="utf-8")
            log(f"  chunk {i} done in {time.time()-t0:.1f}s")
        except SystemExit:
            raise
        except Exception as exc:  # noqa: BLE001
            failures += 1
            log(f"  WARN: chunk {i} failed: {exc}")
            summaries.append(f"[Chunk {i} could not be summarized: {exc}]")

    if not summaries:
        die("No chunk summaries produced", 4)

    if len(summaries) == 1:
        final = summaries[0]
    else:
        log(f"Combining {len(summaries)} section summaries ...")
        t0 = time.time()
        joined = "\n\n".join(f"### Section {i}\n{s}" for i, s in enumerate(summaries, 1))
        final = client.generate(
            REDUCE_PROMPT.format(lang=LANG_NAMES[args.lang], text=joined),
            num_ctx=max(args.num_ctx, 16384),
        )
        log(f"Final summary done in {time.time()-t0:.1f}s")

    out_path = Path(args.out).expanduser() if args.out else src.with_suffix(src.suffix + ".summary.md")
    header = (
        f"# Summary — {src.name}\n\n"
        f"- **Source:** `{src}`\n"
        f"- **Model:** `{args.model}`\n"
        f"- **Language:** {LANG_NAMES[args.lang]}\n"
        f"- **Generated:** {_dt.datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
        f"- **Size:** {len(text):,} chars · {len(chunks)} chunk(s)\n"
        f"- **Elapsed:** {time.time()-t_start:.1f}s\n\n"
        f"---\n\n"
    )
    out_path.write_text(header + final.strip() + "\n", encoding="utf-8")
    log(f"Saved: {out_path}")

    if failures:
        log(f"WARN: {failures} chunk(s) failed; summary may be incomplete")
        return 4
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        raise SystemExit(130)
