# Linux User, Password, and Sudo Notes

## How `passwd` Works

```bash
passwd
```

Changes the password of the **current user**.

Equivalent to:

```bash
passwd <current-user>
```

Useful checks:

```bash
whoami
id -un
```

---

## Create a User

```bash
useradd --create-home --shell /bin/bash pistore
```

Creates user **pistore**:

- `--create-home` → creates `/home/pistore`
- `--shell /bin/bash` → sets Bash as the login shell

---

## Lock the Password

```bash
passwd -l pistore
```

Locks the account password.

Effects:

- Password authentication is disabled.
- User cannot log in with a password.
- SSH key authentication can still work if configured.

This is often called a **key-only** account.

---

## Grant Sudo Access

### Ubuntu / Debian

```bash
sudo usermod -aG sudo pistore
```

### RHEL / CentOS / Fedora

```bash
sudo usermod -aG wheel pistore
```

Verify:

```bash
groups pistore
```

---

## Important Caveat

`sudo` normally asks for the user's password.

If the password is locked:

```bash
passwd -l pistore
```

then standard sudo authentication may fail because the user has no usable password.

Possible solutions:

1. Set a password for the user.
2. Configure passwordless sudo.

Example:

```bash
sudo visudo
```

Add:

```text
pistore ALL=(ALL) NOPASSWD:ALL
```

This allows the user to run sudo commands without being prompted for a password.

---

# Command Cheat Sheet

```bash
# Show current user
whoami

# Alternative current-user command
id -un

# Create user with home directory and Bash shell
sudo useradd --create-home --shell /bin/bash pistore

# Lock user password (key-only login)
sudo passwd -l pistore

# Unlock user password
sudo passwd -u pistore

# Set/change user's password
sudo passwd pistore

# Add user to sudo group (Debian/Ubuntu)
sudo usermod -aG sudo pistore

# Add user to wheel group (RHEL/Fedora/CentOS)
sudo usermod -aG wheel pistore

# Show user's groups
groups pistore

# Edit sudoers safely
sudo visudo
```

## Takeaway

A common secure setup is:

1. Create user.
2. Configure SSH public-key access.
3. Lock password.
4. Grant sudo privileges.
5. Optionally enable `NOPASSWD` sudo.

This provides key-based access while still allowing administrative tasks.
