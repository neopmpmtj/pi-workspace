# Passwordless sudo for the agent — and how to take it back

The pi agent runs as `pmpmt`. On this host that account has **no NOPASSWD rule**, so `sudo`
fails with "a terminal is required to read the password" and every privileged command has to
be handed to the human. This runbook changes that deliberately, with a one-command undo.

Script: `~/.pi/scripts/host-sudo-mode.sh` (`status` · `on` · `off` · `show`).

## Turn it on (needs your password once)

```bash
bash ~/.pi/scripts/host-sudo-mode.sh on
```

It validates the generated rule with `visudo -cf` **before** installing anything (a broken
file in `/etc/sudoers.d` locks `sudo` out), installs it `0440 root:root`, then re-checks and
proves NOPASSWD actually works with `sudo -k && sudo -n true`. If any step fails it removes
the file again and tells you.

What gets installed:

```
# /etc/sudoers.d/90-pi-agent
pmpmt ALL=(ALL:ALL) NOPASSWD: ALL
```

## Turn it off (no password needed — by design)

```bash
bash ~/.pi/scripts/host-sudo-mode.sh off
```

While the rule is active, `sudo -n` works, so turning it **off** is free. Turning it back
**on** needs a password. The direction is deliberate: nothing that has taken over the
`pmpmt` account can silently give itself root back — it can drop the rule, never restore it.
The file is moved (not deleted) to `/etc/pi-agent/sudo-rule.parked`, which is inert; `on`
restores or recreates it.

Check the current state at any time, no privileges needed:

```bash
bash ~/.pi/scripts/host-sudo-mode.sh status
```

## The honest risk

`NOPASSWD: ALL` means **every** process running as `pmpmt` becomes root on demand: the agent,
any `npm install` postinstall script in this tree, any `git` hook, any downloaded script the
agent is asked to run. It is not "the agent can run dd" — it is "the agent's mistakes are
root mistakes", including `rm -rf` outside `$HOME`, and `dd` onto `nvme0n1`.

Two ways to shrink that without losing the convenience:

1. **Narrow the rule** instead of `ALL`. Replace the line in `~/.pi/scripts/host-sudo-mode.sh`
   (`rule_text`) with an explicit list, and every command stays auditable:

   ```
   pmpmt ALL=(root) NOPASSWD: /usr/bin/dd, /usr/bin/wipefs, /usr/bin/sgdisk, \
                             /usr/bin/mount, /usr/bin/umount, /usr/bin/lsblk, \
                             /usr/bin/blkdiscard, /usr/bin/cmp, /usr/bin/install
   ```

   Wildcards in sudoers are dangerous (`/usr/bin/*` is equivalent to `ALL` because of
   `sudo -e`/`less` escapes) — list full paths only.

2. **Ask-per-command with a GUI prompt instead of a standing rule.** This keeps a human in
   the loop for every privileged action while still letting the agent *initiate* it:

   ```bash
   sudo apt install ssh-askpass        # or use zenity directly
   cat > ~/.local/bin/askpass-gui.sh <<'EOF'
   #!/bin/sh
   exec zenity --password --title="sudo for the agent"
   EOF
   chmod +x ~/.local/bin/askpass-gui.sh
   ```

   Then `SUDO_ASKPASS=~/.local/bin/askpass-gui.sh sudo -A <command>` pops a dialog; nothing is
   stored and no rule exists. The agent can only proceed if you type the password in the
   dialog. Cost: you must be at the screen for each command, so it is not usable over SSH or
   from a scheduled turn.

Whichever route is chosen, prefer a **temporary** window: `on` for the task, `off` when it is
done. That is what the toggle is for.

## Actions the agent still hands back, even with the rule on

Policy, stated here so it survives a context reset. With passwordless sudo active the agent
may format/partition/write disks, install packages and edit system files — but it asks first,
and waits, for:

- writing to the laptop's own disks (`/dev/nvme0n1*`) or any other `/dev/sd*` it was not told
  to use, and any `dd`/`wipefs`/`sgdisk`/`blkdiscard` on a device it did not identify in the
  same turn
- editing `/etc/sudoers` or anything in `/etc/sudoers.d` (including this rule)
- deleting anything in `~/Downloads/ubuntu-desktop-copy` (it is the only copy of the server's
  data) or in `~/pi-host-backups`
- rewriting ssh keys or `authorized_keys`, on either host
- `pi update`, host sync/push, or anything that changes both hosts at once

Ask for it explicitly ("wipe the stick", "delete the ISOs") and it proceeds without another
question.

## Verify it worked

```bash
bash ~/.pi/scripts/host-sudo-mode.sh status      # → "passwordless sudo: ACTIVE"
sudo -n true && echo "agent can sudo without a password"
sudo -l | head -5                                # the rule as sudo sees it
```

## Traps

- `sudo visudo` is the only safe editor for `/etc/sudoers*`. A syntax error there can leave
  the host with **no** working sudo at all — recovery is a root shell or a live USB. The
  script always validates a temp file first; do not hand-edit the drop-in.
- Files in `/etc/sudoers.d` must be `0440`, owned `root:root`, and **must not contain a dot**
  in the name — a dotted file is silently ignored, which looks exactly like "the rule did not
  apply".
- On the VPS this same script works, and the same caveats apply; its sudo also requires a
  password today.
- Removing the rule does **not** revoke an already-running root process, and does not clear an
  existing sudo timestamp (`sudo -k` does that).
