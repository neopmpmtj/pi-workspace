"""
Standalone auth re-authorization script.

This script runs the Google OAuth flow independently of a full backup.
It is used by the dashboard when the user clicks "Re-authorize Google".

Usage:
    python -m backup_PC_tool.auth_cli

The script:
1. Tries to refresh the existing token first
2. If that fails, starts an OAuth flow (browser-based)
3. Saves the new token to the configured token file

Does NOT create a snapshot or upload anything.
"""

import os
import sys
from pathlib import Path

# Make sure the package root is on sys.path for `python -m` usage.
# When run as `python -m backup_PC_tool.auth_cli`, __package__ is
# set to "backup_PC_tool", so we need the parent of the package dir
# on sys.path — not the package dir itself.
_pkg_root = Path(__file__).resolve().parent
_src_root = _pkg_root.parent
if str(_src_root) not in sys.path:
    sys.path.insert(0, str(_src_root))

from backup_PC_tool.auth import GOOGLE_DRIVE_SCOPES
from backup_PC_tool.config import PROJECT_ROOT, get_token_file, get_client_id, get_client_secret
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.exceptions import RefreshError


def _build_client_config():
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


def _token_path():
    return PROJECT_ROOT / get_token_file()


def _save_credentials(creds, token_path):
    token_path.write_text(creds.to_json(), encoding="utf-8")


def main():
    # Print environment info for diagnostics
    print(f"Token file: {_token_path()}", flush=True)
    print(f"DISPLAY: {os.environ.get('DISPLAY', '(not set)')}", flush=True)
    print(f"BROWSER: {os.environ.get('BROWSER', '(not set)')}", flush=True)

    token_path = _token_path()
    creds = None

    # Try loading existing credentials
    if token_path.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(token_path), GOOGLE_DRIVE_SCOPES)
        except Exception as e:
            print(f"Warning: could not load existing token: {e}", flush=True)

    # Try refreshing if expired
    if creds and creds.expired and creds.refresh_token:
        print("Token expired — attempting refresh...", flush=True)
        try:
            creds.refresh(Request())
            _save_credentials(creds, token_path)
            print("Token refreshed successfully.", flush=True)
            print(f"New expiry: {creds.expiry}", flush=True)
            return 0
        except RefreshError as e:
            print(f"Refresh failed: {e}", flush=True)
            print("Will re-authorize from scratch.", flush=True)
        except Exception as e:
            print(f"Refresh failed (unexpected): {e}", flush=True)

    if creds and creds.valid:
        print("Token is still valid — no action needed.", flush=True)
        return 0

    # Full OAuth flow
    print("Starting OAuth authorization flow...", flush=True)
    flow = InstalledAppFlow.from_client_config(_build_client_config(), GOOGLE_DRIVE_SCOPES)

    try:
        creds = flow.run_local_server(port=0)
        _save_credentials(creds, token_path)
        print("Authorization successful!", flush=True)
        print(f"Token saved to: {token_path}", flush=True)
        return 0
    except Exception as e:
        print(f"Browser-based auth failed: {e}", flush=True)
        print("", flush=True)
        print("=" * 60, flush=True)
        print("To authorize manually, run this in your terminal:", flush=True)
        print("=" * 60, flush=True)
        print(f"  cd ~/.pi", flush=True)
        print(f"  BACKUP_INTERACTIVE=1 BROWSER=firefox python3 -m backup_PC_tool.auth_cli", flush=True)
        print("=" * 60, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
