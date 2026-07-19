"""
Implementation module for save_youtube_transcript.py.

Primary path: resolve and fetch YouTube captions locally with yt-dlp.
Fallbacks: direct watch-page caption parsing, then local Playwright browser UI.
No YouTube Data API key is required.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
import urllib.request
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_VIDEO_URL = "https://www.youtube.com/watch?v=8QiD893dLX0"
# Portable skill: always write next to the skill root, not the process cwd.
_SKILL_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_TEXT = _SKILL_ROOT / "youtube_transcript.txt"
OUTPUT_JSON = _SKILL_ROOT / "youtube_transcript.json"
# Default: show browser. Set env YOUTUBE_TRANSCRIPT_HEADLESS=1 to run without a display.
HEADLESS = os.environ.get("YOUTUBE_TRANSCRIPT_HEADLESS", "").lower() in (
    "1",
    "true",
    "yes",
)
# Output format: "text", "json", or "both"
OUTPUT_FORMAT = os.environ.get("YOUTUBE_TRANSCRIPT_FORMAT", "text").lower()
# Timeouts (ms)
PAGE_GOTO_TIMEOUT_MS = 60_000
PLAYER_READY_TIMEOUT_MS = 45_000
TRANSCRIPT_PANEL_TIMEOUT_MS = 30_000
CAPTION_FETCH_TIMEOUT_SECONDS = 20
WATCH_PAGE_FETCH_TIMEOUT_SECONDS = 20
# Scroll transcript list to load lazy segments (increase if a video has a very long script)
MAX_TRANSCRIPT_SCROLL_ROUNDS = 80
SCROLL_PAUSE_MS = 150
# After expanding the description, the "Transcript" / "Show transcript" block can paint late.
POST_EXPAND_SETTLE_MS = 500

# Accessible names for the transcript trigger (EN/PT). Avoid a bare "script" term (false positives).
_TRANSCRIPT_ACTION_RE = re.compile(
    r"show\s+transcript|mostrar\s+transcri[pt]|transcri[pt]\s*$|transcri[çc][aã]o",
    re.IGNORECASE,
)
_WHITESPACE_RE = re.compile(r"\s+")


@dataclass
class VideoMetadata:
    """Structured metadata about the extracted video."""

    url: str = ""
    title: str = ""
    channel: str = ""
    duration_seconds: int = 0
    segment_count: int = 0
    extraction_method: str = ""
    has_cookies: bool = False
    extracted_at: str = ""


@dataclass(frozen=True, slots=True)
class TranscriptSegment:
    """One caption line with its display timestamp (as shown in the UI)."""

    timestamp: str
    text: str


# Parsed args cache — parse once, reuse
_ARGS: argparse.Namespace | None = None


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments once and cache the result."""
    global _ARGS
    if _ARGS is not None:
        return _ARGS
    parser = argparse.ArgumentParser(
        description="Extract YouTube transcript with multi-fallback pipeline."
    )
    parser.add_argument(
        "url",
        nargs="?",
        default=None,
        help="YouTube watch URL. Uses DEFAULT_VIDEO_URL if omitted.",
    )
    parser.add_argument(
        "--format",
        choices=["text", "json", "both"],
        default=OUTPUT_FORMAT,
        help="Output format: text, json, or both (default: text)",
    )
    _ARGS = parser.parse_args()
    return _ARGS


def get_video_url_from_terminal() -> str:
    args = parse_args()
    if args.url:
        return args.url.strip()
    return DEFAULT_VIDEO_URL


def get_output_format() -> str:
    """Return the requested output format from CLI args or env."""
    args = parse_args()
    return args.format


def _video_primary_column(page):
    return page.locator("ytd-video-secondary-info-renderer, ytd-watch-metadata").first


def _scroll_main_column_into_view(page) -> None:
    for sel in (
        "ytd-video-secondary-info-renderer",
        "ytd-watch-metadata",
        "ytd-video-primary-info-renderer",
    ):
        try:
            page.locator(sel).first.scroll_into_view_if_needed(timeout=3_000)
        except (PlaywrightTimeoutError, Exception):
            pass


