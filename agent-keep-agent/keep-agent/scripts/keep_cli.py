#!/usr/bin/env python3
"""keep-cli — read every entry in Google Keep from the terminal.

Google has two Keep APIs and only one of them can read a personal @gmail.com account:

| API | Base | Accounts | Read call |
| --- | --- | --- | --- |
| Official "Google Keep API" v1 | https://keep.googleapis.com/v1 | Workspace domains only, service account with domain-wide delegation | `GET /v1/notes` |
| Internal mobile API (the one the Android app uses) | https://www.googleapis.com/notes/v1 | any Google account | `POST /changes` |

This script speaks the **internal** API, because the only account on this machine is a
personal one. Endpoint and payload shapes are taken from gkeepapi (kiwiz/gkeepapi,
`src/gkeepapi/__init__.py`) and gpsoauth (simon-weber/gpsoauth, `gpsoauth/__init__.py`),
which mimic the Android client:

  1. Auth:  POST https://android.clients.google.com/auth
            form fields per gpsoauth.build_oauth_data(): Email, EncryptedPasswd=<master
            token>, service=oauth2:<scopes>, app=com.google.android.keep, client_sig=...
            -> returns `Auth=` (an access token valid for ~1 h)

  2. Read:  POST https://www.googleapis.com/notes/v1/changes
            header  Authorization: OAuth <access token>
            body    {"nodes": [], "clientTimestamp": "<ISO>", "requestHeader": {...},
                     ["targetVersion": "<version>"]}
            -> {"nodes": [...], "userInfo": {"labels": [...]}, "toVersion": "...",
                "truncated": bool}  → repeat with targetVersion=toVersion while truncated

The first auth step needs a **master token** (`aas_et/...`): the long-lived token Android
keeps after you add a Google account. `--login` obtains one from email + password with the
same RSA-OAEP blob the Android client sends (needs the `cryptography` package, and Google
may still refuse it on accounts with 2FA or a captcha challenge).

Flags:
  --read-all-items     read and print every Keep entry (the main command)
  --json               machine-readable output (works with --read-all-items)
  --include-trashed    also show entries in the bin
  --include-archived   also show archived entries (they are shown by default)
  --limit N            stop after N entries
  --login              obtain and store a master token from email + password
  --check              authenticate and print the account's entry count only
  --self-test          offline parser test, no network, no credentials
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
import secrets
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

AUTH_URL = "https://android.clients.google.com/auth"
CHANGES_URL = "https://www.googleapis.com/notes/v1/changes"
CLIENT_SIG = "38918a453d07199354f8b19af05ec6562ced5788"  # com.google.android.keep, from gpsoauth
SCOPES = "oauth2:https://www.googleapis.com/auth/memento https://www.googleapis.com/auth/reminders"
# Public key the Android client encrypts the password with (gpsoauth.B64_KEY_7_3_29).
B64_KEY_7_3_29 = (
    b"AAAAgMom/1a/v0lblO2Ubrt60J2gcuXSljGFQXgcyZWveWLEwo6prwgi3"
    b"iJIZdodyhKZQrNWp5nKJ3srRXcUW+F1BD3baEVGcmEgqaLZUNBjm057pK"
    b"RI16kB0YppeGx5qIQ5QjKzsR8ETQbKLNWgRY0QRNVz34kMJR3P/LgHax/"
    b"6rmf5AAAAAwEAAQ=="
)
TS_FMT = "%Y-%m-%dT%H:%M:%S.%fZ"
CAPABILITIES = ["NC", "PI", "LB", "AN", "SH", "DR", "TR", "IN", "SNB", "MI", "CO"]
CRED_PATH = Path(
    os.environ.get("KEEP_CLI_CREDENTIALS", "~/.config/keep-cli/credentials.json")
).expanduser()


class KeepError(RuntimeError):
    """Anything that stops a read: bad credentials, refused login, API error."""


# --------------------------------------------------------------------------- auth


def _ssl_context():
    """TLS settings gpsoauth uses for android.clients.google.com/auth.

    Google answers `403 BadAuthentication` when a client offers ALPN or disables TLS
    session tickets, so this mirrors gpsoauth: default ciphers, tickets allowed, no ALPN
    (urllib never sets ALPN; OP_NO_TICKET is cleared here).
    """
    ctx = ssl.create_default_context()
    no_ticket = getattr(ssl, "OP_NO_TICKET", 0)
    if no_ticket:
        ctx.options &= ~no_ticket
    ctx.load_default_certs()
    return ctx


def http_post(
    url: str,
    body: bytes,
    headers: dict[str, str],
    timeout: int = 30,
    auth_tls: bool = False,
) -> tuple[int, str]:
    """POST and return (status, body). 4xx/5xx bodies are returned, not raised.

    Google's auth endpoint reports `Error=BadAuthentication` inside a 403 body, so the
    body matters more than the status code.
    """
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    ctx = _ssl_context() if auth_tls else None
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        raise KeepError(f"cannot reach {url}: {exc.reason}") from exc


def form_body(fields: dict[str, str | bytes]) -> bytes:
    """Percent-encode form fields byte for byte.

    The RSA blob in EncryptedPasswd is binary: decoding it to text and letting urlencode
    re-encode it as UTF-8 corrupts it (any byte >= 0x80 changes), and Google answers
    BadAuthentication.
    """
    parts: list[bytes] = []
    for key, val in fields.items():
        raw = val if isinstance(val, bytes) else str(val).encode()
        parts.append(urllib.parse.quote_plus(key.encode()) + "=" + urllib.parse.quote_plus(raw))
    return ("&".join(parts)).encode()


AUTH_ERROR_HINTS = {
    "BadAuthentication": (
        "Google rejected the credentials. Usual causes, in order: the account has "
        "2FA/captcha (password login is refused — use --web-token), wrong password, or "
        "Google blocked 'less secure' login for this account."
    ),
    "NeedsBrowser": "Google wants a browser sign-in for this account — use --web-token.",
    "CaptchaRequired": "Google demands a captcha — use --web-token.",
    "NotVerified": "the account email was never verified.",
    "DeviceManagementRequiredOrSyncDisabled": "the Workspace admin disabled this device.",
    "ServiceDisabled": "the Keep service is not enabled for this account.",
}


def parse_kv(text: str) -> dict[str, str]:
    """gpsoauth.google.parse_auth_response: `Key=value` lines."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        if line:
            key, _, val = line.partition("=")
            out[key] = val
    return out


