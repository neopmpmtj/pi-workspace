# Runbook: SSH key for `pmpmt@192.168.1.60` (LAN file server)

Status: **done 2025-11-03**. Key generated, installed, verified.
Related (same folder): `lan-file-server-ssh-setup.md` (the `pistore`/storage identity), `lan-server-full-access-and-local-agent.md`.

## Why

The agent had only the `pistore` identity on that box (`lan-storage`). `pistore` cannot read
`/home/pmpmt` (`drwxr-x--- pmpmt:pmpmt`), so `/home/pmpmt/Downloads` was `Permission denied`.
A second, admin-side identity was needed to inspect and organise `pmpmt`'s files.

## What exists now

| Item | Value |
| --- | --- |
| Private key | `~/.ssh/id_ed25519_lan-pmpmt` (ed25519, KDF rounds 100, **no passphrase**) |
| Public key | `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP1PRXaLXdoFXMq77x//doJzGe/S4cNelmJh15gqG9vm pi-cos@pmpmt-ThinkPad-T15-Gen-2i` |
| Fingerprint | `SHA256:nWSWcqS8+U4qYBYSNR072ggdBU3fRe6dlK/fLxtdOzg` |
| SSH alias | `lan-pmpmt` → `192.168.1.60`, User `pmpmt`, IdentitiesOnly yes |
| Target authorized_keys | `/home/pmpmt/.ssh/authorized_keys` (mode 600, owner `pmpmt`) — **appended**, existing `utter-it droplet` key preserved |
| Public key security | appended with `sudo` **over SSH** via the `pistore` identity, which has `NOPASSWD: ALL` on that host |

`sshd` has `AllowUsers pmpmt pistore` and `PermitRootLogin no` — both accounts are permitted, root is not.

## Recreate / repeat from scratch

```bash
# 1. key (no passphrase so unattended automation works)
ssh-keygen -t ed25519 -a 100 -N "" \
  -C "pi-cos@$(hostname)" -f ~/.ssh/id_ed25519_lan-pmpmt

# 2. alias
cat >> ~/.ssh/config <<'EOF'

Host lan-pmpmt
  HostName 192.168.1.60
  User pmpmt
  IdentityFile ~/.ssh/id_ed25519_lan-pmpmt
  IdentitiesOnly yes
  ServerAliveInterval 30
  ServerAliveCountMax 3
  Compression no
EOF

# 3. install the public key — idempotent, append-only, via pistore's NOPASSWD sudo
KEY="$(cat ~/.ssh/id_ed25519_lan-pmpmt.pub)"
ssh lan-storage "sudo -n bash -c '
  install -d -m 700 -o pmpmt -g pmpmt /home/pmpmt/.ssh
  touch /home/pmpmt/.ssh/authorized_keys
  chown pmpmt:pmpmt /home/pmpmt/.ssh/authorized_keys
  chmod 600 /home/pmpmt/.ssh/authorized_keys
  grep -qF \"$KEY\" /home/pmpmt/.ssh/authorized_keys || printf \"%s\n\" \"$KEY\" >> /home/pmpmt/.ssh/authorized_keys
  chmod go-w /home/pmpmt'"

# 4. verify
ssh -o BatchMode=yes lan-pmpmt 'id; ls -d ~/Downloads'
```

If `pistore` ever loses passwordless sudo, the fallback is on the server console as `pmpmt`:
`cat >> ~/.ssh/authorized_keys` with the one-line public key (then `chmod 600`, `chmod go-w ~`).

## Revoke

```bash
ssh lan-storage "sudo -n sed -i '/pi-cos@pmpmt-ThinkPad-T15-Gen-2i/d' /home/pmpmt/.ssh/authorized_keys"
rm ~/.ssh/id_ed25519_lan-pmpmt ~/.ssh/id_ed25519_lan-pmpmt.pub
```

## Use

```bash
ssh lan-pmpmt                                  # interactive
ssh lan-pmpmt 'ls -la ~/Downloads'             # one command
rsync -a --dry-run lan-pmpmt:Downloads/ ./    # inspect before copying
```

Two identities, deliberately split: `lan-storage` (`pistore`, storage + NOPASSWD sudo) and
`lan-pmpmt` (`pmpmt`, home/data access, no passwordless sudo). Neither key has a passphrase —
whoever reads `~/.ssh/` gets both, so the laptop's `~/.ssh` permissions are the real boundary.

## Caveat for lan-agent

`lan-agent`'s config (`~/.pi/agent-lan-agent/lan-agent/config/storage.json`) is pinned to
`user: pistore`, `remoteRoot: /home/pistore/storage`. Its `/storage` commands still cannot see
`/home/pmpmt`. `pmpmt`-side work goes through plain `ssh lan-pmpmt` (as above) until either
`storage.json` is repointed at `lan-pmpmt` or the wanted files are copied under the storage root.
