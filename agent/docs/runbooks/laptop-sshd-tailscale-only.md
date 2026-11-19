# Laptop sshd, Tailscale-only

**Status 2026-11-19: DONE.** `openssh-server 1:9.6p1-3ubuntu13.20` installed, `ssh.socket`
binds `100.85.248.6:22` only, VPS reaches it (`nc` succeeded — `ufw` did not block
`tailscale0`), the VPS key `id_ed25519_neopmpmtj` is in the laptop's `authorized_keys`,
and `Host laptop` carries `IdentityFile ~/.ssh/id_ed25519_neopmpmtj`. `parity-alert.sh`
now fingerprints the laptop live over that path.

Why: the VPS cannot reach the laptop today (`ssh 100.85.248.6` → port 22 refused; no
`openssh-server` installed). That is the only thing standing between the current
publish-based parity check and a true two-way comparison — the VPS's nightly
`parity-alert.sh` could then fingerprint both hosts itself.

Constraint: **the laptop has no silent root.** Everything below is yours to run; the
agent cannot and should not.

## 1. Install and bind to Tailscale only

`openssh-server` is not installed on the laptop (checked 2026-11-19, Ubuntu 24.04, no
`ssh*` unit files). Ubuntu 24.04 ships sshd **socket-activated**, so the listener is
defined by `ssh.socket`, not by `sshd_config`.

```bash
# install
sudo apt update && sudo apt install -y openssh-server

# bind ONLY to the Tailscale address — never to the LAN or a public interface
sudo mkdir -p /etc/systemd/system/ssh.socket.d
sudo tee /etc/systemd/system/ssh.socket.d/10-tailscale-only.conf >/dev/null <<'EOF'
[Socket]
ListenStream=
ListenStream=100.85.248.6:22
EOF
sudo systemctl daemon-reload
sudo systemctl restart ssh.socket

# keys only, no passwords
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl reload ssh 2>/dev/null || sudo systemctl restart ssh.socket
```

Verify on the laptop:

```bash
ss -ltnp | grep ':22'        # must show 100.85.248.6:22 only
```

## 2. Authorise the VPS key

The VPS already authenticates to the laptop's account name `pmpmt` on GitHub; for ssh it
needs its own public key in `~/.ssh/authorized_keys` here.

```bash
ssh neopmpmtj 'cat ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-add -L | head -1'
# paste that line into the laptop's ~/.ssh/authorized_keys (mode 600, dir 700)
```

## 3. Test from the VPS

An alias is already configured there (`Host laptop` → `100.85.248.6`, user `pmpmt`):

```bash
ssh neopmpmtj 'ssh -o BatchMode=yes laptop "hostname; node -v"'
```

## 4. Then improve the alert (agent follow-up)

Once the VPS can ssh in, `parity-alert.sh` can fingerprint the laptop live instead of
relying on the last published file — no stale-fingerprint caveat, and it works when the
laptop has not run a session for days. That change is small: replace the read of
`agent/tmp/parity/*.fingerprint` with `ssh laptop 'bash ~/.pi/scripts/fingerprint.sh'`,
keeping the published file as a fallback when the laptop is unreachable.

## Rollback

```bash
sudo systemctl disable --now ssh.socket
sudo apt purge -y openssh-server
sudo rm -rf /etc/systemd/system/ssh.socket.d
```

## Security notes

- Binding to the Tailscale IP means the port is not exposed to the LAN (192.168.1.x) or
  the ISP interface, and Tailscale itself is the auth boundary.
- `PasswordAuthentication no` keeps the key as the only entry path.
- The laptop holds `~/.pi/agent/.env` (API keys) and `auth.json`; treat the Tailscale
  tailnet as the trust boundary it is, and review Tailscale ACLs if other devices join.
