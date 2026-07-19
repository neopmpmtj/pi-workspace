#!/usr/bin/env python3
"""Filter yt-dlp search results by duration and deduplication."""
import sys, json

ref_id = sys.argv[1] if len(sys.argv) > 1 else ""
max_results = int(sys.argv[2]) if len(sys.argv) > 2 else 2
max_dur_min = int(sys.argv[3]) if len(sys.argv) > 3 else 15

results = []
seen_ids = set()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        d = json.loads(line)
    except json.JSONDecodeError:
        continue

    vid = d.get('id', '')
    if not vid or vid in seen_ids:
        continue
    if ref_id and vid == ref_id:
        continue

    dur = d.get('duration', 0)
    if dur == 0:
        continue  # skip live/unknown
    if max_dur_min > 0 and dur > max_dur_min * 60:
        continue

    seen_ids.add(vid)

    mins = dur // 60
    secs = dur % 60

    results.append({
        "title": d.get('title', ''),
        "channel": d.get('channel', '') or d.get('uploader', ''),
        "duration": f"{mins}:{secs:02d}",
        "duration_seconds": dur,
        "published": d.get('upload_date', ''),
        "url": f"https://www.youtube.com/watch?v={vid}",
        "views": d.get('view_count', 0),
        "why": "Matches topic and duration criteria."
    })

    if len(results) >= max_results:
        break

print(json.dumps(results, indent=2, ensure_ascii=False))