def _key_from_b64(b64: bytes):
    from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: PLC0415

    binary = base64.b64decode(b64)
    modulus_len = int.from_bytes(binary[:4], "big")
    modulus = int.from_bytes(binary[4 : 4 + modulus_len], "big")
    exp_off = 4 + modulus_len
    exp_len = int.from_bytes(binary[exp_off : exp_off + 4], "big")
    exponent = int.from_bytes(binary[exp_off + 4 : exp_off + 4 + exp_len], "big")
    return rsa.RSAPublicNumbers(exponent, modulus).public_key()


def construct_signature(email: str, password: str) -> bytes:
    """gpsoauth.google.construct_signature: b'\\x00' + sha1(key_struct)[:4] + RSA-OAEP(email\\0pass)."""
    from cryptography.hazmat.primitives import hashes  # noqa: PLC0415
    from cryptography.hazmat.primitives.asymmetric import padding  # noqa: PLC0415

    key = _key_from_b64(B64_KEY_7_3_29)
    numbers = key.public_numbers()
    key_struct = (
        b"\x00\x00\x00\x80"
        + numbers.n.to_bytes((numbers.n.bit_length() + 7) // 8, "big")
        + b"\x00\x00\x00\x03"
        + numbers.e.to_bytes((numbers.e.bit_length() + 7) // 8, "big")
    )
    signature = bytearray(b"\x00")
    signature.extend(hashlib.sha1(key_struct).digest()[:4])
    signature.extend(
        key.encrypt(
            (email + "\x00" + password).encode("utf-8"),
            padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA1()), algorithm=hashes.SHA1(), label=None),
        )
    )
    return bytes(signature)


def auth_request(fields: dict[str, str | bytes]) -> dict[str, str]:
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "GoogleAuth/1.4",
        "Accept-Encoding": "identity",
    }
    status, plain = http_post(AUTH_URL, form_body(fields), headers, auth_tls=True)
    data = parse_kv(plain)
    error = data.get("Error")
    if error and not (data.get("Auth") or data.get("Token")):
        hint = AUTH_ERROR_HINTS.get(error, "")
        raise KeepError(
            f"Google refused the login: Error={error} (HTTP {status})"
            + (f"\n  {hint}" if hint else "")
            + (f"\n  raw: {plain[:200]}" if os.environ.get("KEEP_CLI_DEBUG") else "")
        )
    if not (data.get("Auth") or data.get("Token")):
        raise KeepError(
            f"HTTP {status} from {AUTH_URL} with no token in the response: {plain[:300]}"
        )
    return data


def exchange_master_token(email: str, master_token: str, android_id: str) -> str:
    """gpsoauth.perform_oauth(): master token -> short-lived access token for Keep."""
    data = auth_request(
        {
            "accountType": "HOSTED_OR_GOOGLE",
            "Email": email,
            "has_permission": "1",
            "EncryptedPasswd": master_token,
            "service": SCOPES,
            "source": "android",
            "androidId": android_id,
            "app": "com.google.android.keep",
            "client_sig": CLIENT_SIG,
            "device_country": "us",
            "operatorCountry": "us",
            "lang": "en",
            "sdk_version": "17",
            "google_play_services_version": "240913000",
        }
    )
    token = data.get("Auth") or data.get("Token")
    if not token:
        raise KeepError(f"no access token in the auth response (keys: {sorted(data)})")
    return token


def master_login(email: str, password: str, android_id: str) -> str:
    """gpsoauth.perform_master_login(): what Android does when you add an account."""
    try:
        encrypted = construct_signature(email, password)
    except ImportError as exc:  # pragma: no cover
        raise KeepError(
            "email+password login needs the 'cryptography' package; "
            "otherwise pass a master token with --master-token or $KEEP_MASTER_TOKEN"
        ) from exc
    data = auth_request(
        {
            "accountType": "HOSTED_OR_GOOGLE",
            "Email": email,
            "has_permission": "1",
            "add_account": "1",
            "EncryptedPasswd": encrypted,  # raw bytes: percent-encoded per byte in form_body()
            "service": "ac2dm",
            "source": "android",
            "androidId": android_id,
            "device_country": "us",
            "operatorCountry": "us",
            "lang": "en",
            "sdk_version": "17",
            "google_play_services_version": "240913000",
            "client_sig": CLIENT_SIG,
            "callerSig": CLIENT_SIG,
            "droidguard_results": "dummy123",
        }
    )
    token = data.get("Token") or data.get("Auth")
    if not token:
        raise KeepError(f"no master token in the auth response (keys: {sorted(data)})")
    return token


# ---------------------------------------------------------------------- credentials


def exchange_web_token(email: str, web_token: str, android_id: str) -> str:
    """gpsoauth.exchange_token(): browser oauth_token (oauth2_4/...) -> master token.

    The 2FA-friendly route: sign in at https://accounts.google.com/EmbeddedSetup in a
    browser, copy the `oauth_token` cookie, pass it as --web-token.
    """
    data = auth_request(
        {
            "accountType": "HOSTED_OR_GOOGLE",
            "Email": email,
            "has_permission": "1",
            "add_account": "1",
            "ACCESS_TOKEN": "1",
            "Token": web_token.strip(),
            "service": "ac2dm",
            "source": "android",
            "androidId": android_id,
            "device_country": "us",
            "operatorCountry": "us",
            "lang": "en",
            "sdk_version": "17",
            "google_play_services_version": "240913000",
            "client_sig": CLIENT_SIG,
            "callerSig": CLIENT_SIG,
            "droidguard_results": "dummy123",
        }
    )
    token = data.get("Token") or data.get("Auth")
    if not token:
        raise KeepError(f"no master token in the auth response (keys: {sorted(data)})")
    return token


