# Dependencies

Rule: **every pi package is pinned to an exact version in `settings.json`.** Copies of this
agent inherit the pin automatically, because the settings file is part of the copy and each
copy has its own `npm/` directory and settings. One agent can therefore be upgraded and
verified without dragging the others along.

Why exact pins, when semver exists: pi packages run as extensions with tool-execution
privileges, and the ledger reads fields the package does not document. Semver protects the
public API, not the internals a meter depends on.

## Pinned

| Package | Pin | Why this is pinned | Internals we depend on |
| --- | --- | --- | --- |
| `pi-web-access` | `0.44.0` | Provides `web_search`, `fetch_content`, `get_search_content`. | `result.details.queries[].provider` and `details.queryCount` are read by the tool meter (`extensions/web-meter`) to price each search per provider. A minor bump may rename them; the meter would keep working but silently fall back to "one query at the default rate". |

Configured as only the built bundle, matching the known-good shape:

```json
{ "source": "npm:pi-web-access@0.44.0", "extensions": ["+dist/index.js"] }
```

`dist/` also contains `mcp-cli.js`, which is a command-line MCP client, not an extension. The
`extensions` filter keeps it out of the agent.

## Upgrading

Do this in one copy first. Never bump the pin in several agents at once.

1. Change the pin in `settings.json`.
2. `PI_CODING_AGENT_DIR=<agent home> pi update --extensions`
3. Probe the contract — run one search and dump `result.details`, confirming
   `queries[].provider` and `queryCount` still exist.
4. `npm test` in the agent home (the meter tests use fixtures shaped from that contract).
5. Update the table above with the new version and any contract change.
6. Keep the previous version here for a one-line rollback.

Rollback is the same procedure with the old pin.

## Adding a package

1. Pin it: `pi install npm:<name>@<exact version>` with `PI_CODING_AGENT_DIR` set, so it lands
   in this agent's own `npm/` and not the main agent's.
2. Add the object form with an `extensions` filter if the package ships more than one entry.
3. Add a row above: what it provides, why it is pinned, which internals our code reads.
