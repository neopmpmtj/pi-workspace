# lan-agent: calling contract

Contract for sibling agents and scripts calling this one.

## Default call — plain language

```bash
cd ~/.pi/agent-lan-agent/lan-agent && pi-lan-agent -p "<task in plain language> (e.g. Store ~/Videos/movie.mp4 on the file server)"
```

A chat turn, because the work happens in `bash` (`ssh`, `rsync`) and only a chat turn has tools.
Do **not** route storage tasks through `/ask`: `/ask` starts no chat turn, so it has no tools and
can only talk about the server, never touch it.

## Deterministic calls — no model turn, no tokens

```bash
pi-lan-agent -p "/storage check"      # tcp → key auth → write test → df, one line each
pi-lan-agent -p "/storage config"     # effective settings, and which fields are still unset
```

`/storage` is a shell-out to `scripts/storage.sh`; it prints the script's stdout verbatim and
exits non-zero when the script fails. Subcommands:

| Subcommand | Effect |
| --- | --- |
| `config` | show `host`/`user`/`port`/`identityFile`/`remoteRoot`, flag unset fields |
| `use --host <ip> [--user u] [--port p] [--root dir] [--identity f]` | change the config in place, and rewrite the `Host lan-storage` block in `~/.ssh/config` to match |
| `check` | reachability, key-only auth, write test, free space |
| `df` / `ls [sub]` | free space / list a folder under `remoteRoot` |
| `put <local...> [--to sub]` | rsync upload (resumable) |
| `get <sub> <local-dir>` | rsync download |
| `sync <local-dir> <sub> [--delete]` | mirror a local folder |
| `rm <sub...>` | delete inside `remoteRoot`; refuses the root itself |
| `ssh <command...>` / `shell` | run one remote command / interactive shell |

`--dry-run` is accepted by `put`, `get`, `sync`, `rm`.

Exit codes: `0` ok, `1` misuse, `2` config incomplete, `3` TCP unreachable, `4` SSH or write
failure. (Through `/storage` a failure surfaces as a single `[FAIL]` line and exit `1`; the
`2`/`3`/`4` codes are the script's own, visible when calling `scripts/storage.sh` directly.)
Config lives in `config/storage.json`; `REPLACE_...` values count as unset, and the
script refuses to run rather than guessing a host.

## /ask

```bash
pi-lan-agent -p "/ask \"question\""
```

One provider call, no chat turn, no tools, no ledger surprise. Fine for text work only — it
cannot reach the server.

## /usage

```bash
pi-lan-agent -p "/usage"          # last run · --all · --session · <runId>
```
