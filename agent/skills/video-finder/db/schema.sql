-- Video Finder - Search History Database Schema
-- Stored at ~/.pi/agent/skills/video-finder/db/video_finder.db

CREATE TABLE IF NOT EXISTS searches (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp             TEXT NOT NULL DEFAULT (datetime('now')),
    reference_url         TEXT,                    -- null if topic-only search
    reference_title       TEXT,                    -- from yt-dlp or user input
    reference_channel     TEXT,                    -- from yt-dlp
    reference_duration    INTEGER,                 -- seconds, from yt-dlp
    similarity_dimension  TEXT NOT NULL DEFAULT 'auto',
    max_results           INTEGER NOT NULL DEFAULT 2,
    max_duration_minutes  INTEGER NOT NULL DEFAULT 15,
    date_filter           TEXT NOT NULL DEFAULT 'year',
    min_views             INTEGER DEFAULT 0,
    language              TEXT DEFAULT 'en',
    query_phrases         TEXT,                    -- JSON array of search query strings
    results_json          TEXT,                    -- JSON array of result objects
    result_count          INTEGER DEFAULT 0,       -- denormalized for fast stats
    trigger_source        TEXT NOT NULL DEFAULT 'web-dashboard',
    duration_ms           INTEGER                  -- how long the search took (milliseconds)
);

CREATE INDEX IF NOT EXISTS idx_searches_timestamp ON searches(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_searches_dimension ON searches(similarity_dimension);
CREATE INDEX IF NOT EXISTS idx_searches_trigger ON searches(trigger_source);

-- Result objects stored in results_json follow this structure:
-- [
--   {
--     "title": "Video Title",
--     "channel": "Channel Name",
--     "duration": "14:32",
--     "duration_seconds": 872,
--     "published": "2026-05-24",
--     "url": "https://www.youtube.com/watch?v=...",
--     "views": 2300,
--     "why": "Covers the same agent loop architecture..."
--   }
-- ]