#!/usr/bin/env python3
"""Write a slim JSON transcript of a Pi session JSONL file.

Keeps the first record unchanged, then user text, assistant text, model
changes, session names, compaction summaries, subagent reports, curator
notes, bash commands, and assistant errors. Drops the system prompt,
thinking, tool calls, tool results, and telemetry.

Usage:
  python3 slim_session.py SESSION.jsonl [SESSION.jsonl ...]
  python3 slim_session.py --out /path/to/dir SESSION.jsonl
  python3 slim_session.py --session 01a02571-0db4-74bb-836a-17405724cce9
  python3 slim_session.py --session 2026-08-21T17-49-21-204Z_01a02571-0db4-74bb-836a-17405724cce9.jsonl
"""

import argparse
import json
import sys
from pathlib import Path

DEFAULT_OUT = Path("/home/pmpmt/.pi/sessions-slim")
DEFAULT_SESSIONS = Path("/home/pmpmt/.pi/agent/sessions")
KEEP_CUSTOM_MESSAGES = {"subagent_complete", "curator-config"}


def text_blocks(content, drop_blank):
    blocks = []
    if isinstance(content, str):
        items = [{"type": "text", "text": content}]
    elif isinstance(content, list):
        items = content
    else:
        return blocks
    for item in items:
        if not isinstance(item, dict) or item.get("type") != "text":
            continue
        text = item.get("text")
        if not isinstance(text, str):
            continue
        if drop_blank and not text.strip():
            continue
        blocks.append({"type": "text", "text": text})
    return blocks


def envelope(entry, message):
    return {
        "type": "message",
        "id": entry.get("id"),
        "timestamp": entry.get("timestamp"),
        "message": message,
    }


def slim_message(entry):
    msg = entry.get("message")
    if not isinstance(msg, dict):
        return None
    role = msg.get("role")
    if role == "user":
        return envelope(entry, {"role": "user", "content": text_blocks(msg.get("content"), drop_blank=False)})
    if role == "assistant":
        blocks = text_blocks(msg.get("content"), drop_blank=True)
        error = msg.get("errorMessage")
        error = error if isinstance(error, str) and error.strip() else None
        if not blocks and error is None:
            return None
        message = {"role": "assistant"}
        if blocks:
            message["content"] = blocks
        if error is not None:
            message["errorMessage"] = error
        return envelope(entry, message)
    if role == "bashExecution":
        command = msg.get("command")
        if not isinstance(command, str):
            return None
        return envelope(entry, {"role": "bashExecution", "command": command})
    return None


def slim_custom_message(entry):
    if entry.get("customType") not in KEEP_CUSTOM_MESSAGES:
        return None
    content = entry.get("content")
    if isinstance(content, str):
        if not content.strip():
            return None
        kept = content
    else:
        blocks = text_blocks(content, drop_blank=True)
        if not blocks:
            return None
        kept = blocks
    return {
        "type": "custom_message",
        "customType": entry.get("customType"),
        "id": entry.get("id"),
        "timestamp": entry.get("timestamp"),
        "content": kept,
    }


def replacement_is_real(value):
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return True


def slim_entry(entry):
    kind = entry.get("type")
    if kind == "message":
        return slim_message(entry)
    if kind == "model_change":
        return {
            "type": "model_change",
            "id": entry.get("id"),
            "timestamp": entry.get("timestamp"),
            "provider": entry.get("provider"),
            "modelId": entry.get("modelId"),
        }
    if kind == "session_info":
        return {
            "type": "session_info",
            "id": entry.get("id"),
            "timestamp": entry.get("timestamp"),
            "name": entry.get("name"),
        }
    if kind == "compaction":
        summary = entry.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            return None
        return {
            "type": "compaction",
            "id": entry.get("id"),
            "timestamp": entry.get("timestamp"),
            "summary": summary,
        }
    if kind == "custom_message":
        return slim_custom_message(entry)
    if kind == "context_edit" and replacement_is_real(entry.get("replacement")):
        return {
            "type": "context_edit",
            "id": entry.get("id"),
            "timestamp": entry.get("timestamp"),
            "targetId": entry.get("targetId"),
            "replacement": entry.get("replacement"),
        }
    return None


def slim_file(path):
    records = []
    bad_lines = 0
    with path.open(encoding="utf-8") as handle:
        for raw in handle:
            if not raw.strip():
                continue
            try:
                entry = json.loads(raw)
            except json.JSONDecodeError:
                bad_lines += 1
                continue
            if not records:
                records.append(entry)
                continue
            if not isinstance(entry, dict):
                continue
            kept = slim_entry(entry)
            if kept is not None:
                records.append(kept)
    return records, bad_lines


def count_roles(records):
    counts = {}
    for record in records[1:]:
        if not isinstance(record, dict):
            continue
        if record.get("type") == "message":
            role = (record.get("message") or {}).get("role", "message")
            key = f"message:{role}"
        else:
            key = record.get("type", "unknown")
        counts[key] = counts.get(key, 0) + 1
    return counts


def session_id_of(path):
    parts = path.stem.split("_", 1)
    return parts[1] if len(parts) == 2 else ""


def find_session(query, root):
    direct = Path(query)
    if direct.is_file():
        return direct
    if not root.is_dir():
        print(f"sessions directory not found: {root}", file=sys.stderr)
        return None

    name = Path(query).name
    stem = Path(name).stem if name.endswith(".jsonl") else name
    files = sorted(root.rglob("*.jsonl"))
    exact = [path for path in files if path.name == name or path.name == f"{stem}.jsonl" or path.stem == stem]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        print(f"filename matches {len(exact)} sessions:", file=sys.stderr)
        for path in exact:
            print(f"  {path}", file=sys.stderr)
        return None

    by_id = [path for path in files if session_id_of(path) == stem or session_id_of(path).startswith(stem)]
    if len(by_id) == 1:
        return by_id[0]
    if len(by_id) > 1:
        print(f"session id matches {len(by_id)} sessions:", file=sys.stderr)
        for path in by_id:
            print(f"  {path}", file=sys.stderr)
        return None

    print(f"no session found for: {query}", file=sys.stderr)
    return None


def main(argv):
    parser = argparse.ArgumentParser(description="Slim a Pi session JSONL file to readable JSON.")
    parser.add_argument("paths", nargs="*", type=Path, help="Session .jsonl files or directories")
    parser.add_argument("--session", help="Slim one session by filename or session id")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"Output directory (default: {DEFAULT_OUT})")
    args = parser.parse_args(argv)

    if args.session and args.paths:
        print("pass either --session or file paths, not both", file=sys.stderr)
        return 1

    files = []
    if args.session:
        found = find_session(args.session, DEFAULT_SESSIONS)
        if found is None:
            return 1
        files.append(found)
    else:
        for path in args.paths:
            if path.is_dir():
                files.extend(sorted(path.rglob("*.jsonl")))
            elif path.is_file():
                files.append(path)
            else:
                print(f"missing path: {path}", file=sys.stderr)
                return 1
    if not files:
        print("no session files found", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    for path in files:
        records, bad_lines = slim_file(path)
        dest = args.out / f"{path.stem}.json"
        dest.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        counts = ", ".join(f"{key} {value}" for key, value in sorted(count_roles(records).items()))
        bad = f", skipped {bad_lines} bad lines" if bad_lines else ""
        print(f"{path.name} -> {dest} ({len(records)} records; {counts}{bad})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