def _consent_dismiss_if_any(page) -> None:
    for text in (
        "Accept all",
        "Aceitar tudo",
        "Reject all",
        "Rejeitar tudo",
        "I agree",
        "Concordo",
    ):
        try:
            page.get_by_role("button", name=text).click(timeout=1500)
            return
        except PlaywrightTimeoutError:
            pass


def _expand_description_if_collapsed(page) -> None:
    _scroll_main_column_into_view(page)
    col = _video_primary_column(page)
    # Prefer the description / inline expander (avoid other "...more" buttons on the page).
    for sel in (
        "ytd-text-inline-expander #expand",
        "ytd-video-secondary-info-renderer ytd-text-inline-expander #expand",
        "#description-inline-expander tp-yt-paper-button#expand",
        "ytd-expandable-text-renderer #expand",
    ):
        try:
            ex = page.locator(sel).first
            ex.scroll_into_view_if_needed(timeout=2_000)
            ex.click(timeout=2_500)
            page.wait_for_timeout(POST_EXPAND_SETTLE_MS)
            return
        except PlaywrightTimeoutError:
            pass
    for pattern in (r"^Show more$", r"^Ver mais$", r"^Mostrar mais$"):
        try:
            t = col.get_by_text(re.compile(pattern, re.I))
            t.first.scroll_into_view_if_needed(timeout=2_000)
            t.first.click(timeout=2_500)
            page.wait_for_timeout(POST_EXPAND_SETTLE_MS)
            return
        except PlaywrightTimeoutError:
            pass
    for label in ("...more",):
        try:
            more = col.get_by_text(label, exact=True)
            more.first.scroll_into_view_if_needed(timeout=2_000)
            more.first.click(timeout=2_500)
            page.wait_for_timeout(POST_EXPAND_SETTLE_MS)
            return
        except PlaywrightTimeoutError:
            pass
    # "...more" can appear with different unicode dots or extra whitespace
    try:
        more = col.get_by_text(re.compile(r"^[\s\u2026.]*\.\.\.more\s*$", re.I))
        more.first.scroll_into_view_if_needed(timeout=2_000)
        more.first.click(timeout=2_500)
        page.wait_for_timeout(POST_EXPAND_SETTLE_MS)
    except (PlaywrightTimeoutError, Exception):
        pass


def _click_show_transcript(page) -> None:
    _scroll_main_column_into_view(page)
    col = page.locator("ytd-video-secondary-info-renderer")
    if col.count() == 0:
        col = page.locator("ytd-watch-flexy ytd-watch-metadata, ytd-watch-metadata")

    def _try_click(loc) -> bool:
        try:
            loc.scroll_into_view_if_needed(timeout=3_000)
            loc.wait_for(state="visible", timeout=3_000)
            loc.click(timeout=6_000)
            return True
        except (PlaywrightTimeoutError, Exception):
            return False

    # 1) Exact "Show transcript" in the main column (matches Transcript section + blue button in UI)
    for exact in ("Show transcript", "Show captions", "Mostrar transcrição", "Ativar legenda"):
        try:
            btn = col.get_by_text(exact, exact=True).first
            if _try_click(btn):
                return
        except (PlaywrightTimeoutError, Exception):
            pass
    # 2) Button / link by accessible name (scoped: avoid Shorts/mini/masthead)
    for role in ("button", "link"):
        try:
            loc = col.get_by_role(role, name=_TRANSCRIPT_ACTION_RE).first
            if _try_click(loc):
                return
        except (PlaywrightTimeoutError, Exception):
            pass
    # 3) ytd-button-renderer with inner text
    try:
        loc = col.locator("ytd-button-renderer, yt-button").filter(
            has_text=re.compile(r"show\s+transcript|mostrar\s+transcri", re.I)
        ).first
        if _try_click(loc):
            return
    except (PlaywrightTimeoutError, Exception):
        pass
    # 4) aria-label on icon buttons
    for lab in (r"transcript", r"Transcri", r"legenda", r"Legenda", r"caption", r"Caption"):
        try:
            loc = col.locator(f"[aria-label*=\"{lab}\" i]").first
            if _try_click(loc):
                return
        except (PlaywrightTimeoutError, Exception):
            pass
    # 5) Last resort: first match in page (previous behavior; may be fragile)
    for role in ("button", "link"):
        try:
            loc = page.get_by_role(role, name=_TRANSCRIPT_ACTION_RE).first
            if _try_click(loc):
                return
        except (PlaywrightTimeoutError, Exception):
            pass
    try:
        loc = page.get_by_text(_TRANSCRIPT_ACTION_RE).first
        if _try_click(loc):
            return
    except (PlaywrightTimeoutError, Exception):
        pass
    raise RuntimeError(
        "Could not find a control to open the transcript. "
        "Expand the description (…more) if you see it, then ensure the video has a transcript, "
        "or sign in and try again if YouTube is blocking the UI."
    )


