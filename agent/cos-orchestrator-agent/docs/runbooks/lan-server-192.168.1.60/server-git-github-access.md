# Runbook: git and GitHub access on the LAN server (192.168.1.60)

Probed 2026-11-08, for the workflow "clone a repo on the server, let it use the RTX 3060,
improve it, push back to origin".

## What is in place

| Item | State |
| --- | --- |
| git | `2.43.0` (`/usr/bin/git`) |
| gh CLI | `2.45.0`, logged in as **`neopmpmtj`** (keyring) — scopes `gist, read:org, repo, user, workflow` |
| git identity | `user.name=pmpmtj`, `user.email=pmpmtj@hotmail.com`, `init.defaultbranch=main` |
| SSH → GitHub | works, `ssh -T git@github.com` → `Hi pmpmtj!` — **read-only** on `neopmpmtj/*` repos |
| Keys | `~/.ssh/id_ed25519_github`, `id_ed25519_neo_github`, `id_ed25519_pmpmt_neopmpmtj`, `id_ed25519_contabo` — all four authenticate as GitHub account **`pmpmtj`**, none has a passphrase |
| `~/.ssh/config` | `Host github.com` → `User git`, `IdentityFile ~/.ssh/id_ed25519_github`, `IdentitiesOnly yes` |
| HTTPS remotes | **the working route**: `credential.https://github.com.helper = !/usr/bin/gh auth git-credential`, so HTTPS uses the `neopmpmtj` token. The old `url."git@github.com:".insteadOf` rewrite was **removed** — it forced SSH, and SSH cannot write |
| Disk | `/home` 302 GB free |

Read access is proven: `git clone --depth 1 git@github.com:neopmpmtj/pi-workspace.git` succeeded
from the server. Write access is proven over HTTPS: an empty commit pushed with `--dry-run` to
`refs/heads/pi-agent-probe` returned `* [new branch]` (nothing was created), from a plain shell and
again from a `pi-cloud` chat turn.

## What was wrong, and what fixed it (route B, chosen 2026-11-08)

1. **`gh` had an invalid token.** `gh auth status` reported `Failed to log in ... (keyring) — The
   token in keyring is invalid`. The laptop's `neopmtj` token was installed on the server; the
   broken `pmpmtj` entry was logged out:
   ```bash
   gh auth token | ssh lan-pmpmt 'gh auth login --with-token -h github.com'
   ssh lan-pmpmt 'gh auth logout -h github.com -u pmpmtj'
   ssh lan-pmpmt 'gh auth setup-git --hostname github.com'
   ```
2. **The `pmpmtj` SSH key is read-only on `neopmpmtj/*`.** A `git push --dry-run` over SSH
   returned `ERROR: Permission to neopmpmtj/pi-workspace.git denied to pmpmtj`. Since a token can
   only ride on HTTPS, the `url."git@github.com:".insteadOf` rewrite set earlier the same day was
   removed:
   ```bash
   ssh lan-pmpmt 'git config --global --unset url.git@github.com:.insteadOf'
   ```

Final shape: **gh + HTTPS for GitHub, SSH still fine for reading and for other hosts.**

| Check | Result |
| --- | --- |
| `gh auth status` | `neopmpmtj`, active, protocol https |
| `gh api user --jq .login` | `neopmpmtj` |
| `git clone https://github.com/neopmpmtj/pi-workspace.git` | ok |
| `git push --dry-run origin HEAD:refs/heads/pi-agent-probe` | `* [new branch]` (write access) |
| same push from a `pi-cloud` tool call | ok |

## Keeping it alive

- The credential is the laptop's `gho_` OAuth token, stored in the server's keyring. It does not
  refresh; if it is ever revoked (laptop `gh auth logout`, or GitHub *Settings → Applications*),
  re-run the one-liner above from the laptop.
- **Clone with HTTPS or `gh repo clone`, not `git@github.com:`** — SSH is read-only for these repos,
  a `git@` remote will clone and then fail on push.
- Repos under an account where `pmpmtj` *does* have write access would work over SSH as well; the
  current setup simply does not rely on it.
- The `cloud` and `ollama` agents run as `pmpmt /home/pmpmt`, so they inherit the keyring entry,
  `~/.gitconfig` and the keys — no per-agent setup. `GH_TOKEN` is not needed in their `.env`.
- For an HTTPS host other than github.com, set `GIT_TERMINAL_PROMPT=0` in the tool call so a
  credential prompt fails fast instead of hanging.
- A push needs full history, not `--depth 1`.
- Model weights, drivers and Ollama for such a repo are documented in
  `rtx3060-ollama-server-install.md`; the two agents in `two-server-pi-agents.md`.

## Alternatives not taken

**A. Give `pmpmtj` write access** (nothing secret at rest). On GitHub, as `neopmpmtj`: *Settings →
Collaborators → Add people → `pmpmtj` → Write*. Use this if the token ever becomes a nuisance:
```bash
ssh lan-pmpmt 'git config --global --unset credential.https://github.com.helper'
git clone git@github.com:<owner>/<repo>.git && cd <repo> && git push -u origin HEAD
```

**C. Register a second key on the `neopmpmtj` account** and route GitHub through it. Both accounts
would answer to different keys, so `Host github.com` needs a per-repo identity choice; more fragile.
