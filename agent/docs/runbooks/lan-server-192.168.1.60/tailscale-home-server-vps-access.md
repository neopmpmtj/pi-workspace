# Home server ↔ VPS access over Tailscale

How the VPS reaches the home server at `192.168.1.60` so GPU and long-running jobs can be run
there from a Telegram turn (VPS) or from the laptop. Written 2026-11-25, after the 2026-11-23
reinstall wiped the old Tailscale node.

> **State 2026-11-25:** Tailscale 1.104.7 is installed on the home server, the VPS key
> `vps->home-server` is in its `authorized_keys`, and the `home-server` node is **awaiting the
> one-click login approval** — `tailscale status` still says `Logged out.` until then. The
> `tailscale up` process holds a live URL for 30 minutes; if it dies, re-run the detached
> command below and use the new URL.

## Current facts

| Thing | Value |
| --- | --- |
| Home server | `pmpmt-B550-AORUS-ELITE-V2`, `192.168.1.60` on `eno1`, Ubuntu 24.04.5 LTS, RTX 3060 12 GB, `NOPASSWD: ALL` |
| Home server ssh alias | `lan-pmpmt` (from the laptop) / `home-server` (from the VPS) |
| Home public IP | `37.189.126.15` — MEO, Vila Real. Shared by laptop and home server; behind ISP/router NAT, **no inbound ports**. This is why a VPN is the only sane path. |
| Laptop | `pmpmt-thinkpad-t15-gen-2i` = `100.85.248.6`, tailnet `tailbb6905.ts.net` |
| VPS | `neopmpmtj` = `100.85.79.17`, public `159.65.203.218` |
| Home server (tailnet) | `home-server` — new node, replaces the old `pmpmt-b550-aorus-elite-v2` (100.106.153.120), offline since the reinstall and safe to delete in the admin console |
| VPS→home key | `~/.ssh/id_ed25519_home` on the VPS, `vps->home-server` appended to the home server's `authorized_keys` |

Tailscale is the whole path: there is no port forward, no DDNS, no reverse tunnel. All three
machines sit in one tailnet, so VPS→home and laptop→home work the same way, from any network.

## Install Tailscale on the home server (one time)

```bash
ssh lan-pmpmt 'curl -fsSL https://tailscale.com/install.sh -o /tmp/ts-install.sh && sudo -n sh /tmp/ts-install.sh'
```

Then join the tailnet. `tailscale up` without an auth key prints a login URL and waits; the URL
expires with the process, so run it detached and approve from a phone:

```bash
ssh lan-pmpmt 'sudo -n nohup tailscale up --hostname=home-server --accept-dns=false --timeout=30m > /tmp/ts-up.log 2>&1 &'
ssh lan-pmpmt 'sleep 8; cat /tmp/ts-up.log'      # prints https://login.tailscale.com/a/<id>
```

`--accept-dns=false` is deliberate: the home server keeps its own resolver and only uses
Tailscale for transport.

Verify from the laptop, then from the VPS:

```bash
tailscale status | grep home-server
ssh neopmpmtj 'tailscale status | grep home-server'
```

## Give the VPS a key to the home server

The VPS needs its own key; the laptop's `lan-pmpmt` key stays laptop-only.

```bash
ssh neopmpmtj 'test -f ~/.ssh/id_ed25519_home || ssh-keygen -t ed25519 -N "" -C "vps->home-server" -f ~/.ssh/id_ed25519_home'
ssh neopmpmtj 'cat ~/.ssh/id_ed25519_home.pub'    # copy this single line
ssh lan-pmpmt 'echo "<pubkey line>" >> ~/.ssh/authorized_keys'
```

VPS `~/.ssh/config` — pin the address, MagicDNS does **not** resolve on the VPS (no Tailscale
DNS client there), so the name below is an alias for the numeric tailnet IP:

```
Host home-server
    HostName 100.x.y.z          # home-server's tailnet IPv4
    User pmpmt
    IdentityFile ~/.ssh/id_ed25519_home
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

## Verify

```bash
ssh neopmpmtj 'ssh -o BatchMode=yes home-server "hostname; uptime"'
ssh neopmpmtj 'ssh home-server "nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader"'
ssh neopmpmtj 'ssh home-server "nvidia-smi --query-gpu=memory.used --format=csv,noheader"'
```

A real GPU job, not just `nvidia-smi`:

```bash
ssh neopmpmtj 'ssh home-server "python3 -c \"import torch;print(torch.cuda.is_available(), torch.cuda.get_device_name(0))\" 2>/dev/null || echo no-torch-yet"'
```

## Security notes

- The VPS key lands in an `authorized_keys` whose user has `NOPASSWD: ALL`, so that key is
  effectively root on the home server. That is the intent (the agent runs jobs there), but it
  means the VPS is part of the home server's trust boundary. Revoke by removing the
  `vps->home-server` line.
- `authorized_keys` holds three lines: two laptop keys (`pi-cos@…`, `pi-admin@…`) and
  `vps->home-server`.
- Nothing is exposed publicly: no inbound port on the home router, and Tailscale is the only
  listener change on the home server.

## Traps

| Symptom | Cause / fix |
| --- | --- |
| `tailscale status` → `Logged out.` | The approval was never completed, or the `tailscale up` process was killed (its URL dies with it). Re-run the detached command and use the **new** URL. |
| Login URL shows "invalid" | It belongs to an earlier `tailscale up` run. Only the newest one is valid. |
| Old node still listed offline | The pre-reinstall node `pmpmt-b550-aorus-elite-v2` (100.106.153.120). Delete it in the admin console; it holds the name, not the machine. |
| MagicDNS name does not resolve on the VPS | Expected — use the tailnet IP in `~/.ssh/config`. |
| `ssh home-server` hangs | Check `tailscale status` on the home server; `sudo systemctl status tailscaled`. |