def _wait_for_transcript_body(page) -> None:
    page.wait_for_selector(
        "ytd-transcript-renderer, ytd-transcript-body-renderer, ytd-transcript-segment-renderer",
        timeout=TRANSCRIPT_PANEL_TIMEOUT_MS,
    )


def _scroll_transcript_to_load_all(page) -> None:
    body = page.locator(
        "ytd-transcript-renderer, ytd-transcript-body-renderer, #segments-container"
    ).first
    try:
        body.wait_for(state="visible", timeout=5000)
    except PlaywrightTimeoutError:
        return
    prev = -1
    for _ in range(MAX_TRANSCRIPT_SCROLL_ROUNDS):
        count = page.locator("ytd-transcript-segment-renderer").count()
        if count > 0 and count == prev:
            break
        prev = count
        try:
            body.evaluate("el => { el.scrollTop = el.scrollHeight; }")
        except Exception:
            page.keyboard.press("End")
        page.wait_for_timeout(SCROLL_PAUSE_MS)


def _parse_one_segment_node(seg_locator) -> TranscriptSegment | None:
    try:
        ts = seg_locator.locator(".segment-timestamp").inner_text()
        txt = seg_locator.locator(".segment-text, yt-formatted-string.segment-text")
        if txt.count() == 0:
            txt = seg_locator.locator(".segment-text")
        if txt.count() == 0:
            raw = seg_locator.inner_text()
            parts = [p.strip() for p in raw.split("\n") if p.strip()]
            if not parts:
                return None
            m = re.match(r"^(\d+:\d+(?::\d+)?)\s*(.*)$", parts[0], re.DOTALL)
            if m:
                return TranscriptSegment(timestamp=m.group(1).strip(), text=m.group(2).strip())
            if len(parts) >= 2:
                return TranscriptSegment(timestamp=parts[0], text=" ".join(parts[1:]))
            return None
        text = txt.first.inner_text()
        return TranscriptSegment(timestamp=ts.strip(), text=text.strip())
    except Exception:
        return None


def _format_ms_timestamp(milliseconds: int) -> str:
    seconds = max(milliseconds, 0) // 1000
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def _clean_caption_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text.replace("\u200b", "")).strip()


def parse_json3_transcript(payload: dict[str, Any]) -> list[TranscriptSegment]:
    """Parse YouTube's timedtext JSON3 caption payload into timestamped segments."""
    segments: list[TranscriptSegment] = []
    for event in payload.get("events", []):
        segs = event.get("segs")
        if not segs:
            continue
        text = _clean_caption_text("".join(s.get("utf8", "") for s in segs))
        if not text:
            continue
        segments.append(
            TranscriptSegment(
                timestamp=_format_ms_timestamp(int(event.get("tStartMs", 0))),
                text=text,
            )
        )
    return segments


def make_json3_caption_url(base_url: str) -> str:
    parts = urlsplit(base_url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    found = False
    updated: list[tuple[str, str]] = []
    for key, value in query:
        if key == "fmt":
            updated.append((key, "json3"))
            found = True
        else:
            updated.append((key, value))
    if not found:
        updated.append(("fmt", "json3"))
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(updated), parts.fragment)
    )


