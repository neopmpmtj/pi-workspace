---
name: video-finder
description: Finds YouTube videos similar to a reference video or topic description. Matches by topic, style, depth, or audience. Filters by duration, recency, and views. Use when asked to find similar YouTube videos, find videos like a given one, or discover related YouTube content. Supports URL-based reference or natural-language queries.
---

# Video Finder

Find YouTube videos similar to a reference — by URL or by topic description — filtered by duration, recency, and similarity dimension.

## Configuration

All tunable parameters live in `config.json`. Read it first on every invocation:

```bash
cat config.json
```

Key parameters:
- `maxResults` — how many videos to return (default: 2)
- `maxDurationMinutes` — filter out longer videos (default: 15, 0 = no limit)
- `dateFilter` — recency: `day`, `week`, `month`, `year`, or `none`
- `similarityDimension` — what to match on: `auto`, `topic`, `creator-style`, `production-style`, `depth`, `audience`
- `minViews`, `language`, `outputTemplate`

## Web Dashboard

A full browser-based dashboard is available at **http://localhost:3000/video-finder/**. It provides:
- Live parameter configuration with presets
- Search queuing (URL or topic input)
- Live result polling
- Full search history (SQLite-backed, infinite retention)
- Stats: total searches, this week, avg results, top dimension
- Actions: rerun, compare (side-by-side), delete

Access it from the main Pi dashboard via the **Skills** card → **Video Finder**.

The dashboard is served by `server.mjs` (port 3000). The API lives in `html/video-finder/api.mjs`.

When invoked via `/skill:video-finder` with no arguments, **first check for a pending web request**:

```bash
cat web/requests/current.json
```

If `status` is `"pending"`, process that request. After completing the search:

1. Write results to `web/results/latest.json` (the UI polls this file):
```bash
cat > web/results/latest.json << 'EOF'
{"status": "done", "results": [...], "metadata": {...}}
EOF
```

2. Record the job in the SQLite database:
```bash
node scripts/record-job.mjs '<json-payload>'
```
   The payload must include: `reference_url`, `reference_title`, `reference_channel`, `similarity_dimension`, `max_results`, `query_phrases` (JSON array), `results` (JSON array), `trigger_source`.

3. Reset the request file:
```bash
echo '{"status": "idle"}' > web/requests/current.json
```

If there is no pending web request, proceed with the normal workflow below and output results directly in chat.

## Workflow

### Step 1: Determine the reference

**If the user provides a YouTube URL** (any of these formats):
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://youtube.com/shorts/VIDEO_ID`

Extract the video ID and run the metadata script:

```bash
./scripts/fetch-metadata.sh "<URL>"
```

This returns JSON with `title`, `description`, `channel`, `duration`, `tags`, `categories`, etc. Use the title and tags to build search queries.

**If the user provides a description or topic instead** (no URL):
Use their description directly as the reference topic. Skip the metadata step.

### Step 2: Understand similarity dimension

Read `similarityDimension` from config. The user can override at invocation time (e.g., "find me similar videos but match on creator style, not topic").

| Dimension | What to match | Query strategy |
|---|---|---|
| `auto` | Infer from reference | Use title + tags as seeds |
| `topic` | Same subject matter | Search for the core topic using varied phrasings |
| `creator-style` | Similar channel vibe, format, presentation | Include channel name/style cues in queries |
| `production-style` | Similar editing, pacing, visual approach | Include "animated", "deep dive", "walkthrough" etc. |
| `depth` | Similar technical depth (beginner/intermediate/expert) | Include level cues like "explained", "tutorial", "internals" |
| `audience` | Same target audience | Include audience cues like "for developers", "for beginners" |

### Step 3: Build and run searches

Use **2–4 varied search queries** with `web_search` (set `workflow: "none"`). Each query should phrase the topic differently.

**Always include these terms** in every query to constrain to YouTube:
- Prefix with `site:youtube.com`

**Example query construction** (reference video is about "Pi coding agent architecture"):
```
Query 1: "site:youtube.com coding agent architecture agent loop tools"
Query 2: "site:youtube.com agent harness internals architecture"
Query 3: "site:youtube.com AI coding agent how it works under the hood"
```

