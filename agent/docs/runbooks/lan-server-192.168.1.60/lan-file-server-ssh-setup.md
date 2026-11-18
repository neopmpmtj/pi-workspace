# Runbook: SSH key → working storage on a LAN file server

Written 2025-11-03. Status: laptop-side key created; `lan-agent` scaffolded with this runbook as
its `docs/SETUP.md` and its own copies of the helper scripts. Server-side steps pending the
server address, box type (Linux / Synology / QNAP / TrueNAS / other), and confirmation of the
username. Steps marked `[DONE]` were executed; the rest are the plan.

The live copy is `~/.pi/agent-lan-agent/lan-agent/docs/SETUP.md` — edit that one; this file is
its origin.

## Facts established

- Laptop keypair: `~/.ssh/id_ed25519_lan-storage` (private, 600) and `.pub`
  - fingerprint `SHA256:QILJBaiLfKIDRBVRLYt8GJkMn6D6tjhtGn22iDfFvow`
  - comment `pi-lan-agent@pmpmt-laptop`, ed25519, `-a 100`, no passphrase (unattended sync)
- Public key to install on the server:
  `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPad7MqJwU088lYvWAGAJZdU8jESqH+B6CRdOnNPQnfZ pi-lan-agent@pmpmt-laptop`
- Laptop LAN: `192.168.1.0/24`, default gateway `192.168.1.254`
- Server: `192.168.1.60`, port 22 open, `SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.20` (Ubuntu
  24.04 LTS), auth methods `publickey,password` (probed 2025-11-03). Linux branch applies.
- `scripts/storage.sh check` in the agent home reaches it and fails at
  `Permission denied (publickey,password)` — the key is not installed for `pistore` yet.
- A DHCP lease can move the address; pin it in the router or use the mDNS name.

## What "only an IP" implies

One interactive login to the box is needed, once. Branch by type:

- Fresh Ubuntu/Debian server → keyboard+monitor, or the installer account (`root` / your user).
- Existing Linux → admin username+password already known.
- NAS (Synology) → web UI admin; Control Panel → Terminal & SNMP → Enable SSH.
- TrueNAS → web UI admin; SSH enabled by default on SCALE.
- Windows → different path, rewrite this runbook.

## Step A — laptop side

A1. Keypair. `[DONE]`

```bash
ssh-keygen -t ed25519 -a 100 -f ~/.ssh/id_ed25519_lan-storage \
  -C "pi-lan-agent@pmpmt-laptop" -N ""
```

A2. Pin the address (router DHCP reservation, or use `<hostname>.local`).

A3. `~/.ssh/config` block. `[DONE]` 2025-11-03 as `Host lan-storage`; the agent's
`scripts/storage.sh use` keeps it in step with its own config.

```sshconfig
Host lan-storage
  HostName 192.168.1.60
  User pistore
  IdentityFile ~/.ssh/id_ed25519_lan-storage
  IdentitiesOnly yes
  ServerAliveInterval 30
  ServerAliveCountMax 3
  Compression no
```

`IdentitiesOnly yes` stops the GitHub key from being offered and tripping the server's
auth-attempt limit.

A4. Install the key (one password prompt):

```bash
ssh-copy-id -i ~/.ssh/id_ed25519_lan-storage.pub pistore@<SERVER_IP>
```

## Step B — server side, as root/admin (one time)

B1. Log in with the admin credential from above.

B2. Unprivileged user, data dir separate from home:

```bash
useradd --create-home --shell /bin/bash pistore
passwd -l pistore          # key-only: no usable password
mkdir -p /srv/pi-storage
chown pistore:pistore /srv/pi-storage
chmod 750 /srv/pi-storage
```

If a password is needed for `pistore`, skip `passwd -l` and keep
`PasswordAuthentication` on until the key is proven.

B3. Install the public key (alternative to A4):

```bash
install -d -m 700 -o pistore -g pistore /home/pistore/.ssh
echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPad7MqJwU088lYvWAGAJZdU8jESqH+B6CRdOnNPQnfZ pi-lan-agent@pmpmt-laptop' \
  > /home/pistore/.ssh/authorized_keys
chown pistore:pistore /home/pistore/.ssh/authorized_keys
chmod 600 /home/pistore/.ssh/authorized_keys
chmod go-w /home/pistore
```