def extract_player_response_from_html(html: str) -> dict[str, Any]:
    marker = "ytInitialPlayerResponse"
    start = html.find(marker)
    if start == -1:
        raise RuntimeError("Could not find ytInitialPlayerResponse in YouTube HTML.")
    equals = html.find("=", start)
    brace = html.find("{", equals)
    if equals == -1 or brace == -1:
        raise RuntimeError("Could not locate ytInitialPlayerResponse JSON object.")
    depth = 0
    in_string = False
    escape = False
    for i in range(brace, len(html)):
        ch = html[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(html[brace : i + 1])
    raise RuntimeError("Could not parse complete ytInitialPlayerResponse JSON object.")


def fetch_player_response_from_watch_page(video_url: str) -> dict[str, Any]:
    request = urllib.request.Request(
        video_url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(
        request, timeout=WATCH_PAGE_FETCH_TIMEOUT_SECONDS
    ) as response:
        return extract_player_response_from_html(response.read().decode("utf-8"))


def fetch_caption_track_segments_from_player_response(
    player_response: dict[str, Any],
) -> list[TranscriptSegment]:
    track = _choose_caption_track(player_response)
    if not track or not track.get("baseUrl"):
        raise RuntimeError("This video did not expose a caption track.")
    url = make_json3_caption_url(track["baseUrl"])
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        },
    )
    with urllib.request.urlopen(request, timeout=CAPTION_FETCH_TIMEOUT_SECONDS) as response:
        payload = json.loads(response.read().decode("utf-8"))
    segments = parse_json3_transcript(payload)
    if not segments:
        raise RuntimeError("Caption track was found but no transcript segments were parsed.")
    return segments


def extract_caption_track_segments_from_url(video_url: str) -> list[TranscriptSegment]:
    player_response = fetch_player_response_from_watch_page(video_url)
    return fetch_caption_track_segments_from_player_response(player_response)


def extract_youtube_transcript_api_segments(video_url: str) -> list[TranscriptSegment]:
    """Use youtube-transcript-api for public captions when YouTube allows this IP."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError as e:
        raise RuntimeError("youtube-transcript-api is not installed.") from e

    video_id = _extract_video_id(video_url)
    transcript = YouTubeTranscriptApi().fetch(
        video_id,
        languages=("en", "en-US", "en-GB", "pt", "pt-PT", "pt-BR"),
    )
    segments: list[TranscriptSegment] = []
    for snippet in transcript.snippets:
        text = _clean_caption_text(snippet.text)
        if text:
            segments.append(
                TranscriptSegment(
                    timestamp=_format_ms_timestamp(int(float(snippet.start) * 1000)),
                    text=text,
                )
            )
    if not segments:
        raise RuntimeError("youtube-transcript-api returned no transcript segments.")
    return segments


def _extract_video_id(video_url: str) -> str:
    parts = urlsplit(video_url)
    if parts.netloc.endswith("youtu.be"):
        return parts.path.strip("/")
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    if params.get("v"):
        return params["v"]
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", video_url):
        return video_url
    raise RuntimeError(f"Could not parse YouTube video id from {video_url!r}.")


def _pick_ytdlp_caption(captions: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
    if not captions:
        return None
    language_order = ["en", "en-orig", *captions.keys()]
    for language in language_order:
        for candidate in captions.get(language, []):
            if candidate.get("ext") == "json3" and candidate.get("url"):
                return candidate
    for candidates in captions.values():
        for candidate in candidates:
            if candidate.get("url"):
                return candidate
    return None


def extract_ytdlp_caption_segments(video_url: str) -> list[TranscriptSegment]:
    """Use yt-dlp locally to resolve YouTube's current caption URL shape."""
    try:
        import yt_dlp
    except ImportError as e:
        raise RuntimeError("yt-dlp is not installed.") from e

    ydl_opts = {
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
    }
    cookies_file = os.environ.get("YOUTUBE_COOKIES_FILE")
    if cookies_file:
        ydl_opts["cookiefile"] = cookies_file
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(video_url, download=False)

    caption = _pick_ytdlp_caption(info.get("subtitles", {}))
    if caption is None:
        caption = _pick_ytdlp_caption(info.get("automatic_captions", {}))
    if caption is None:
        raise RuntimeError("yt-dlp did not find subtitles or automatic captions.")

    url = make_json3_caption_url(caption["url"])
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        },
    )
    with urllib.request.urlopen(request, timeout=CAPTION_FETCH_TIMEOUT_SECONDS) as response:
        payload = json.loads(response.read().decode("utf-8"))
    segments = parse_json3_transcript(payload)
    if not segments:
        raise RuntimeError("yt-dlp found a caption URL but no segments were parsed.")
    return segments


