from __future__ import annotations

from pathlib import Path
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from .config import (
    PROJECT_ROOT,
    get_client_id,
    get_client_secret,
    get_service_account_key_path,
    get_token_file,
)


# Least privilege for an app-managed backups folder.
GOOGLE_DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]


class GoogleAuthError(Exception):
    pass


def _token_path() -> Path:
    return PROJECT_ROOT / get_token_file()


def _build_client_config() -> dict:
    return {
        "installed": {
            "client_id": get_client_id(),
            "client_secret": get_client_secret(),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [
                "http://localhost",
                "urn:ietf:wg:oauth:2.0:oob",
            ],
        }
    }


def _load_existing_credentials(token_path: Path) -> Optional[Credentials]:
    if not token_path.exists():
        return None
    try:
        return Credentials.from_authorized_user_file(str(token_path), GOOGLE_DRIVE_SCOPES)
    except Exception:
        return None


def _save_credentials(creds: Credentials, token_path: Path) -> None:
    token_path.write_text(creds.to_json(), encoding="utf-8")


def _build_service_account_credentials(key_path: str) -> Credentials:
    """Create credentials from a service account JSON key file.

    Service accounts never expire, never need browser OAuth, and never need
    token refreshing — ideal for automated (systemd / cron) backups.
    """
    return service_account.Credentials.from_service_account_file(
        key_path, scopes=GOOGLE_DRIVE_SCOPES
    )


def get_drive_credentials(interactive: bool = True) -> Credentials:
    # ── Service account (preferred) ──────────────────────────────────
    sa_key_path = get_service_account_key_path()
    if sa_key_path:
        return _build_service_account_credentials(sa_key_path)

    # ── OAuth fallback ───────────────────────────────────────────────
    token_path = _token_path()
    creds = _load_existing_credentials(token_path)

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            _save_credentials(creds, token_path)
            return creds
        except Exception as e:
            if not interactive:
                raise GoogleAuthError(f"Failed to refresh credentials: {e}") from e

    if not interactive:
        raise GoogleAuthError(
            "No valid credentials available for non-interactive mode. "
            "Run once manually to authorize."
        )

    flow = InstalledAppFlow.from_client_config(_build_client_config(), GOOGLE_DRIVE_SCOPES)
    print("Opening browser for Google authorization...", flush=True)
    print("Make sure you sign in as the correct Google account.", flush=True)
    # Try auto-launch; if it fails, log a clear message so the server can
    # surface it to the user who is already looking at a browser.
    try:
        creds = flow.run_local_server(port=0)
    except Exception as e:
        raise RuntimeError(
            f"Could not open browser: {e}\n"
            f"To authorize manually, run this command on the machine:\n"
            f"  cd {Path.cwd()} && BACKUP_INTERACTIVE=1 BROWSER=firefox "
            f"{__file__}"
        ) from e
    _save_credentials(creds, token_path)
    return creds


def get_drive_service(interactive: bool = True):
    creds = get_drive_credentials(interactive=interactive)
    return build("drive", "v3", credentials=creds)