If duration filtering is active, append duration-related terms:
- Short (<5 min): add "short", "explained in", "in X minutes"
- Medium (5–15 min): no special terms needed
- Long (>15 min): add "deep dive", "full walkthrough"

### Step 4: Filter results

After getting search results, apply filters in this order:

1. **Duration filter** (`maxDurationMinutes`): Skip videos whose length exceeds the cap. Video duration is in the search result metadata (e.g., `Length: 14:32`). If duration is not present in the search result, use `fetch_content` on the video URL to retrieve it.

2. **Date filter** (`dateFilter`): Use `web_search`'s `recencyFilter` parameter with the value from config.

3. **View filter** (`minViews`): Skip videos below the minimum view count.

4. **Language filter** (`language`): Prefer videos in the configured language.

5. **Deduplication**: Never include the reference video itself in results. Skip videos already listed.

### Step 5: Validate durations

If duration info is missing from initial search results, verify the top candidates:

```bash
./scripts/fetch-metadata.sh "<candidate-url>" 2>/dev/null
```

Use the `duration_minutes` field to check against `maxDurationMinutes`. Skip candidates that exceed the limit.

### Step 6: Format output

Use the `outputTemplate` from config:

**`detailed`** (default):
```markdown
### N. [Title]
- **Channel:** [channel name]
- **Duration:** X:XX
- **Published:** YYYY-MM-DD
- **Link:** [URL]

**Why it's similar:** [1–2 sentence explanation connecting the reference to this video, citing specific overlaps in topic, approach, or style.]
```

**`compact`:**
```markdown
N. **[Title](URL)** — [channel], [duration], [date]
```

**`table`:**
A markdown table with columns: #, Title, Channel, Duration, Date, Link.

### Step 7: Record to database and write web results

After completing a search, always record it to the SQLite database:

```bash
node scripts/record-job.mjs '{
  "reference_url": "https://youtu.be/...",
  "reference_title": "Video Title",
  "reference_channel": "Channel Name",
  "reference_duration": 840,
  "similarity_dimension": "auto",
  "max_results": 2,
  "max_duration_minutes": 15,
  "date_filter": "year",
  "query_phrases": ["query1", "query2"],
  "results": [{"title":"...","channel":"...","duration":"14:32","url":"...","why":"..."}],
  "trigger_source": "slash-command",
  "duration_ms": 3200
}'
```

If processing a web dashboard request, also write `web/results/latest.json` with results and reset `web/requests/current.json`.

If invoked from chat (not a web request), output results directly + record to DB for history.

## Edge Cases & Fallbacks

- **yt-dlp not installed:** Tell the user to install it (`pip install yt-dlp` or `brew install yt-dlp`). Proceed with just the URL as reference — use the URL itself in a `fetch_content` call to get the video title instead.
- **No results found:** Broaden the search by removing the site filter or using fewer restrictive terms. Report back what was tried.
- **URL is a Short:** Treat it the same as a regular video — metadata extraction works identically.
- **Config file missing or malformed:** Fall back to hardcoded defaults (maxResults: 2, maxDurationMinutes: 15, dateFilter: "year", similarityDimension: "auto").
- **Video unavailable or private:** Report the error to the user and ask if they want to search by topic instead.

## Tips

- Always read `config.json` first — the user may have changed parameters via the web UI or by hand.
- When the similarity dimension is `auto`, look at the reference video's tags and categories from the metadata to decide which dimension makes the most sense.
- For highly specific technical videos (like coding agent architecture), lean toward `topic` + `depth` matching.
- Cache metadata results for the reference video — don't refetch if the same URL is used in a follow-up request within the same session.
- When processing a web dashboard request, always write results to `web/results/latest.json` even on failure — use `{"status": "error", "error": "..."}` so the UI shows the error state.
- The dashboard is served by the main Pi server on port 3000 at `/video-finder/`. Access it via the Skills card on the home page.
- The Python standalone server (`web/server.py`) is deprecated — all routing now goes through `server.mjs`.