def _choose_caption_track(player_response: dict[str, Any]) -> dict[str, Any] | None:
    tracks = (
        player_response.get("captions", {})
        .get("playerCaptionsTracklistRenderer", {})
        .get("captionTracks", [])
    )
    if not tracks:
        return None
    for track in tracks:
        if track.get("languageCode", "").startswith("en"):
            return track
    return tracks[0]


def extract_caption_track_segments(page) -> list[TranscriptSegment]:
    """
    Fallback: read YouTube's embedded player response, fetch its caption track
    from the page, and parse the JSON3 timed transcript.
    """
    player_response = page.evaluate("() => window.ytInitialPlayerResponse || null")
    if not player_response:
        raise RuntimeError("Could not read ytInitialPlayerResponse from the page.")
    return fetch_caption_track_segments_from_player_response(player_response)


def extract_transcript_segments(page) -> list[TranscriptSegment]:
    _wait_for_transcript_body(page)
    _scroll_transcript_to_load_all(page)
    loc = page.locator("ytd-transcript-segment-renderer")
    n = loc.count()
    out: list[TranscriptSegment] = []
    for i in range(n):
        p = _parse_one_segment_node(loc.nth(i))
        if p is not None and p.text:
            out.append(p)
    if not out:
        raise RuntimeError(
            "Transcript panel opened but no ytd-transcript-segment-renderer lines could be read."
        )
    return out


def open_video(page, url: str) -> None:
    page.goto(url, wait_until="domcontentloaded", timeout=PAGE_GOTO_TIMEOUT_MS)
    _consent_dismiss_if_any(page)
    if page.evaluate("() => Boolean(window.ytInitialPlayerResponse)"):
        return
    page.wait_for_selector("video, ytd-player, #movie_player", timeout=PLAYER_READY_TIMEOUT_MS)


def open_transcript_panel(page) -> None:
    _expand_description_if_collapsed(page)
    # After expand, the Transcript / "Show transcript" block can appear a moment later
    col = page.locator("ytd-video-secondary-info-renderer")
    try:
        col.get_by_text("Show transcript", exact=True).first.wait_for(
            state="visible", timeout=15_000
        )
    except (PlaywrightTimeoutError, Exception):
        pass
    try:
        _click_show_transcript(page)
    except RuntimeError:
        page.wait_for_timeout(500)
        _scroll_main_column_into_view(page)
        _expand_description_if_collapsed(page)
        _click_show_transcript(page)


def format_transcript_line(segment: TranscriptSegment) -> str:
    return f"{segment.timestamp}\t{segment.text}"


def write_transcript(path: Path, video_url: str, segments: list[TranscriptSegment]) -> None:
    lines = [f"Video URL: {video_url}", f"Segment count: {len(segments)}", ""]
    for s in segments:
        lines.append(format_transcript_line(s))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote transcript: {path.resolve()}")


def _extract_metadata_from_ytdlp(video_url: str) -> dict[str, Any]:
    """Extract video metadata using yt-dlp (title, channel, duration)."""
    try:
        import yt_dlp

        ydl_opts = {"skip_download": True, "quiet": True, "no_warnings": True}
        cookies_file = os.environ.get("YOUTUBE_COOKIES_FILE")
        if cookies_file and Path(cookies_file).exists():
            ydl_opts["cookiefile"] = cookies_file
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
        return {
            "title": info.get("title", ""),
            "channel": info.get("uploader", info.get("channel", "")),
            "duration_seconds": int(info.get("duration", 0) or 0),
        }
    except Exception:
        return {"title": "", "channel": "", "duration_seconds": 0}