`sshd` refuses keys on a group/world-writable home (`StrictModes`).

B4. Harden sshd — only after a key-only login succeeded once. `/etc/ssh/sshd_config`:

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers pmpmt pistore
```

`AllowUsers` is space-separated; a comma makes it a user named `pmpmt,`. A missing name here
rejects a valid key with no log line at all (seen 2025-11-03: `AllowUsers pmpmt` blocked `pistore`).

then `sshd -t && systemctl reload ssh`. Keep the current admin session open until a new login
is verified — that is the undo.

B5. Disk sanity and reboot survival:

```bash
df -h /srv/pi-storage        # the big filesystem must actually be mounted here
lsblk -f
findmnt /srv/pi-storage      # empty output = on the root fs, not the data disk
```

If it is on the wrong disk, mount the data volume at `/srv/pi-storage` and add it to
`/etc/fstab` by UUID. A mount that exists only until reboot is the usual way this setup
silently loses data.

B6. Prerequisites: `command -v rsync` (install if missing — it is the transfer tool the agent
drives). Optional hard ceiling: mount with `usrquota`, or use a loopback image.

B7. Firewall, LAN only:

```bash
ufw allow from 192.168.1.0/24 to any port 22 proto tcp
ufw status verbose
```

## Step C — verify from the laptop

```bash
ssh -o BatchMode=yes lan-storage 'id && df -h /srv/pi-storage && touch /srv/pi-storage/.write-test && rm /srv/pi-storage/.write-test && echo WRITABLE'
```

`BatchMode=yes` forbids prompts, so a pass proves key-only auth.

```bash
head -c 50M /dev/urandom > /tmp/probe.bin
rsync -av --progress /tmp/probe.bin lan-storage:/srv/pi-storage/probe/
rsync -av lan-storage:/srv/pi-storage/probe/probe.bin /tmp/probe.back
cmp /tmp/probe.bin /tmp/probe.back && echo ROUNDTRIP_OK
```

`cmp` matching is the real test; an `rsync` exit code has lied before.

## Step D — if the server is a NAS

- Synology: Control Panel → Terminal & SNMP → enable SSH; Control Panel → User → create
  `pistore`; Shared Folder `pi-storage` with `pistore` read/write; path `/volume1/pi-storage`.
  B2/B5 change; B3/B4 unchanged.
- TrueNAS SCALE: Credentials → Local Users → add user with the SSH key pasted directly (no
  `authorized_keys` editing), dataset owned by `pistore`; path `/mnt/<pool>/pi-storage`.

## Troubleshooting

### Ladder — go in this order, stop at the first `[FAIL]`

| Step | Command (laptop unless noted) | What it proves |
| --- | --- | --- |
| 1 | `ping -c 2 <IP>` | host exists on the LAN at that address |
| 2 | `nc -z -w 3 <IP> 22` | sshd listening, no firewall in the path |
| 3 | `timeout 4 nc <IP> 22 </dev/null \| head -1` | OS + OpenSSH version, so the right branch of this runbook |
| 4 | `ssh -G lan-storage` | client resolves the alias: host, user, key, port |
| 5 | `ssh -vv -o BatchMode=yes lan-storage 'id -un' 2>&1 \| grep -Ei 'offering\|accepted\|can continue'` | whether the key is offered, and whether sshd likes it |
| 6 | on server: `sudo sshd -T \| grep -Ei 'allowusers\|denyusers\|pubkeyauthentication\|authorizedkeysfile\|strictmodes\|loglevel'` | the rules sshd actually runs with |
| 7 | on server: `ls -ld /home/<user> /home/<user>/.ssh /home/<user>/.ssh/authorized_keys` | ownership and modes (`pistore:pistore`, `.ssh` 700, file 600, home not group-writable) |
| 8 | on server: `ssh-keygen -lf /home/<user>/.ssh/authorized_keys` | the file parses, and its fingerprint matches the key in use |
| 9 | on server: `sudo journalctl -u ssh -n 20 --no-pager` | sshd's own reason, when it logs one |
| 10 | `./scripts/storage.sh check` | the whole chain at once: config → tcp → key auth → write → `df` |

`sshd -T` exit code matters: `0` means the config is valid, non-zero means a reload was never
possible and your edit is not live.

### Seen for real, in order of frequency

**1. `AllowUsers` excludes the new account.** `AllowUsers pmpmt` in `/etc/ssh/sshd_config` blocks
`pistore` and logs **nothing** — `journalctl -u ssh` was empty while steps 2, 3 and 7 all passed.
That silence is the tell: a permission or key-content fault usually gets a log line, an allow-list
rejection often gets none. Fix `AllowUsers pmpmt pistore` (space-separated; a comma defines a user
literally named `pmpmt,`), then `sudo sshd -t && sudo systemctl reload ssh`. Reload, not restart;
the existing session survives.

**2. Empty `authorized_keys` from a missing `echo`.** This looks right and is not:

```bash
ssh-ed25519 AAAA... comment > ~/.ssh/authorized_keys    # runs `ssh-ed25519` as a command
```

The redirect creates the file before the (failed) command runs, so you get a 0-line
`authorized_keys` and no error worth reading. `wc -l` reporting `1` is the distinction between this
and case 3.

**3. Right line, wrong bytes.** CRLF from an editor, a wrapped paste, or typographic quotes.
`ssh-keygen -lf` on the server then either fails to parse or prints a fingerprint that is not the
client's. Compare with `ssh-keygen -lf ~/.ssh/id_ed25519_lan-storage.pub` on the laptop.

**4. Ownership or modes.** `Authentication refused: bad ownership or modes` in the journal.
`chown -R <user>:<user> ~/.ssh`, `chmod 700 ~/.ssh`, `chmod 600 authorized_keys`,
`chmod go-w /home/<user>`.

**5. Address conflict on the target IP.** Every other check can pass while the box answering is a
different machine — the exact scenario when a lease is reused. Prove identity both ways:

```bash
ssh-keyscan -t ed25519 <IP> 2>/dev/null | ssh-keygen -lf -      # from the laptop
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub                # on the server being edited
```

Different fingerprints = different machines. Fix the address in the client's config, not the
server.

**6. Second sshd or a container bound to `:22`.** `sudo ss -tlnp | grep ':22'` should show one
listener owned by the system `sshd`. A container publishing `:22` answers on the same address with
its own users and its own silence.

### Success signatures (so a real pass is not mistaken for a partial one)

```
ssh:     key-only auth ok as pistore          # BatchMode, so no password could have been typed
write:   ok (/srv/pi-storage writable)        # ownership is right, no sudo needed at runtime
status:  READY
```

Then the transfer proof, which is `cmp` and not the exit code:

```bash
head -c 50M /dev/urandom > /tmp/probe.bin
./scripts/storage.sh put /tmp/probe.bin --to probe
./scripts/storage.sh get probe/probe.bin /tmp/probe-back
cmp /tmp/probe.bin /tmp/probe-back/probe.bin && echo ROUNDTRIP_OK
```

A `df` line naming `/dev/nvme0n1p5 … /` instead of a data device means `remoteRoot` lives on the
root filesystem — reachable and writable, but not the disk that was promised.

## Letting `pistore` read files from the `pmpmt` account

`pistore` is unprivileged and `/home/pmpmt` is `750`-or-tighter, so it can see nothing there. Three
patterns, narrowest first. **Do not** add `pistore` to the `pmpmt` group: group-readable files in an
admin home include `.env`, shell history and backups, so that grants far more than a file handoff.

### 1. One-shot copy (default; leaves no standing permission)

As `pmpmt` on the server:

```bash
sudo install -d -o pistore -g pistore -m 0750 /srv/pi-storage/inbox
sudo install -o pistore -g pistore -m 0640 ~/Downloads/linux_user_sudo_notes.md /srv/pi-storage/inbox/
```

Then from the laptop, through the agent:

```bash
scripts/storage.sh get inbox/linux_user_sudo_notes.md /tmp/handoff
```

The file is now owned by `pistore` and readable only by `pistore`'s group — no ACLs, no group
changes, nothing to remember or revoke.

### 2. Standing read of one file (ACL, still narrow)

```bash
sudo setfacl -m u:pistore:x /home/pmpmt                    # traverse only, no listing
sudo setfacl -m u:pistore:x /home/pmpmt/Downloads
sudo setfacl -m u:pistore:r ~/Downloads/linux_user_sudo_notes.md
getfacl -p ~/Downloads/linux_user_sudo_notes.md            # verify
```

Revoke with `sudo setfacl -x u:pistore <path>` (repeat for each path). `x` on a directory allows
traversal, not `ls` — `pistore` can open the exact path and still cannot enumerate the folder.

### 3. Shared handoff folder (recurring exchanges)

```bash
sudo install -d -o pmpmt -g pistore -m 2770 /srv/handoff   # setgid: new files keep group pistore
```

`pmpmt` drops files there, `pistore` reads them, neither touches the other's home. Add
`sudo setfacl -d -m g:pistore:rw /srv/handoff` if new files arrive `0640` and need to stay
group-readable regardless of umask.

### Why not `sudo` from the agent

`pistore`'s sudo is deliberately scoped to service control and read-only diagnostics
(`/etc/sudoers.d/90-pistore-lan-storage`). Adding `cp` or `cat` with a wildcard to that list would
turn a storage account into an arbitrary-file-read account, which is precisely what the scoping
removed. Files move as `pistore` or are staged by `pmpmt`; the agent never escalates.

## Server privilege: scoped, on purpose

`pistore` has **no** blanket `NOPASSWD:ALL`. A sudoers drop-in narrows it to deliberate service
control plus read-only diagnostics, so a stolen key cannot become root:

```sudoers
# /etc/sudoers.d/90-pistore-lan-storage  (root:root, 0440, validated with `visudo -cf`)
Cmnd_Alias LAN_STORAGE_SERVICE = /usr/bin/systemctl reboot, /usr/bin/systemctl poweroff, \
                                 /usr/sbin/reboot, /usr/sbin/poweroff, \
                                 /usr/bin/systemctl status, /usr/bin/systemctl status *
