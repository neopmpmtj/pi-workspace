from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List

from dotenv import load_dotenv


# Package directory (src/backup_PC_tool)
PROJECT_ROOT = Path(__file__).resolve().parent
CONFIG_PATH = PROJECT_ROOT / "backup_config.json"


class ConfigError(Exception):
    pass


def _parse_bool_env(raw: str | None, default: bool) -> bool:
    if raw is None or not str(raw).strip():
        return default
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


def load_config() -> Dict[str, Any]:
    load_dotenv(Path.home() / ".pi" / "agent" / ".env")

    if not CONFIG_PATH.exists():
        raise ConfigError(
            f"Config file not found: {CONFIG_PATH}. "
            "Create it based on backup_config.json.example.json in the package directory, "
            "and set OAuth credentials in ~/.pi/agent/.env (see .env.example)."
        )

    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

    if "blacklist" not in data:
        raise ConfigError("Missing key in config: blacklist")
    if not isinstance(data["blacklist"], list):
        raise ConfigError("'blacklist' must be a list.")

    extra_includes = data.get("extra_includes", [])
    if not isinstance(extra_includes, list):
        raise ConfigError("'extra_includes' must be a list of paths.")

    client_id = (os.environ.get("GOOGLE_CLIENT_ID") or "").strip()
    client_secret = (os.environ.get("GOOGLE_CLIENT_SECRET") or "").strip()
    if not client_id or not client_secret:
        raise ConfigError(
            "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in "
            "~/.pi/agent/.env (see .env.example)."
        )

    gdrive_folder = (os.environ.get("GDRIVE_BACKUPS_FOLDER") or "").strip() or "backups"
    token_file = (os.environ.get("TOKEN_FILE") or "").strip() or "gdrive_token.json"
    try:
        retention = int((os.environ.get("RETENTION_COUNT") or "0").strip() or "0")
    except ValueError:
        retention = 0
    use_host = _parse_bool_env(os.environ.get("USE_HOSTNAME_SUBFOLDER"), True)

    return {
        "blacklist": data["blacklist"],
        "extra_includes": extra_includes,
        "GOOGLE_CLIENT_ID": client_id,
        "GOOGLE_CLIENT_SECRET": client_secret,
        "GDRIVE_BACKUPS_FOLDER": gdrive_folder,
        "TOKEN_FILE": token_file,
        "RETENTION_COUNT": retention,
        "USE_HOSTNAME_SUBFOLDER": use_host,
    }


def get_blacklist() -> List[str]:
    return load_config()["blacklist"]


def get_extra_includes() -> List[str]:
    return load_config()["extra_includes"]


def get_token_file() -> str:
    return str(load_config()["TOKEN_FILE"])


def get_retention_count() -> int:
    try:
        return int(load_config().get("RETENTION_COUNT", 0))
    except Exception:
        return 0


def use_hostname_subfolder() -> bool:
    return bool(load_config().get("USE_HOSTNAME_SUBFOLDER", True))


def get_drive_root_folder_name() -> str:
    return str(load_config()["GDRIVE_BACKUPS_FOLDER"])


def get_client_id() -> str:
    return str(load_config()["GOOGLE_CLIENT_ID"])


def get_client_secret() -> str:
    return str(load_config()["GOOGLE_CLIENT_SECRET"])


def get_service_account_key_path() -> str | None:
    """Return the path to the service account JSON key, if configured.

    When set (and the file exists), the backup engine uses a service
    account instead of user OAuth — no browser, no token expiry.

    Safety: if the key was removed from .env but still lingers in the
    process environment (e.g. inherited from a parent process that
    sourced an older .env), treat it as unset.
    """
    raw = (os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY") or "").strip()
    if not raw:
        return None

    # Guard against stale inherited env vars: if the .env file no longer
    # contains this key, don't use it — the user explicitly removed it.
    env_path = Path.home() / ".pi" / "agent" / ".env"
    if env_path.exists():
        env_text = env_path.read_text(encoding="utf-8")
        has_key = any(
            line.strip() and not line.strip().startswith("#")
            and line.strip().startswith("GOOGLE_SERVICE_ACCOUNT_KEY")
            for line in env_text.splitlines()
        )
        if not has_key:
            return None  # explicitly removed from .env — treat as unset

    p = Path(raw).expanduser().resolve()
    return str(p) if p.exists() else None
