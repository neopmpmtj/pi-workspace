"""Tests for the gdrive module — Drive query escaping, pagination, retention, upload.

All tests use fakes/mocks; no network access."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from backup_PC_tool import gdrive
from backup_PC_tool.gdrive import (
    _escape_query_value,
    _find_folder,
    ensure_folder,
    enforce_retention,
    list_backups,
    upload_snapshot,
)


# ── Fake Drive service ──────────────────────────────────────────────────────


class _FakeRequest:
    """Mimics service.files().list(...).execute(num_retries=...)."""

    def __init__(self, execute_return):
        self._ret = execute_return
        self.execute = lambda num_retries=0: execute_return


class FakeFiles:
    def __init__(self):
        self.created = []
        self.deleted = []
        self._list_pages = []
        self._list_calls = []

    def set_pages(self, pages):
        """pages = list of dicts returned per .execute() call (in order)."""
        self._list_pages = list(pages)

    def list(self, **kwargs):
        self._list_calls.append(kwargs)
        if not self._list_pages:
            return _FakeRequest({"files": []})
        return _FakeRequest(self._list_pages.pop(0))

    def create(self, body=None, media_body=None, fields=None):
        self.created.append({"body": body, "media_body": media_body, "fields": fields})

        # If a media_body is present, this is a file upload → return a file id.
        if media_body is not None:
            return _FakeRequest({"id": "upload-file-id", "name": body["name"]})

        # Otherwise it's a folder create.
        return _FakeRequest({"id": f"folder-{body['name']}"})

    def delete(self, fileId=None):
        self.deleted.append(fileId)
        return _FakeRequest({})


class FakeService:
    def __init__(self):
        self._files = FakeFiles()

    def files(self):
        return self._files


# ── _escape_query_value ────────────────────────────────────────────────────


class TestEscapeQueryValue:
    def test_plain(self):
        assert _escape_query_value("backups") == "backups"

    def test_apostrophe(self):
        assert _escape_query_value("o'brien") == "o\\'brien"

    def test_backslash(self):
        assert _escape_query_value("a\\b") == "a\\\\b"

    def test_both(self):
        assert _escape_query_value("o'\\b") == "o\\'\\\\b"

    def test_empty(self):
        assert _escape_query_value("") == ""

    def test_realistic_hostname(self):
        assert _escape_query_value("pmpmt-ThinkPad-T15-Gen-2i") == "pmpmt-ThinkPad-T15-Gen-2i"


# ── _find_folder ───────────────────────────────────────────────────────────


class TestFindFolder:
    def test_returns_id_when_found(self):
        svc = FakeService()
        svc.files().set_pages([{"files": [{"id": "abc", "name": "backups"}]}])
        assert _find_folder(svc, "backups") == "abc"

    def test_returns_none_when_not_found(self):
        svc = FakeService()
        svc.files().set_pages([{"files": []}])
        assert _find_folder(svc, "backups") is None

    def test_apostrophe_name_does_not_crash_query(self):
        """Regression: a name with an apostrophe must build a valid query."""
        svc = FakeService()
        svc.files().set_pages([{"files": [{"id": "x", "name": "o'brien"}]}])
        assert _find_folder(svc, "o'brien") == "x"
        # The query string must escape the apostrophe.
        q = svc.files()._list_calls[0]["q"]
        assert "name='o\\'brien'" in q

    def test_parent_id_added_to_query(self):
        svc = FakeService()
        svc.files().set_pages([{"files": [{"id": "child", "name": "host"}]}])
        assert _find_folder(svc, "host", parent_id="root123") == "child"
        q = svc.files()._list_calls[0]["q"]
        assert "'root123' in parents" in q


# ── ensure_folder ──────────────────────────────────────────────────────────


class TestEnsureFolder:
    def test_reuses_existing_folder(self):
        svc = FakeService()
        svc.files().set_pages([{"files": [{"id": "exists", "name": "backups"}]}])
        assert ensure_folder(svc, "backups") == "exists"
        # No create call when the folder exists.
        assert svc.files().created == []

    def test_creates_when_missing(self):
        svc = FakeService()
        svc.files().set_pages([{"files": []}])
        fid = ensure_folder(svc, "backups")
        assert fid == "folder-backups"
        assert len(svc.files().created) == 1
        assert svc.files().created[0]["body"]["mimeType"] == "application/vnd.google-apps.folder"

    def test_creates_with_parent(self):
        svc = FakeService()
        svc.files().set_pages([{"files": []}])
        ensure_folder(svc, "host", parent_id="root")
        assert svc.files().created[0]["body"]["parents"] == ["root"]


# ── list_backups pagination ────────────────────────────────────────────────


class TestListBackups:
    def test_single_page(self):
        svc = FakeService()
        svc.files().set_pages([{"files": [{"id": "1"}, {"id": "2"}]}])
        assert list_backups(svc, "folderX") == [{"id": "1"}, {"id": "2"}]

    def test_multi_page_follows_next_page_token(self):
        """Regression: previously capped at 200 with no pagination."""
        svc = FakeService()
        svc.files().set_pages([
            {"files": [{"id": f"p1_{i}"} for i in range(200)], "nextPageToken": "tok2"},
            {"files": [{"id": f"p2_{i}"} for i in range(50)], "nextPageToken": "tok3"},
            {"files": [{"id": f"p3_{i}"} for i in range(5)]},
        ])
        files = list_backups(svc, "folderX")
        assert len(files) == 255
        # The client must thread pageToken through subsequent requests.
        assert svc.files()._list_calls[1]["pageToken"] == "tok2"
        assert svc.files()._list_calls[2]["pageToken"] == "tok3"
        assert svc.files()._list_calls[2].get("nextPageToken") is None

    def test_empty_folder(self):
        svc = FakeService()
        svc.files().set_pages([{"files": []}])
        assert list_backups(svc, "folderX") == []


# ── enforce_retention ──────────────────────────────────────────────────────


class TestEnforceRetention:
    def _files(self, n):
        return [{"id": str(i), "name": f"b_{i}.tar.gz"} for i in range(n)]

    def test_keeps_all_when_under_limit(self):
        svc = FakeService()
        with patch.object(gdrive, "list_backups", return_value=self._files(3)):
            enforce_retention(svc, "f", keep_last=5)
        assert svc.files().deleted == []

    def test_deletes_oldest_beyond_limit(self):
        svc = FakeService()
        files = self._files(7)  # newest first as returned by Drive
        with patch.object(gdrive, "list_backups", return_value=files):
            enforce_retention(svc, "f", keep_last=3)
        # Keep newest 3 (ids 0,1,2), delete the rest (3..6).
        assert svc.files().deleted == ["3", "4", "5", "6"]

    def test_exact_limit_deletes_nothing(self):
        svc = FakeService()
        with patch.object(gdrive, "list_backups", return_value=self._files(5)):
            enforce_retention(svc, "f", keep_last=5)
        assert svc.files().deleted == []


# ── upload_snapshot ────────────────────────────────────────────────────────


class TestUploadSnapshot:
    def test_uploads_and_returns_file_id(self, tmp_path: Path):
        archive = tmp_path / "backup_host_20260713T120000Z.tar.gz"
        archive.write_bytes(b"fake archive")

        svc = FakeService()
        with (
            patch.object(gdrive, "get_drive_service", return_value=svc),
            patch.object(gdrive, "get_backup_target_folder", return_value="target-folder-id"),
            patch.object(gdrive, "get_retention_count", return_value=0),
        ):
            file_id = upload_snapshot(archive, interactive=False)

        assert file_id == "upload-file-id"
        created = svc.files().created[0]
        assert created["body"]["name"] == "backup_host_20260713T120000Z.tar.gz"
        assert created["body"]["parents"] == ["target-folder-id"]
        assert created["media_body"] is not None

    def test_runs_retention_when_configured(self, tmp_path: Path):
        archive = tmp_path / "backup_host.tar.gz"
        archive.write_bytes(b"x")
        svc = FakeService()
        files = [{"id": str(i)} for i in range(4)]
        with (
            patch.object(gdrive, "get_drive_service", return_value=svc),
            patch.object(gdrive, "get_backup_target_folder", return_value="f"),
            patch.object(gdrive, "get_retention_count", return_value=2),
            patch.object(gdrive, "list_backups", return_value=files),
        ):
            upload_snapshot(archive, interactive=False)
        assert svc.files().deleted == ["2", "3"]

    def test_retention_failure_is_non_fatal(self, tmp_path: Path):
        archive = tmp_path / "backup_host.tar.gz"
        archive.write_bytes(b"x")
        svc = FakeService()
        with (
            patch.object(gdrive, "get_drive_service", return_value=svc),
            patch.object(gdrive, "get_backup_target_folder", return_value="f"),
            patch.object(gdrive, "get_retention_count", return_value=2),
            patch.object(gdrive, "enforce_retention", side_effect=RuntimeError("boom")),
        ):
            # Must NOT raise — retention is best-effort.
            file_id = upload_snapshot(archive, interactive=False)
        assert file_id == "upload-file-id"
