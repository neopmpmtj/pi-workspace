"""Unit tests for bundled save_youtube_transcript (no real YouTube / browser)."""

from __future__ import annotations

from pathlib import Path

from save_youtube_transcript import (
    TranscriptSegment,
    extract_player_response_from_html,
    format_transcript_line,
    make_json3_caption_url,
    parse_json3_transcript,
    write_transcript,
)


def test_format_transcript_line() -> None:
    s = TranscriptSegment(timestamp="0:05", text="Hello world")
    assert format_transcript_line(s) == "0:05\tHello world"


def test_write_transcript_roundtrip(tmp_path: Path) -> None:
    out = tmp_path / "t.txt"
    segs = [
        TranscriptSegment("0:00", "A"),
        TranscriptSegment("0:10", "B"),
    ]
    write_transcript(out, "https://example.com/watch?v=1", segs)
    text = out.read_text(encoding="utf-8")
    assert "https://example.com/watch?v=1" in text
    assert "Segment count: 2" in text
    assert "0:00\tA" in text
    assert "0:10\tB" in text


def test_write_transcript_empty_list_no_crash(tmp_path: Path) -> None:
    out = tmp_path / "empty.txt"
    write_transcript(out, "https://example.com", [])
    assert out.read_text(encoding="utf-8")
    assert out.is_file()


def test_parse_json3_transcript_keeps_timestamps_and_combines_segs() -> None:
    payload = {
        "events": [
            {"tStartMs": 0, "segs": [{"utf8": "Hello"}, {"utf8": " world"}]},
            {"tStartMs": 65123, "segs": [{"utf8": "Second line"}]},
            {"tStartMs": 70000},
        ]
    }
    assert parse_json3_transcript(payload) == [
        TranscriptSegment("0:00", "Hello world"),
        TranscriptSegment("1:05", "Second line"),
    ]


def test_make_json3_caption_url_replaces_existing_fmt() -> None:
    url = "https://www.youtube.com/api/timedtext?v=abc&fmt=srv3&lang=en"
    assert make_json3_caption_url(url) == (
        "https://www.youtube.com/api/timedtext?v=abc&fmt=json3&lang=en"
    )


def test_extract_player_response_from_html_balanced_json() -> None:
    html = """
    <script>
    var ytInitialPlayerResponse = {"captions":{"x":{"nested":true}},"videoDetails":{"title":"A { tricky } title"}};
    </script>
    """
    response = extract_player_response_from_html(html)
    assert response["videoDetails"]["title"] == "A { tricky } title"
