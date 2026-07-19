from __future__ import annotations

import socket
from pathlib import Path
from typing import Optional, List

from googleapiclient.http import MediaFileUpload

from .auth import get_drive_service
from .config import get_drive_root_folder_name, get_retention_count, use_hostname_subfolder
from .log import get_logger


logger = get_logger("backup.gdrive")

# Number of automatic retries (with exponential backoff) for transient errors
# (429, 500, 502, 503, 504). The google-api-python-client handles this inside
# .execute(); we just opt in here so a flaky network doesn't fail a backup.
_NUM_RETRIES = 3


def _escape_query_value(value: str) -> str:
    """
    Escape a literal for a Google Drive query string.

    Drive queries wrap literals in single quotes, so backslashes and single
    quotes must be escaped. Without this, a folder/hostname containing an
    apostrophe would break the query (or match the wrong folder).
    """
    return value.replace("\\", "\\\\").replace("'", "\\'")


def _find_folder(service, name: str, parent_id: Optional[str] = None) -> Optional[str]:
    q = [
        "mimeType='application/vnd.google-apps.folder'",
        f"name='{_escape_query_value(name)}'",
        "trashed=false",
    ]
    if parent_id:
        q.append(f"'{parent_id}' in parents")

    res = service.files().list(
        q=" and ".join(q),
        spaces="drive",
        fields="files(id, name)",
        pageSize=10,
    ).execute(num_retries=_NUM_RETRIES)

    files = res.get("files", [])
    if not files:
        return None
    return files[0]["id"]


def _create_folder(service, name: str, parent_id: Optional[str] = None) -> str:
    metadata = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
    }
    if parent_id:
        metadata["parents"] = [parent_id]

    folder = service.files().create(body=metadata, fields="id").execute(
        num_retries=_NUM_RETRIES
    )
    return folder["id"]


def ensure_folder(service, name: str, parent_id: Optional[str] = None) -> str:
    existing = _find_folder(service, name, parent_id)
    if existing:
        return existing
    logger.info(f"Creating Drive folder: {name}")
    return _create_folder(service, name, parent_id)


def get_backup_target_folder(service) -> str:
    root_name = get_drive_root_folder_name()
    root_id = ensure_folder(service, root_name)

    if use_hostname_subfolder():
        host = socket.gethostname()
        host_id = ensure_folder(service, host, root_id)
        return host_id

    return root_id


def upload_snapshot(archive_path: Path, interactive: bool = False) -> str:
    service = get_drive_service(interactive=interactive)
    folder_id = get_backup_target_folder(service)

    media = MediaFileUpload(str(archive_path), mimetype="application/gzip", resumable=True)
    metadata = {
        "name": archive_path.name,
        "parents": [folder_id],
    }

    logger.info(f"Uploading: {archive_path.name}")
    file = service.files().create(
        body=metadata, media_body=media, fields="id, name"
    ).execute(num_retries=_NUM_RETRIES)
    file_id = file["id"]

    logger.info(f"Uploaded to Drive with id: {file_id}")

    retention = get_retention_count()
    if retention and retention > 0:
        try:
            enforce_retention(service, folder_id, keep_last=retention)
        except Exception as e:
            logger.warning(f"Retention enforcement failed (non-fatal): {e}")

    return file_id


def list_backups(service, folder_id: str) -> List[dict]:
    """Return all non-trashed backups in folder_id, newest first (paginated)."""
    files: List[dict] = []
    page_token: Optional[str] = None
    while True:
        req = service.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            spaces="drive",
            fields="files(id, name, createdTime), nextPageToken",
            orderBy="createdTime desc",
            pageSize=200,
            pageToken=page_token,
        )
        res = req.execute(num_retries=_NUM_RETRIES)
        files.extend(res.get("files", []))
        page_token = res.get("nextPageToken")
        if not page_token:
            break
    return files


def enforce_retention(service, folder_id: str, keep_last: int = 30) -> None:
    files = list_backups(service, folder_id)
    if len(files) <= keep_last:
        return

    to_delete = files[keep_last:]
    logger.info(f"Retention: deleting {len(to_delete)} old backup(s).")

    for f in to_delete:
        service.files().delete(fileId=f["id"]).execute(num_retries=_NUM_RETRIES)