def load_credentials() -> dict:
    if not CRED_PATH.exists():
        return {}
    try:
        return json.loads(CRED_PATH.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise KeepError(f"cannot read {CRED_PATH}: {exc}") from exc


def save_credentials(data: dict) -> None:
    CRED_PATH.parent.mkdir(parents=True, exist_ok=True)
    CRED_PATH.write_text(json.dumps(data, indent=2) + "\n")
    CRED_PATH.chmod(0o600)


def resolve_credentials(args) -> tuple[str, str, str, dict]:
    """Return (email, master_token, android_id, stored)."""
    stored = load_credentials()
    email = args.email or os.environ.get("KEEP_EMAIL") or stored.get("email")
    token = args.master_token or os.environ.get("KEEP_MASTER_TOKEN") or stored.get("master_token")
    if not email:
        raise KeepError(
            "no account email: pass --email or KEEP_EMAIL, or run `keep-cli --login`"
        )
    android_id = args.android_id or stored.get("android_id") or secrets.token_hex(8)
    if not token:
        raise KeepError(
            f"no master token for {email}: pass --master-token / KEEP_MASTER_TOKEN, "
            "or run `keep-cli --login` once to store one"
        )
    return email, token, android_id, stored


def access_token(email: str, master_token: str, android_id: str, stored: dict) -> str:
    """Reuse a cached access token while it is fresh, else exchange the master token."""
    now = time.time()
    cached = stored.get("access_token")
    if cached and stored.get("email") == email and float(stored.get("access_token_expiry") or 0) > now + 60:
        return cached
    tok = exchange_master_token(email, master_token, android_id)
    stored.update(
        {
            "email": email,
            "android_id": android_id,
            "access_token": tok,
            "access_token_expiry": now + 50 * 60,
        }
    )
    save_credentials(stored)
    return tok


# ------------------------------------------------------------------------ reading


def _iso(ts: float | None = None) -> str:
    return dt.datetime.fromtimestamp(
        time.time() if ts is None else ts, tz=dt.timezone.utc
    ).strftime(TS_FMT)


def changes_once(
    token: str,
    target_version: str | None,
    session_id: str,
    nodes: list[dict] | None = None,
) -> dict:
    """One POST to /changes. `nodes` is how the Android client uploads new/edited notes."""
    payload: dict = {
        "nodes": nodes or [],
        "clientTimestamp": _iso(),
        "requestHeader": {
            "clientSessionId": session_id,
            "clientPlatform": "ANDROID",
            "clientVersion": {"major": "9", "minor": "9", "build": "9", "revision": "9"},
            "capabilities": [{"type": cap} for cap in CAPABILITIES],
        },
    }
    if target_version is not None:
        payload["targetVersion"] = target_version

    body = json.dumps(payload).encode()
    headers = {
        "Authorization": "OAuth " + token,
        "Content-Type": "application/json",
        "User-Agent": "x-gkeepapi-keep-cli",
    }
    for attempt in range(4):
        status, raw = http_post(CHANGES_URL, body, headers)
        try:
            resp = json.loads(raw or "{}")
        except json.JSONDecodeError:
            raise KeepError(f"HTTP {status} from {CHANGES_URL}: {raw[:300]}") from None
        err = resp.get("error")
        if not err:
            return resp
        code = err.get("code")
        if code == 429:  # rate limited: back off and retry
            time.sleep(min(2 ** (attempt + 2), 60))
            continue
        raise KeepError(f"Keep API error {code}: {err.get('message') or err}")
    raise KeepError("Keep API kept returning 429 (rate limited)")


def fetch_raw(token: str, max_pages: int = 200) -> dict:
    """Walk every page of /changes and return the merged node+label view."""
    session_id = "s--%d--%d" % (int(time.time() * 1000), secrets.randbelow(9_000_000_000) + 1_000_000_000)
    version: str | None = None
    nodes: dict[str, dict] = {}
    labels: dict[str, str] = {}
    pages = 0
    while pages < max_pages:
        pages += 1
        resp = changes_once(token, version, session_id)
        if resp.get("forceFullResync"):
            raise KeepError("server demanded a full resync (unexpected for a read-only client)")
        for label in (resp.get("userInfo") or {}).get("labels") or []:
            labels[label.get("id", "")] = label.get("name", "")
        for node in resp.get("nodes") or []:
            nid = node.get("id")
            if not nid:
                continue
            if "parentId" not in node:  # no parentId means "deleted"
                nodes.pop(nid, None)
            else:
                nodes[nid] = node
        version = resp.get("toVersion") or version
        if not resp.get("truncated"):
            break
    return {"nodes": list(nodes.values()), "labels": labels, "pages": pages, "version": version}


# ------------------------------------------------------------------------ writing


def new_id() -> str:
    """Client-assigned node id, in the shape the Android client uses."""
    return "{:x}.{:016x}".format(int(time.time() * 1000), secrets.randbits(64))


def _timestamps(trashed: str | None = None) -> dict:
    now = _iso()
    out = {"kind": "notes#timestamps", "created": now, "updated": now, "userEdited": now}
    if trashed:
        out["trashed"] = trashed
    return out


DEFAULT_SETTINGS = {
    "newListItemPlacement": "BOTTOM",
    "graveyardState": "COLLAPSED",
    "checkedListItemsPolicy": "GRAVEYARD",
}


def build_nodes(
    *,
    title: str = "",
    text: str = "",
    items: list[str] | None = None,
    color: str = "DEFAULT",
    pinned: bool = False,
) -> list[dict]:
    """Payload for /changes: one top-level node plus its LIST_ITEM children.

    Keep stores a note's body as a **child LIST_ITEM**, not on the note; a list is a LIST
    node with one child per row. Field set mirrors gkeepapi's Node.save() /
    TopLevelNode.save() / ListItem.save(), which is what the server accepts.
    """
    sort = secrets.randbelow(9_000_000_000) + 1_000_000_000
    ts = _timestamps()
    note_id = new_id()
    rows = list(items or [])
    if items is None and text:
        rows = [text]
    nodes = [
        {
            "id": note_id,
            "kind": "notes#node",
            "type": "LIST" if items is not None else "NOTE",
            "parentId": "root",
            "sortValue": sort,
            "text": "",
            "timestamps": ts,
            "nodeSettings": dict(DEFAULT_SETTINGS),
            "annotationsGroup": {"kind": "notes#annotationsGroup"},
            "color": color,
            "isArchived": False,
            "isPinned": pinned,
            "title": title,
            "collaborators": [],
        }
    ]
    for offset, row in enumerate(rows, 1):
        nodes.append(
            build_item_node(
                text=row,
                parent_id=note_id,
                parent_server_id=None,  # null for a brand-new list, as gkeepapi sends
                sort=sort + offset,
                timestamps=dict(ts),
            )
        )
    return nodes


def build_item_node(
    *,
    text: str,
    parent_id: str,
    parent_server_id: str | None,
    sort: int,
    timestamps: dict | None = None,
    checked: bool = False,
) -> dict:
    """One LIST_ITEM row, in the exact shape the server accepts.

    `superListItemId` must be null: an empty string is answered with `500 Unknown Error`.
    For a row appended to an *existing* list, gkeepapi sends that list's serverId as
    `parentServerId`; for a new list it sends null.
    """
    return {
        "id": new_id(),
        "kind": "notes#node",
        "type": "LIST_ITEM",
        "parentId": parent_id,
        "sortValue": sort,
        "text": text,
        "timestamps": timestamps or _timestamps(),
        "nodeSettings": dict(DEFAULT_SETTINGS),
        "annotationsGroup": {"kind": "notes#annotationsGroup"},
        "parentServerId": parent_server_id,
        "superListItemId": None,
        "checked": checked,
    }


def append_items(list_raw: dict, rows: list[str], existing: list[dict]) -> list[dict]:
    """New rows for an existing list, sorted after the last one."""
    sorts = [int(item.get("sortValue") or 0) for item in existing] or [0]
    sort = max(sorts)
    return [
        build_item_node(
            text=row,
            parent_id=list_raw["id"],
            parent_server_id=list_raw.get("serverId"),
            sort=sort + offset,
        )
        for offset, row in enumerate(rows, 1)
    ]


def set_checked(token: str, raw_item: dict, checked: bool) -> dict:
    """Tick or untick one row. Bumps updated/userEdited like the app does."""
    now = _iso()
    ts = dict(raw_item.get("timestamps") or {})
    ts["updated"] = now
    ts["userEdited"] = now
    return push_nodes(token, [canonical_node(raw_item, timestamps=ts, checked=checked)])


CANONICAL_TS_KEYS = {"kind", "created", "updated", "userEdited", "trashed", "deleted"}


def canonical_node(raw: dict, **overrides) -> dict:
    """Rebuild a fetched node the way gkeepapi serialises it, for sending an edit back."""
    node: dict = {
        "id": raw["id"],
        "kind": "notes#node",
        "type": raw["type"],
        "parentId": raw["parentId"],
        "sortValue": int(raw.get("sortValue") or 0),
        "text": raw.get("text", ""),
        "timestamps": {k: v for k, v in (raw.get("timestamps") or {}).items() if k in CANONICAL_TS_KEYS},
        "nodeSettings": dict(raw.get("nodeSettings") or DEFAULT_SETTINGS),
        "annotationsGroup": {"kind": "notes#annotationsGroup"},
    }
    if raw.get("type") in {"NOTE", "LIST"}:
        node.update(
            {
                "color": raw.get("color", "DEFAULT"),
                "isArchived": bool(raw.get("isArchived")),
                "isPinned": bool(raw.get("isPinned")),
                "title": raw.get("title", ""),
                "collaborators": [],
            }
        )
        if raw.get("labelIds"):
            node["labelIds"] = raw["labelIds"]
    if raw.get("type") == "LIST_ITEM":
        node.update(
            {
                "checked": bool(raw.get("checked")),
                "superListItemId": raw.get("superListItemId") or None,
                "parentServerId": raw.get("parentServerId") or None,
            }
        )
    if raw.get("serverId"):
        node["serverId"] = raw["serverId"]
    if raw.get("baseVersion"):
        node["baseVersion"] = raw["baseVersion"]
    node.update(overrides)
    return node


def push_nodes(token: str, nodes: list[dict]) -> dict:
    """Upload new or edited nodes through /changes (the only write path this client uses)."""
    session_id = "s--%d--%d" % (int(time.time() * 1000), secrets.randbelow(9_000_000_000) + 1_000_000_000)
    return changes_once(token, None, session_id, nodes)


def set_trashed(token: str, raw_node: dict, trashed: bool) -> dict:
    """Trash or restore a node. Trashing is what Keep's bin holds; nothing is destroyed."""
    ts = dict(raw_node.get("timestamps") or {})
    ts["trashed"] = _iso() if trashed else "1970-01-01T00:00:00.000000Z"
    return push_nodes(token, [canonical_node(raw_node, timestamps=ts)])


# ------------------------------------------------------------------------ parsing


def _when(raw_timestamps: dict, *names: str) -> str | None:
    for name in names:
        val = raw_timestamps.get(name)
        if val and not val.startswith("1970-01-01"):
            return val
    return None


def _sort_key(node: dict):
    try:
        return int(node.get("sortValue") or 0)
    except (TypeError, ValueError):
        return 0


def parse_entries(raw: dict, include_trashed: bool = False, include_archived: bool = True) -> list[dict]:
    """Turn the raw node list into one record per note/list."""
    labels = raw.get("labels") or {}
    nodes = raw.get("nodes") or []
    by_id = {n["id"]: n for n in nodes if "id" in n}
    children: dict[str, list[dict]] = {}
    for node in nodes:
        parent = node.get("parentId")
        if parent and node.get("type") in {"LIST_ITEM", "BLOB"}:
            children.setdefault(parent, []).append(node)

    entries: list[dict] = []
    for node in nodes:
        if node.get("type") not in {"NOTE", "LIST"}:
            continue  # child items and blobs are folded into their parent
        if node.get("parentId") != "root":
            continue
        ts = node.get("timestamps") or {}
        trashed = _when(ts, "trashed") is not None
        deleted = _when(ts, "deleted") is not None
        if deleted or (trashed and not include_trashed):
            continue
        archived = bool(node.get("isArchived"))
        if archived and not include_archived:
            continue

        items = sorted(children.get(node["id"], []), key=_sort_key)
        body_parts: list[str] = []
        list_items: list[dict] = []
        for item in items:
            if item.get("type") != "LIST_ITEM":
                continue
            text = item.get("text") or ""
            entry = {"id": item.get("id", ""), "text": text,
                     "checked": bool(item.get("checked")),
                     "indented": bool(item.get("superListItemId"))}
            list_items.append(entry)
            if text:
                body_parts.append(text)
        blobs = [
            {
                "type": (b.get("blob") or {}).get("type"),
                "mimetype": (b.get("blob") or {}).get("mimetype"),
            }
            for b in items
            if b.get("type") == "BLOB"
        ]
        annotations = []
        for ann in ((node.get("annotationsGroup") or {}).get("annotations") or []):
            link = ann.get("webLink") or {}
            if link.get("url"):
                annotations.append({"url": link["url"], "title": link.get("title")})

        entries.append(
            {
                "id": node["id"],
                "kind": "note" if node.get("type") == "NOTE" else "list",
                "title": node.get("title") or "",
                "text": "\n".join(body_parts),
                "items": list_items if node.get("type") == "LIST" else [],
                "labels": [labels.get(lid, lid) for lid in node.get("labelIds") or []],
                "color": node.get("color"),
                "pinned": bool(node.get("isPinned")),
                "archived": archived,
                "trashed": trashed,
                "created": _when(ts, "created"),
                "updated": _when(ts, "updated"),
                "attachments": blobs,
                "links": annotations,
            }
        )
    entries.sort(key=lambda e: (e.get("updated") or ""), reverse=True)
    return entries


# ----------------------------------------------------------------------- rendering


COLORS = {
    "default": "DEFAULT", "white": "DEFAULT", "red": "RED", "orange": "ORANGE",
    "yellow": "YELLOW", "green": "GREEN", "teal": "TEAL", "blue": "BLUE",
    "darkblue": "CERULEAN", "dark_blue": "CERULEAN", "cerulean": "CERULEAN",
    "purple": "PURPLE", "pink": "PINK", "brown": "BROWN", "gray": "GRAY", "grey": "GRAY",
}


def select_entries(entries: list[dict], selector: str) -> list[dict]:
    """Pick an entry by node id (full or prefix) or by 1-based position `#3`."""
    if not entries:
        raise KeepError("there are no entries to select from")
    if selector.startswith("#"):
        try:
            idx = int(selector[1:])
        except ValueError:
            raise KeepError(f"bad selector {selector!r}: use a node id or #1, #2, ...") from None
        if not 1 <= idx <= len(entries):
            raise KeepError(f"{selector} is out of range: {len(entries)} entries")
        return [entries[idx - 1]]
    hits = [e for e in entries if e["id"] == selector] or [
        e for e in entries if e["id"].startswith(selector)
    ]
    if not hits:
        raise KeepError(f"no entry with id {selector}")
    if len(hits) > 1:
        raise KeepError(f"id prefix {selector} matches {len(hits)} entries; use more characters")
    return hits


def entry_summary(entry: dict) -> str:
    bits = [entry["kind"], entry["title"] or "(untitled)", entry["id"]]
    if entry["trashed"]:
        bits.append("trashed")
    return " · ".join(bits)


def find_entry(entries: list[dict], selector: str) -> dict:
    """Resolve an entry by #index, node id/prefix, or (unique) title."""
    try:
        return select_entries(entries, selector)[0]
    except KeepError:
        pass
    needle = selector.strip().lower()
    hits = [e for e in entries if (e["title"] or "").strip().lower() == needle]
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        raise KeepError(f"{len(hits)} entries are titled {selector!r}; use a node id or #index")
    partial = [e for e in entries if needle and needle in (e["title"] or "").lower()]
    if len(partial) == 1:
        return partial[0]
    raise KeepError(f"no entry matches {selector!r}")


def select_row(entries: list[dict], selector: str) -> tuple[dict, dict]:
    """Resolve one checkbox row.

    `#2:3` = row 3 of entry 2 · `Groceries:2` = row 2 of that list · `#2` = its first row ·
    a bare row id (or prefix) also works, as printed by `--rows`.
    """
    if ":" in selector:
        entry_part, _, row_part = selector.rpartition(":")
        entry = find_entry(entries, entry_part or "#1")
        rows = entry["items"]
        if not rows:
            raise KeepError(f"{entry['title'] or entry['id']} has no checkbox rows")
        try:
            idx = int(row_part)
        except ValueError:
            raise KeepError(f"bad row number {row_part!r}: use {entry_part}:1, :2, ...") from None
        if not 1 <= idx <= len(rows):
            raise KeepError(f"{entry['title'] or entry['id']} has {len(rows)} row(s); {idx} is out of range")
        return entry, rows[idx - 1]

    row_hits = [(e, i) for e in entries for i in e["items"]
                if i["id"] == selector or (i["id"] and i["id"].startswith(selector))]
    if len(row_hits) == 1:
        return row_hits[0]
    if len(row_hits) > 1:
        raise KeepError(f"row id prefix {selector} matches {len(row_hits)} rows; use more characters")

    entry = find_entry(entries, selector)
    if not entry["items"]:
        raise KeepError(f"{entry['title'] or entry['id']} has no checkbox rows")
    return entry, entry["items"][0]


def render_rows(entries: list[dict]) -> str:
    out: list[str] = []
    count = 0
    for number, entry in enumerate(entries, 1):
        for row_number, item in enumerate(entry["items"], 1):
            count += 1
            out.append(
                f"#{number}:{row_number}  {'[x]' if item['checked'] else '[ ]'} {item['text']}"
                f"   ({entry['title'] or 'untitled'})  {item['id']}"
            )
    if not count:
        return "no checkbox rows"
    return "\n".join(out) + f"\n\n{count} row(s) · address them as #entry:row, e.g. --check=#1:2"


def render_text(entries: list[dict], show_trashed: bool) -> str:
    if not entries:
        return "no entries"
    out: list[str] = []
    for i, entry in enumerate(entries, 1):
        flags = []
        if entry["pinned"]:
            flags.append("pinned")
        if entry["archived"]:
            flags.append("archived")
        if entry["trashed"]:
            flags.append("trashed")
        if entry["labels"]:
            flags.append("labels: " + ", ".join(entry["labels"]))
        if entry["attachments"]:
            flags.append("attachments: " + ", ".join(
                str(a.get("mimetype") or a.get("type")) for a in entry["attachments"]))
        if entry["links"]:
            flags.append("links: " + ", ".join(link["url"] for link in entry["links"]))
        head = f'[{i}] {entry["kind"].upper():4}  "{entry["title"] or "(untitled)"}"'
        meta = "  ".join(
            x for x in [entry.get("updated") or "", ", ".join(flags)] if x
        )
        out.append(head + ("   " + meta if meta else ""))
        if entry["kind"] == "list" and entry["items"]:
            for item in entry["items"]:
                out.append(
                    "      " + ("  " if item["indented"] else "")
                    + ("[x] " if item["checked"] else "[ ] ")
                    + item["text"]
                )
        elif entry["text"]:
            for line in entry["text"].splitlines():
                out.append("      " + line)
        out.append("")
    header = f"{len(entries)} entr{'y' if len(entries) == 1 else 'ies'}"
    if show_trashed:
        header += f" ({sum(1 for e in entries if e['trashed'])} trashed)"
    out.insert(0, header + ":")
    out.insert(1, "")
    return "\n".join(out).rstrip() + "\n"


# ----------------------------------------------------------------------- self test


FIXTURE = {
    "labels": {"lab-1": "home"},
    "nodes": [
        {"id": "root", "parentId": None, "type": "ROOT", "timestamps": {}},
        {
            "id": "n1", "parentId": "root", "type": "NOTE", "kind": "notes#node",
            "title": "Router PIN", "color": "WHITE", "isPinned": True,
            "labelIds": ["lab-1"], "sortValue": "100",
            "timestamps": {"created": "2026-11-01T10:00:00.000000Z",
                           "updated": "2026-11-02T11:00:00.000000Z"},
            "annotationsGroup": {"annotations": [
                {"webLink": {"url": "https://example.test/router", "title": "router"}}]},
        },
        {
            "id": "n1-body", "parentId": "n1", "type": "LIST_ITEM", "kind": "notes#node",
            "text": "1234#aaaa", "sortValue": "101",
            "timestamps": {"updated": "2026-11-02T11:00:00.000000Z"},
        },
        {
            "id": "n2", "parentId": "root", "type": "LIST", "kind": "notes#node",
            "title": "Groceries", "isArchived": True, "sortValue": "200",
            "timestamps": {"created": "2026-11-03T09:00:00.000000Z",
                           "updated": "2026-11-04T09:30:00.000000Z"},
        },
        {"id": "n2-i1", "parentId": "n2", "type": "LIST_ITEM", "text": "milk",
         "checked": False, "sortValue": "201",
         "timestamps": {"updated": "2026-11-04T09:30:00.000000Z"}},
        {"id": "n2-i2", "parentId": "n2", "type": "LIST_ITEM", "text": "eggs",
         "checked": True, "sortValue": "202",
         "timestamps": {"updated": "2026-11-04T09:30:00.000000Z"}},
        {
            "id": "n3", "parentId": "root", "type": "NOTE", "title": "old junk",
            "sortValue": "300",
            "timestamps": {"created": "2026-10-01T00:00:00.000000Z",
                           "updated": "2026-10-02T00:00:00.000000Z",
                           "trashed": "2026-10-03T00:00:00.000000Z"},
        },
    ],
}


def self_test() -> int:
    live = parse_entries(FIXTURE, include_trashed=False)
    names = [e["title"] for e in live]
    checks = [
        ("two live entries", len(live) == 2),
        ("newest first", names == ["Groceries", "Router PIN"]),
        ("note body from child LIST_ITEM", live[1]["text"] == "1234#aaaa"),
        ("label resolved to name", live[1]["labels"] == ["home"]),
        ("pinned flag", live[1]["pinned"] is True),
        ("list items, checked state", [i["checked"] for i in live[0]["items"]] == [False, True]),
        ("archived flag", live[0]["archived"] is True),
        ("web link kept", live[1]["links"] == [{"url": "https://example.test/router", "title": "router"}]),
        ("trashed hidden by default", all(e["title"] != "old junk" for e in live)),
        ("trashed shown on request",
         any(e["title"] == "old junk" for e in parse_entries(FIXTURE, include_trashed=True))),
        ("render has checkbox lines", "[ ] milk" in render_text(live, False)),
    ]

    # Write path: the payloads the server accepts, checked without any network.
    note_nodes = build_nodes(title="Test", text="body line", color="YELLOW", pinned=True)
    top, child = note_nodes[0], note_nodes[1]
    list_nodes = build_nodes(title="Groceries", items=["milk", "eggs"])
    raw_note = next(n for n in FIXTURE["nodes"] if n["id"] == "n1")
    edited = canonical_node(raw_note, timestamps={**raw_note["timestamps"],
                                                 "trashed": "2026-11-06T00:00:00.000000Z"})
    checks += [
        ("note payload has note + one body row", [n["type"] for n in note_nodes] == ["NOTE", "LIST_ITEM"]),
        ("body row points at the note", child["parentId"] == top["id"]),
        ("note body lives on the row, not the note", top["text"] == "" and child["text"] == "body line"),
        ("colour and pin carried", top["color"] == "YELLOW" and top["isPinned"] is True),
        ("timestamps and settings present",
         set(top["timestamps"]) >= {"created", "updated"}
         and set(top["nodeSettings"]) == {"newListItemPlacement", "graveyardState", "checkedListItemsPolicy"}),
        ("list payload has a row per item",
         list_nodes[0]["type"] == "LIST" and [n["text"] for n in list_nodes[1:]] == ["milk", "eggs"]),
        ("list rows are unchecked and parented",
         all(n["checked"] is False and n["parentId"] == list_nodes[0]["id"] for n in list_nodes[1:])),
        ("new rows send null server fields (empty string = API 500)",
         all(n["superListItemId"] is None and n["parentServerId"] is None for n in note_nodes[1:])),
        ("timestamps carry userEdited",
         all("userEdited" in n["timestamps"] for n in note_nodes)),
        ("edit payload keeps the version it edits", "baseVersion" not in edited),  # fixture has none
        ("trash edit sets the trashed stamp", "trashed" in edited["timestamps"]),
        ("selector accepts #1 and id prefix",
         select_entries(live, "#1")[0]["title"] == "Groceries"
         and select_entries(live, "n1")[0]["title"] == "Router PIN"),
        ("row selector #1:2 picks the second row", select_row(live, "#1:2")[1]["text"] == "eggs"),
        ("row selector by list title", select_row(live, "Groceries:1")[1]["text"] == "milk"),
        ("row selector by row id", select_row(live, "n2-i2")[1]["text"] == "eggs"),
        ("row selector defaults to row 1", select_row(live, "Groceries")[1]["text"] == "milk"),
        ("rows render with entry:row addresses", "#1:1  [ ] milk" in render_rows(live)),
        ("appended row carries the list serverId",
         (lambda n: n["parentId"] == "L1" and n["parentServerId"] == "S1"
          and n["superListItemId"] is None and n["sortValue"] == 6
          and n["text"] == "butter" and n["type"] == "LIST_ITEM"
          and n["checked"] is False)(
             append_items({"id": "L1", "serverId": "S1"}, ["butter"], [{"sortValue": "5"}])[0])),
    ]
    failed = 0
    for name, ok in checks:
        print(("PASS  " if ok else "FAIL  ") + name)
        failed += 0 if ok else 1
    print(f"\n{len(checks) - failed}/{len(checks)} checks passed · no network, no credentials used")
    return 1 if failed else 0


# ---------------------------------------------------------------------------- main


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="keep-cli",
        description="Read Google Keep entries from the terminal (personal accounts supported).",
        epilog="first run: keep-cli --login    then: keep-cli --read-all-items",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--read-all-items", action="store_true",
                   help="read every Keep entry and print it")
    p.add_argument("--json", action="store_true", help="JSON output")
    p.add_argument("--include-trashed", action="store_true", help="include bin/trashed entries")
    p.add_argument("--include-archived", action="store_true", default=True,
                   help="include archived entries (default: included)")
    p.add_argument("--no-archived", dest="include_archived", action="store_false",
                   help="hide archived entries")
    p.add_argument("--limit", type=int, default=0, help="print at most N entries")
    p.add_argument("--count", "--status", dest="count_entries", action="store_true",
                   help="authenticate and count entries only (was --check before rows took that flag)")
    p.add_argument("--self-test", action="store_true", help="offline parser test")
    p.add_argument("--login", action="store_true", help="store a master token (password or --web-token)")
    p.add_argument("--web-token", help="browser oauth_token cookie (oauth2_4/...) to exchange in --login")
    p.add_argument("--email", help="Google account email")
    p.add_argument("--password", help="account password (only with --login; prefer the prompt)")
    p.add_argument("--master-token", help="master token (aas_et/...), or set KEEP_MASTER_TOKEN")
    p.add_argument("--android-id", help="16-hex-digit device id (kept stable for the account)")
    p.add_argument("--credentials", help=f"credentials file (default {CRED_PATH})")
    p.add_argument("--raw", action="store_true", help="dump the raw API node payload as JSON")
    p.add_argument("--get", metavar="ID", help="print one entry by node id or #index")
    p.add_argument("--search", metavar="TERM", help="case-insensitive search in titles, text and list rows")
    p.add_argument("--add", metavar="TEXT", help="create a note with this body")
    p.add_argument("--add-list", action="store_true", help="create a list instead of a note")
    p.add_argument("--item", action="append", default=[], metavar="TEXT",
                   help="a list row (repeatable, used with --add-list)")
    p.add_argument("--title", help="title for the new note or list")
    p.add_argument("--color", help="colour: default|red|orange|yellow|green|teal|blue|darkblue|purple|pink|brown|gray")
    p.add_argument("--pin", action="store_true", help="pin the new entry")
    p.add_argument("--dry-run", action="store_true", help="print the API payload and send nothing")
    p.add_argument("--trash", metavar="ID", help="move an entry to the bin (reversible)")
    p.add_argument("--restore", metavar="ID", help="take an entry back out of the bin")
    p.add_argument("--rows", action="store_true", help="list checkbox rows with #entry:row addresses")
    p.add_argument("--item-add", action="append", default=[], metavar="TEXT",
                   help="append a row to an existing list (repeatable); pick the list with --list")
    p.add_argument("--list", metavar="NAME", help="which list: title, node id or #index (default: first list)")
    p.add_argument("--check", metavar="ROW", help="tick a row: #1:2, ListTitle:2, or a row id")
    p.add_argument("--uncheck", metavar="ROW", help="untick a row (same addressing as --check)")
    return p


