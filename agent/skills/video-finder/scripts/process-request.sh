#!/usr/bin/env bash
# process-request.sh — Self-contained video-finder pipeline.
# Uses yt-dlp ytsearch + Python filter (no API keys, no LLM).

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$SKILL_DIR/config.json"
REQUEST="$SKILL_DIR/web/requests/current.json"
RESULTS="$SKILL_DIR/web/results/latest.json"
PROGRESS="$SKILL_DIR/web/logs/progress.log"
RECORD_SCRIPT="$SKILL_DIR/scripts/record-job.mjs"
FILTER="$SKILL_DIR/scripts/filter-results.py"

log() { echo "$@" >> "$PROGRESS"; }

log "🔍 Pipeline started"
log ""

# ── Read config & request ────────────────────────────────────────────
MAX_RESULTS=$(python3 -c "import json; print(json.load(open('$CONFIG'))['maxResults'])")
MAX_DURATION=$(python3 -c "import json; print(json.load(open('$CONFIG'))['maxDurationMinutes'])")
SIM_DIM=$(python3 -c "import json; print(json.load(open('$CONFIG'))['similarityDimension'])")
REF=$(python3 -c "import json; print(json.load(open('$REQUEST'))['reference'])")
IS_URL=$(python3 -c "import json; print(json.load(open('$REQUEST'))['isUrl'])")

log "📋 max=$MAX_RESULTS results, ≤$MAX_DURATION min, similarity=$SIM_DIM"
log "📥 $REF"
log ""

# ── Determine topic ──────────────────────────────────────────────────
REF_TITLE="$REF"; REF_CHANNEL=""; REF_DURATION="0"; REF_ID=""

if [ "$IS_URL" = "True" ]; then
  log "🎬 Fetching metadata..."
  META=$(yt-dlp --dump-json --no-playlist --no-download --ignore-errors --no-warnings "$REF" 2>/dev/null || echo '{}')
  REF_TITLE=$(echo "$META" | python3 -c "import sys,json; print(json.loads(sys.stdin.read().strip()).get('title','$REF'))")
  REF_CHANNEL=$(echo "$META" | python3 -c "import sys,json; d=json.loads(sys.stdin.read().strip()); print(d.get('channel','') or d.get('uploader',''))")
  REF_DURATION=$(echo "$META" | python3 -c "import sys,json; print(json.loads(sys.stdin.read().strip()).get('duration',0))")
  REF_ID=$(echo "$META" | python3 -c "import sys,json; print(json.loads(sys.stdin.read().strip()).get('id',''))")
  log "   $REF_TITLE | $REF_CHANNEL | ${REF_DURATION}s"
else
  log "📝 Topic search: $REF_TITLE"
fi
log ""

# ── Build keywords ───────────────────────────────────────────────────
KEYWORDS=$(echo "$REF_TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]//g' | tr ' ' '\n' | grep -vE '^$|^(the|a|an|in|of|to|for|is|on|and|or|with|from|by|at|it|be|as|that|this|was|are|but|not|you|we|they|he|she|all|can|has|had|been|were|will|would|could|should|may|also|just|like|so|if|than|then|no|its|more|what|how|why|when|where|who|which|some|any|each|every|both|few|many|most|other|same|such|only|own|into|over|up|out|about|after|before|between|under|again|further|then|once|here|there|now|still|too|very|your|his|her|its|our|their|my|me)$' | sort -u | head -12 | tr '\n' ' ')

SEARCH_Q="${KEYWORDS:-$REF_TITLE}"
SEARCH_COUNT=$((MAX_RESULTS * 5))

log "🔎 Searching YouTube for: $SEARCH_Q"
log ""

# ── Search + filter ──────────────────────────────────────────────────
log ""
yt-dlp "ytsearch${SEARCH_COUNT}:$SEARCH_Q" \
  --dump-json --no-playlist --no-download --ignore-errors --no-warnings 2>/dev/null > /tmp/vf_search.json || true

python3 "$FILTER" "$REF_ID" "$MAX_RESULTS" "$MAX_DURATION" < /tmp/vf_search.json > /tmp/vf_results.json 2>/dev/null || true
rm -f /tmp/vf_search.json

RESULT_COUNT=$(python3 -c "import json; print(len(json.load(open('/tmp/vf_results.json'))))")
log "📊 Filtered to $RESULT_COUNT results (target: $MAX_RESULTS)"

# Show what we found
python3 -c "
import json
results = json.load(open('/tmp/vf_results.json'))
for i,r in enumerate(results):
    print(f\"   #{i+1}: {r['title'][:70]} | {r['channel']} | {r['duration']}\")"

# ── Write results JSON ───────────────────────────────────────────────
python3 -c "
import json
results = json.load(open('/tmp/vf_results.json'))
out = {
    'status': 'done',
    'results': results,
    'metadata': {
        'maxResults': $MAX_RESULTS,
        'maxDurationMinutes': $MAX_DURATION,
        'similarityDimension': '$SIM_DIM'
    }
}
json.dump(out, open('$RESULTS','w'), indent=2)
"
log ""
log "📤 Results written"

# ── Record to DB ─────────────────────────────────────────────────────
REF_TITLE_ESC=$(echo "$REF_TITLE" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))")
REF_CHAN_ESC=$(echo "$REF_CHANNEL" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))")
Q_ESC=$(echo "$SEARCH_Q" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))")

if [ "$IS_URL" = "True" ]; then
  REF_URL_ESC=$(echo "$REF" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))")
else
  REF_URL_ESC="None"
fi

python3 -c "
import json
results = json.load(open('/tmp/vf_results.json'))
payload = {
    'reference_url': $REF_URL_ESC,
    'reference_title': $REF_TITLE_ESC,
    'reference_channel': $REF_CHAN_ESC,
    'reference_duration': $REF_DURATION,
    'similarity_dimension': '$SIM_DIM',
    'max_results': $MAX_RESULTS,
    'max_duration_minutes': $MAX_DURATION,
    'date_filter': 'none',
    'min_views': 0,
    'language': 'en',
    'query_phrases': [$Q_ESC],
    'results': results,
    'trigger_source': 'web-dashboard-auto',
    'duration_ms': 0
}
print(json.dumps(payload))
" > /tmp/vf_payload.json

node "$RECORD_SCRIPT" "$(cat /tmp/vf_payload.json)" 2>/dev/null && log "📊 DB recorded" || log "⚠️  DB skipped"

# ── Reset request ────────────────────────────────────────────────────
echo '{"status":"idle"}' > "$REQUEST"

echo "" >> "$PROGRESS"
log "🎉 Done! $RESULT_COUNT results on dashboard."
log "✅ $(date -u +%Y-%m-%dT%H:%M:%SZ)"