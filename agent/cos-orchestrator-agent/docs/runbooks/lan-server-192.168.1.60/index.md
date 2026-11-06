# LAN server `192.168.1.60` — runbook cluster

One folder per machine/topic cluster. Everything here documents the desktop at
`192.168.1.60` (`pmpmt-B550-AORUS-ELITE-V2`, Ubuntu 24.04.4): SSH access, storage, pi, and the GPU.

| Runbook | Covers | Status |
| --- | --- | --- |
| `lan-pmpmt-ssh-key.md` | SSH key for `pmpmt@192.168.1.60`: generation, `~/.ssh/config` alias `lan-pmpmt`, append-only install via `pistore`, revoke | done 2025-11-03 |
| `lan-file-server-ssh-setup.md` | SSH key → working storage on the file server: steps A–D, troubleshooting, `pistore` sudo policy (origin of `lan-agent`) | done 2025-11-03 |
| `lan-server-full-access-and-local-agent.md` | Full access to the server, file organisation, local Pi agent plan: phases, GPU diagnosis, safeguards | plan |
| `server-pi-install.md` | Install pi 1.4.0 + node for `pmpmt`: three traps, credential indirection, verification | done 2025-11-03 |
| `rtx3060-ollama-server-install.md` | Ollama 0.40.14 on the RTX 3060: driver diagnosis + fix, weights on `/home`, install, pull, verify, open items | done 2025-11-04 |

Related machine facts live in `/home/pmpmt/AGENTS.md` (untracked, host-only).

New runbooks about this host go in this folder; runbooks about other hosts or topics get their own
subfolder beside it.