def _extract_metadata_from_page(page) -> dict[str, Any]:
    """Extract video metadata from the YouTube page via JS evaluation."""
    try:
        data = page.evaluate(
            """() => {
                const pr = window.ytInitialPlayerResponse;
                if (!pr || !pr.videoDetails) return {};
                const vd = pr.videoDetails;
                return {
                    title: vd.title || '',
                    channel: vd.author || '',
                    duration_seconds: parseInt(vd.lengthSeconds) || 0
                };
            }"""
        )
        return data or {"title": "", "channel": "", "duration_seconds": 0}
    except Exception:
        return {"title": "", "channel": "", "duration_seconds": 0}


def build_metadata(
    video_url: str,
    segments: list[TranscriptSegment],
    extraction_method: str,
) -> VideoMetadata:
    """Build structured metadata, trying yt-dlp first, then page."""
    meta = VideoMetadata(
        url=video_url,
        segment_count=len(segments),
        extraction_method=extraction_method,
        has_cookies=bool(
            os.environ.get("YOUTUBE_COOKIES_FILE")
            and Path(os.environ["YOUTUBE_COOKIES_FILE"]).exists()
        ),
        extracted_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )
    # Try yt-dlp for rich metadata
    info = _extract_metadata_from_ytdlp(video_url)
    if info["title"]:
        meta.title = info["title"]
        meta.channel = info["channel"]
        meta.duration_seconds = info["duration_seconds"]
    return meta


def metadata_to_dict(meta: VideoMetadata) -> dict[str, Any]:
    """Serialize VideoMetadata to a plain dict for JSON output."""
    return {
        "url": meta.url,
        "title": meta.title,
        "channel": meta.channel,
        "duration_seconds": meta.duration_seconds,
        "segment_count": meta.segment_count,
        "extraction_method": meta.extraction_method,
        "has_cookies": meta.has_cookies,
        "extracted_at": meta.extracted_at,
    }


def write_json_output(
    path: Path,
    video_url: str,
    segments: list[TranscriptSegment],
    extraction_method: str,
) -> None:
    """Write structured JSON output with metadata and all segments."""
    meta = build_metadata(video_url, segments, extraction_method)
    data = metadata_to_dict(meta)
    data["segments"] = [
        {"timestamp": s.timestamp, "text": s.text} for s in segments
    ]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote JSON: {path.resolve()}")


def _write_outputs(
    video_url: str,
    segments: list[TranscriptSegment],
    method: str,
) -> None:
    """Write transcripts in the requested format(s)."""
    fmt = get_output_format()
    if fmt in ("text", "both"):
        write_transcript(OUTPUT_TEXT, video_url, segments)
    if fmt in ("json", "both"):
        write_json_output(OUTPUT_JSON, video_url, segments, method)


def main() -> None:
    video_url = get_video_url_from_terminal()
    errors: list[str] = []

    try:
        segments = extract_youtube_transcript_api_segments(video_url)
        _write_outputs(video_url, segments, "youtube-transcript-api")
        return
    except Exception as e:
        errors.append(f"youtube-transcript-api: {e}")

    try:
        segments = extract_ytdlp_caption_segments(video_url)
        _write_outputs(video_url, segments, "yt-dlp")
        return
    except Exception as e:
        errors.append(f"yt-dlp: {e}")

    try:
        segments = extract_caption_track_segments_from_url(video_url)
        _write_outputs(video_url, segments, "watch-page-captions")
        return
    except Exception as e:
        errors.append(f"watch-page captions: {e}")

    cookies_file = os.environ.get("YOUTUBE_COOKIES_FILE")
    if cookies_file:
        errors.append(
            "YOUTUBE_COOKIES_FILE was provided; it is used by yt-dlp. "
            "Playwright cookie import is not implemented for Netscape cookie files."
        )

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=HEADLESS,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = browser.new_context(
            locale="en-US",
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        try:
            open_video(page, video_url)
            try:
                segments = extract_caption_track_segments(page)
                _write_outputs(video_url, segments, "playwright-embedded-captions")
            except Exception as e:
                errors.append(f"playwright embedded captions: {e}")
                open_transcript_panel(page)
                segments = extract_transcript_segments(page)
                _write_outputs(video_url, segments, "playwright-transcript-panel")
        finally:
            context.close()
            browser.close()


if __name__ == "__main__":
    main()
