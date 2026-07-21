# User Location Context

## Detected Location
- **Country**: Portugal (PT)
- **City**: Vila Real
- **Region**: Vila Real (northern Portugal, Douro region)
- **Coordinates**: ~41.30° N, 7.74° W
- **Timezone**: Europe/Lisbon (WEST, UTC+1 / UTC+0 in winter)
- **ISP**: MEO (Serviços de Comunicações e Multimédia S.A.)

## Detection Methods

The location was inferred using these techniques (all passive, no GPS):

1. **System Timezone** — `timedatectl` revealed `Europe/Lisbon`, which strongly suggests Portugal.
2. **Public IP Geolocation** — `curl -s ipinfo.io` returned approximate city/region/country data based on the public IP address (`37.189.126.15`), confirming Vila Real, PT.
3. **Locale Settings** — `locale` showed `en_US.UTF-8` (language preference only, not location-specific but useful context).

> *Note: IP-based geolocation is approximate (city-level at best). The coordinates above are the geolocation service's estimate and may not be the user's exact position.*


# Secrets Management Rule

All API keys, tokens, credentials, and other secrets **MUST** be stored in `~/.pi/agent/.env` — never in config files directly.

- Pi resolves `$VAR` references in `auth.json` natively (see providers.md: key resolution supports environment variable interpolation).
- A wrapper at `~/.local/bin/pi` sources `.env` with `set -a` before exec'ing the real pi binary, so all env vars are available at runtime.
- When the user needs to add a new provider key, DB password, API token, or any other secret: add it to `~/.pi/agent/.env` and reference it as `$VAR_NAME` in the relevant config file (usually `auth.json`).
- Both `.env` and `auth.json` are in `~/.pi/.gitignore`.
- Remind the user about this pattern whenever adding a new secret comes up.

# CLI Tool Hygiene

- **Skill docs can be stale.** Before using a CLI tool from a skill (e.g., `gog`, `gh`, `yt-dlp`), run `<tool> --help` or `<tool> <subcommand> --help` first to verify subcommands. Skill SKILL.md files were written for an earlier version and may have wrong command names/flags.
- **Pattern:** `tool --help` → verify command → execute. One extra round trip saves two failures.
- Particularly applies to: `gog` (Google Workspace), `gh` (GitHub CLI), any tool installed via Homebrew or npm that auto-updates.