Cmnd_Alias LAN_STORAGE_READ = /usr/bin/df, /usr/bin/df *, /usr/bin/findmnt, /usr/bin/findmnt *, \
                              /usr/bin/lsblk, /usr/bin/lsblk *, /usr/bin/ss, /usr/bin/ss *, \
                              /usr/bin/journalctl, /usr/bin/journalctl -u ssh *, \
                              /usr/bin/journalctl --since *

pistore ALL=(root) NOPASSWD: LAN_STORAGE_SERVICE, LAN_STORAGE_READ
```

Verified 2025-11-03: `df`, `systemctl status` succeed without a password; `cat /etc/shadow` and
`sudo id` are refused with `sudo: a password is required`. A `sudo` call that is refused also
proves `/etc/sudoers` still parses — a broken file fails with a parse error instead.

**Storage work needs no root at all.** The agents' rule is unchanged and still the real control:
never escalate. If a task genuinely needs root, hand the command to the human. To widen the list,
edit that drop-in on the server, not `/etc/sudoers`.

## Open items

- ~~Server IP, box type, and username.~~ Resolved 2025-11-03: `192.168.1.60`, Ubuntu 24.04
  (`OpenSSH_9.6p1`), user `pistore`, `remoteRoot /srv/pi-storage`.
- ~~`nc -z <IP> 22` reachability probe before debugging anything else.~~ Reachable.
- ~~Once reachable: A3 config block, A4/B3, C verification.~~ All done; `lan-agent` reports READY and
  a 50 MB round trip was byte-identical.
- [ ] `/srv/pi-storage` is on the server's root filesystem (73G, 33G free) — mount a data volume
  there by UUID, or accept it deliberately.
- [ ] `PasswordAuthentication` is still `yes` on the server (allow-list fixed, hardening not).
- [ ] Reserve `192.168.1.60` in the router so a lease move cannot silently break callers.
- [x] ~~Replace `pistore ALL=(ALL) NOPASSWD:ALL`.~~ 2025-11-03: scoped drop-in installed and
      tested; blanket line removed from `/etc/sudoers` (backup `sudoers.bak.*` kept there).