def main(argv: list[str] | None = None) -> int:
    global CRED_PATH  # noqa: PLW0603
    args = build_parser().parse_args(argv)
    if args.credentials:
        CRED_PATH = Path(args.credentials).expanduser()

    if args.self_test:
        return self_test()

    if args.login or args.web_token:
        try:
            email = (args.email or os.environ.get("KEEP_EMAIL")
                     or input("Google account email: ").strip())
            android_id = args.android_id or load_credentials().get("android_id") or secrets.token_hex(8)
            if args.web_token:
                token = exchange_web_token(email, args.web_token, android_id)
            else:
                password = args.password or __import__("getpass").getpass("Password: ")
                token = master_login(email, password, android_id)
            save_credentials({"email": email, "master_token": token, "android_id": android_id})
            print(f"stored master token for {email} in {CRED_PATH} (mode 600)")
            print("it has full access to the account — treat it like a password")
            # Prove the token now, so a bad one fails here and not on the next read.
            access_token(email, token, android_id, load_credentials())
            print("token verified: an access token was issued")
            return 0
        except KeepError as exc:
            print(f"keep-cli: {exc}", file=sys.stderr)
            return 1
        except KeyboardInterrupt:
            return 130

    if not (args.read_all_items or args.count_entries or args.raw or args.get or args.search
            or args.add or args.add_list or args.trash or args.restore or args.rows
            or args.item_add or args.check or args.uncheck):
        build_parser().print_help()
        return 2

    creating = bool(args.add or args.add_list)
    try:
        color = "DEFAULT"
        if args.color:
            color = COLORS.get(args.color.lower().replace("-", "_").replace(" ", ""))
            if not color:
                raise KeepError(f"unknown colour {args.color!r}; pick one of {', '.join(sorted(COLORS))}")
        new_nodes: list[dict] = []
        if creating:
            if args.add_list and not args.item:
                raise KeepError("--add-list needs at least one --item")
            new_nodes = build_nodes(
                title=args.title or "",
                text=args.add or "",
                items=(args.item if (args.add_list or args.item) else None),
                color=color,
                pinned=args.pin,
            )
            if args.dry_run:
                print(json.dumps({"dry_run": True, "nodes": new_nodes}, indent=2, ensure_ascii=False))
                return 0

        email, master_token, android_id, stored = resolve_credentials(args)
        token = access_token(email, master_token, android_id, stored)

        if creating:
            top = new_nodes[0]
            resp = push_nodes(token, new_nodes)
            pushed = {n.get("id"): n for n in (resp.get("nodes") or [])}
            server_id = (pushed.get(top["id"]) or {}).get("serverId")
            label = "list" if top["type"] == "LIST" else "note"
            detail = f"{len(new_nodes) - 1} row(s)" if top["type"] == "LIST" else f"{len(top['title']) or 0}-char title"
            print(f"created {label}: {top['title'] or '(untitled)'} · id {top['id']}"
                  + (f" · serverId {server_id}" if server_id else "") + f" · {detail}")
            # Confirm it landed, so a silent write failure cannot pass as success.
            seen = [e for e in parse_entries(fetch_raw(token), include_trashed=True)
                    if e["id"] == top["id"]]
            print("verified by re-read" if seen else "warning: created but not visible on re-read")
            return 0

        if args.trash or args.restore:
            selector = args.trash or args.restore
            snapshot = fetch_raw(token)
            matches = select_entries(parse_entries(snapshot, include_trashed=True), selector)
            entry = matches[0]
            raw_node = next(n for n in snapshot["nodes"] if n["id"] == entry["id"])
            set_trashed(token, raw_node, trashed=bool(args.trash))
            print(("trashed " if args.trash else "restored ") + entry_summary(entry))
            return 0

        if args.item_add:
            snapshot = fetch_raw(token)
            live = parse_entries(snapshot, include_trashed=False)
            lists = [e for e in live if e["kind"] == "list"]
            if not lists:
                raise KeepError("there is no list to add rows to; create one with --add-list")
            target = find_entry(lists, args.list) if args.list else lists[0]
            existing = [n for n in snapshot["nodes"] if n.get("parentId") == target["id"]]
            list_raw = next(n for n in snapshot["nodes"] if n["id"] == target["id"])
            nodes = append_items(list_raw, args.item_add, existing)
            if args.dry_run:
                print(json.dumps({"dry_run": True, "nodes": nodes}, indent=2, ensure_ascii=False))
                return 0
            resp = push_nodes(token, nodes)
            landed = [n for n in (resp.get("nodes") or []) if n.get("id") in {x["id"] for x in nodes}]
            print(f"added {len(args.item_add)} row(s) to {target['title'] or target['id']}: "
                  + ", ".join(args.item_add) + (f" · {len(landed)} confirmed" if landed else ""))
            return 0

        if args.check or args.uncheck:
            selector = args.check or args.uncheck
            snapshot = fetch_raw(token)
            entries_all = parse_entries(snapshot, include_trashed=False)
            entry, row = select_row(entries_all, selector)
            raw_item = next((n for n in snapshot["nodes"] if n["id"] == row["id"]), None)
            if raw_item is None:
                raise KeepError(f"row {row['id']} is not in the raw node list")
            set_checked(token, raw_item, checked=bool(args.check))
            print(("checked " if args.check else "unchecked ")
                  + f"{row['text']} · {entry['title'] or entry['id']}")
            return 0

        raw = fetch_raw(token)
        if args.raw:
            print(json.dumps(raw, indent=2))
            return 0
        entries = parse_entries(
            raw,
            include_trashed=args.include_trashed or bool(args.get or args.search or args.trash),
            include_archived=args.include_archived,
        )
        if args.search:
            needle = args.search.lower()
            entries = [e for e in entries
                       if needle in e["title"].lower() or needle in e["text"].lower()
                       or any(needle in i["text"].lower() for i in e["items"])]
            if not entries:
                print(f"no entries matching {args.search!r}", file=sys.stderr)
                return 1
        if args.rows:
            if args.list:
                entries = [find_entry(entries, args.list)]
            print(render_rows(entries))
            return 0
        if args.get:
            entries = select_entries(entries, args.get)
        if args.limit:
            entries = entries[: args.limit]
        if args.count_entries:
            print(f"{email}: {len(entries)} live entries, {raw['pages']} page(s), version {raw['version']}")
            return 0
        if args.json:
            print(json.dumps(
                {"account": email, "count": len(entries), "entries": entries}, indent=2, ensure_ascii=False))
        else:
            sys.stdout.write(render_text(entries, args.include_trashed))
        return 0
    except KeepError as exc:
        print(f"keep-cli: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
