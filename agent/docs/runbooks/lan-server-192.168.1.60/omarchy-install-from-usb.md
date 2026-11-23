# Install Omarchy on `192.168.1.60` from a USB stick (full wipe)

Replaces Ubuntu 24.04 on the desktop with **Omarchy 4.5.0 (x86_64)**, wiping every
partition, the old GRUB and the old ESP. Nothing is preserved — all user data was rescued
first (see `~/Downloads/ubuntu-desktop-copy/MANIFEST.md`, 74 GB).

Verified against the ISO itself (`omarchy-4.5.0-x86.iso`, ISO9660 label `OMARCHY_202611`,
6,540,910,592 bytes): GRUB + syslinux + EFI boot, `archiso` layout, kernel
`vmlinuz-linux-omarchy`, and a prebuilt `omarchy_root_img.zst` (3.7 GB) that the installer
writes to disk instead of doing a package-by-package Arch install.

## Part 1 — make the USB stick (on the laptop)

The stick is `/dev/sda`: **Kingston DataTraveler 3.0, 14.4 GB** (it currently holds an
Ubuntu 24.04.5 live USB). Needs the user's sudo password — the agent has no silent root.

```bash
# 1. Confirm the device. It must be the 14.4G Kingston on usb, NOT nvme0n1.
lsblk -o NAME,SIZE,MODEL,TRAN,RM,MOUNTPOINTS

# 2. Unmount anything mounted from it (Ubuntu live USB mounts two partitions).
sudo umount /dev/sda?* 2>/dev/null

# 3. Erase every signature and the partition table — the "format".
sudo wipefs -a /dev/sda
sudo sgdisk --zap-all /dev/sda

# 4. Write the ISO raw onto the whole device.
sudo dd if="$HOME/Downloads/ubuntu-desktop-copy/isos/omarchy-4.5.0-x86.iso" \
        of=/dev/sda bs=8M status=progress conv=fsync oflag=direct

# 5. Verify by reading the stick back and comparing byte for byte (~1-2 min).
sync
sudo cmp -n 6540910592 \
  "$HOME/Downloads/ubuntu-desktop-copy/isos/omarchy-4.5.0-x86.iso" /dev/sda \
  && echo "OK: stick matches the ISO"

# 6. Flush and power the stick off so it is safe to pull.
sync
sudo udisksctl power-off -b /dev/sda
```

Notes:

- `of=/dev/sda` is the whole device. `of=/dev/sda1` (a partition) would silently write into
  the wrong place.
- After `dd` the stick reports two partitions (`sda1` iso9660 `OMARCHY_202611`, `sda2` vfat
  EFI) and ~7.9 GB of unallocated space. That is normal and correct for an installer; the
  leftover space is not usable while the stick is an image.
- If you would rather keep several ISOs on one stick, Ventoy works with this ISO (its
  `grub.cfg` has a Ventoy hook), but plain `dd` is the simplest path.
- `wipefs`/`sgdisk` are not strictly needed before `dd` on a raw image, but they remove the
  stale Ubuntu signatures and any "writable" partition metadata that could confuse a
  firmware boot menu.

## Part 2 — wipe the server's disk (from the live environment)

The machine now has **one** disk: `SK Hynix HFS512GDE9X081N`, 476.9 GB NVMe
(`/dev/nvme0n1`), previously ESP `p1` + root `p2` + `/home` `p7` + leftovers.

1. Insert the stick, power on, hit **F12** (B550 boot menu), boot the
   **UEFI: Kingston DataTraveler** entry.
2. **Secure Boot must be off** (BIOS → Security → Secure Boot → Disabled). The Arch-based
   ISO is not signed for the Microsoft KEK DB; with Secure Boot on it may refuse to boot or
   show no bootable device.
3. The GRUB menu is `timeout=0` and hidden: it boots `Omarchy (x86_64, UEFI)` on its own and
   lands in the installer wizard on tty1. Do **not** sit waiting for a menu.
4. **Wipe before installing** (recommended, so the wizard sees a clean disk): press
   **Alt+F2** for a second VT, log in as `root` (no password on the live ISO), then:

   ```bash
   lsblk -o NAME,SIZE,MODEL,MOUNTPOINTS      # confirm: exactly one disk, nvme0n1
   wipefs -a /dev/nvme0n1                    # kills gpt, ext4, fat signatures
   sgdisk --zap-all /dev/nvme0n1             # kills the partition table, incl. old ESP
   blkdiscard --secure /dev/nvme0n1          # optional: TRIM the whole NAND
   ```

   Then **Alt+F1** to return to the wizard. This is what removes the old GRUB: its ESP and
   every signature are gone, and the installer writes a fresh GPT.

## Part 3 — the installer wizard (what you will actually see)

Everything runs on tty1 as a `gum` TUI; the log is `/var/log/omarchy-install.log` and is
also written to the installed system.

1. **Language** — first screen; sets the installer's own language.
2. **Keyboard layout**.
3. **Timezone** (Europe/Lisbon for this machine) and locale.
4. **Account** — username, password (and a rule-checked hostname).
5. **Disk** — it lists whole disks and explicitly refuses to offer the install media as a
   target. Pick `nvme0n1`. It then analyses free space and, on this machine, confirms the
   wipe.
6. **Summary → confirm** — it prints what it is about to do; the last `gum confirm` is the
   point of no return.
7. **Install** — creates a fresh GPT with two partitions it labels `OMARCHY_EFI` (fat32,
   ESP) and `OMARCHY_ROOT` (btrfs), optionally inside LUKS if you chose encryption, then
   writes `omarchy_root_img.zst` and the bootloader. Takes a few minutes; the 3.7 GB root
   image is why it is fast compared with a normal Arch install.
8. **Reboot**, pull the stick, boot the NVMe. If the account setup was deferred, the
   first-boot owner setup finishes it.

## NVIDIA RTX 3060 note

Omarchy is Hyprland on Wayland. If the desktop does not come up on the 3060, install the
proprietary stack from a TTY (`Ctrl+Alt+F3`) and reboot:

```bash
sudo pacman -Syu nvidia-open-dkms nvidia-utils   # or: nvidia-dkms nvidia-utils
```

Pick one variant, not both. `nvidia-open-dkms` is the current recommendation for Ampere
(the 3060); the legacy `nvidia-dkms` works too and copes better with some older displays.

## Traps

- Booting the stick in **legacy/CSM** mode installs a BIOS system; pick the `UEFI:` entry.
- The old Ubuntu had `/home` on its own partition. That is irrelevant now — the layout
  becomes two partitions, root and ESP, and every byte of the old disk goes.
- If the wizard reports no free space, the disk was not wiped first: redo Part 2 step 4.
- Do not interrupt after the GPT is written: `mklabel gpt` happens before the image write,
  so an abort there leaves a half-partitioned disk (recoverable by re-running the wizard
  after another `sgdisk --zap-all`).
- After the install the machine is Arch, not Ubuntu: `pacman`/`yay`, no `apt`, no snap. Any
  runbook here that says `apt install` does not apply to it any more.
