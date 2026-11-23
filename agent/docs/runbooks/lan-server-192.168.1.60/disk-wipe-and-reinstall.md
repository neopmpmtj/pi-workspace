# Wipe a disk and reinstall on `192.168.1.60` — and why GRUB is not the tool

Short answer: **`grub` cannot format a disk.** GRUB is a bootloader. It writes a small
stage-1 blob to the MBR/ESP, reads `grub.cfg`, and loads a kernel. It has no `mkfs`, no
partition editor, and no concept of a filesystem to create — it only *reads* the ones that
already exist. If you are staring at a `grub>` prompt, you are in a rescue shell that can
load a kernel or chainload a bootloader; formatting happens with the live USB afterwards.

## What each tool is actually for

| Task | Tool |
| --- | --- |
| Destroy existing partition tables / signatures | `wipefs -a`, `sgdisk --zap-all`, or GParted → *Device → Create Partition Table* |
| Create partitions | `parted`, `sgdisk`, or GParted |
| Create a filesystem (the "format") | `mkfs.ext4`, `mkfs.vfat`, `mkfs.btrfs`, or GParted → *New* |
| Trim an SSD before reuse | `blkdiscard`, `nvme format` (secure erase) |
| Install the bootloader | the Ubuntu installer (runs `grub-install`), or manually from a chroot |
| Boot into a broken system | `grub>` shell: `set root=…`, `linux …`, `initrd …`, `boot` |

## The normal path: reinstall from the live USB

1. **Media.** `~/Downloads/ubuntu-desktop-copy/isos/ubuntu-24.04.5.1-desktop-amd64.iso`
   (6.25 GB) written with `rufus-4.11p.exe` on Windows, or `dd` on Linux:
   `sudo dd if=<iso> of=/dev/sdX bs=4M status=progress oflag=sync` (device, not partition).
2. **Boot it** on the server: F12 / F8 boot menu at power-on, pick the USB (UEFI entry).
3. **Identify the disk** — never assume:
   ```
   lsblk -o NAME,SIZE,MODEL,MOUNTPOINTS
   sudo nvme list
   ```
4. **Sanitise the SSD** (optional but recommended before reinstall; unmounted only):
   ```
   sudo blkdiscard --secure /dev/nvme0n1      # TRIM/secure, fast on NVMe
   # or, firmware-level secure erase:
   sudo nvme format /dev/nvme0 -s 1 -n 1
   ```
   If the firmware refuses while a namespace is mounted, boot the live USB in
   "Try Ubuntu" mode first — nothing on the target disk is mounted there.
5. **Let the installer partition**: *Erase disk and install Ubuntu* → whole disk (GPT +
   ESP + ext4 root). That is the "format" you actually want for a full reinstall.
6. **GRUB gets installed at the end** by the installer, to `/boot/efi` (ESP). That is the
   only place GRUB belongs in this flow.

## Manual alternative, all from a live session

```bash
DISK=/dev/nvme0n1
sudo umount ${DISK}* 2>/dev/null
sudo wipefs -a "$DISK"                       # erase every signature (gpt, ext4, lvm, zfs…)
sudo sgdisk --zap-all "$DISK"
sudo sgdisk -n1:0:+1G -t1:ef00 -c1:EFI "$DISK"   # ESP
sudo sgdisk -n2:0:0   -t2:8300 -c2:root "$DISK"  # root
sudo mkfs.fat -F32 ${DISK}p1
sudo mkfs.ext4 -L root ${DISK}p2
```

Then run the installer and choose *Something else*, assigning those partitions.

## Reinstalling GRUB by hand (only if the system boots but does not start)

```bash
# from the live USB, with the installed root mounted
sudo mount /dev/nvme0n1p2 /mnt
sudo mount /dev/nvme0n1p1 /mnt/boot/efi
for i in dev dev/pts proc sys run; do sudo mount --bind /$i /mnt/$i; done
sudo chroot /mnt grub-install --target=x86_64-efi \
     --efi-directory=/boot/efi --bootloader-id=ubuntu
sudo chroot /mnt update-grub
```

## Traps

- `dd of=/dev/nvme0n1p2` writes *into a partition* — the common way to destroy the wrong
  thing. Confirm with `lsblk` first, and note the target is a whole device.
- `wipefs -a` on the wrong disk is instant and silent. Unplug every other disk (the server
  has `sda`, `sdb`, and a 1.9 TB USB `Elements` attached).
- A disk that reports "device busy" is mounted or is a member of a pool/LVM/RAID; find it
  with `lsblk -f` and `sudo dmsetup ls`.
- On this box `/home` sat on its own partition (`nvme0n1p7`), root on `nvme0n1p5`, ESP on
  `nvme0n1p1`. A full-disk reinstall collapses all three — confirm you meant that, because
  the rescue copy lives only on the laptop (see
  `~/Downloads/ubuntu-desktop-copy/MANIFEST.md`).
- Secure erase wipes the SSD's NAND; there is no undo and no data-recovery vendor will
  help afterwards.

## Verified state before the reinstall (2026-11-22)

- `/home` on the server: 74 G used / 286 G free; `~pmpmt/{Downloads,Desktop,Documents,Pictures}`
  emptied, all data rescued to the laptop (74 GB in `~/Downloads/ubuntu-desktop-copy`).
- `pistore` has passwordless root there, so all of the above can be done over SSH — but a
  reinstall needs physical boot media regardless.
