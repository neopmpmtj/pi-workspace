# Runbook: full access to the LAN server, file organisation, and a local Pi agent

Server `192.168.1.60`, hostname `pmpmt-B550-AORUS-ELITE-V2`, Ubuntu 24.04.4 — a desktop used as a
file server and (planned) local-model host. Written 2025-11-03.

## What the box actually is (probed 2025-11-03, read-only)

| Item | Value |
| --- | --- |
| CPU / RAM | Ryzen 5 5600X (6C/12T), 15 GB |
| GPU | NVIDIA GA106 **RTX 3060 LHR** (lspci); `nvidia-smi` cannot reach the driver |
| Disk | `/dev/nvme0n1p5` → `/` ext4 **73 GB, 33 GB free** |
| Disk | `/dev/nvme0n1p7` → `/home` ext4 **378 GB, 318 GB free** ← the real data partition |
| Users | `pistore` (storage, 750), `pmpmt` (admin, 750) |
| Runtimes | docker 29.5.3 (pistore not in `docker` group), node, python3, no ollama, no nvcc |
| Storage today | `/srv/pi-storage` on the **root** filesystem, 33 GB of headroom |

Two consequences worth stating once: storage belongs on `/home` (318 GB free), not `/`; and the GPU
is unusable until the driver/kernel-module question is settled.

## Phase 0 — decisions

1. **Admin identity — DECIDED 2025-11-03: no new user.** `pistore` keeps the single identity and gets
   blanket `NOPASSWD: ALL`, accepting that its unencrypted key is effectively root on that box.
   Phase 1 below (the `piadmin` commands) is kept only as the rejected alternative.

   Old recommendation, for reference: a third account `piadmin`, key-only, `NOPASSWD: ALL`, with its
   own key on the laptop (`~/.ssh/id_ed25519_lan-admin`) and its own alias (`lan-admin`). `pistore`
   stays unprivileged so ordinary storage work never has root in reach. Alternative, less clean:
   give `pistore` back `NOPASSWD: ALL`, one identity for both jobs.
2. **Storage location — DECIDED and DONE 2025-11-03.** `remoteRoot` is now
   `/home/pistore/storage` on `/dev/nvme0n1p7` (378 GB, 318 GB free), copied from
   `/srv/pi-storage` with `rsync -a`, then verified: `check` READY, round trip byte-identical. The
   old `/srv/pi-storage` tree is left empty in place, not deleted.
3. **Organisation scope.** Which trees are "many files": `/home/pmpmt` (needs admin access to see),
   `/srv`, `/opt`, something else. Inventory first, then a proposal, then moves.

## Phase 1 — admin identity (run as `pmpmt` on the server)

Key already generated on the laptop: `~/.ssh/id_ed25519_lan-admin.pub`, fingerprint
`SHA256:5eivbdNCSkgccXGj07Wci4d/o7BOVSBxGTaHsDsTB/0`.

```bash
sudo useradd --create-home --shell /bin/bash piadmin
sudo passwd -l piadmin
sudo install -d -m 700 -o piadmin -g piadmin /home/piadmin/.ssh
echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK8vTUs4jdqrMJVzlCUovP2GmrALqg/nbzX72IR4+MJ5 pi-admin@pmpmt-ThinkPad-T15-Gen-2i' \
  | sudo tee /home/piadmin/.ssh/authorized_keys >/dev/null
sudo chown piadmin:piadmin /home/piadmin/.ssh/authorized_keys
sudo chmod 600 /home/piadmin/.ssh/authorized_keys
sudo chmod go-w /home/piadmin

echo 'piadmin ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/90-piadmin >/dev/null
sudo chmod 0440 /etc/sudoers.d/90-piadmin
sudo visudo -c

sudo sed -i 's/^AllowUsers.*/AllowUsers pmpmt pistore piadmin/' /etc/ssh/sshd_config
sudo sshd -t && sudo systemctl reload ssh
```

Then on the laptop:

```
Host lan-admin
  HostName 192.168.1.60
  User piadmin
  IdentityFile ~/.ssh/id_ed25519_lan-admin
  IdentitiesOnly yes
  ServerAliveInterval 30
```

Verify: `ssh -o BatchMode=yes lan-admin 'id -un; sudo -n true && echo SUDO_OK'`.

Risk accepted, stated once: that key file is unencrypted and passwords-less, so it is root on the
server for anyone who can read it. `/etc/sudoers.d/90-pistore-lan-storage` stays as it is; the two
identities are separate so revocation is per-key.

## Phase 2 — inventory (read-only, before touching anything)

```bash
ssh lan-admin 'sudo -n du -h -d1 /home /srv /opt /var 2>/dev/null | sort -h | tail -40' > inventory-du.txt
ssh lan-admin 'sudo -n find /home -xdev -type f -printf "%s\t%p\n" 2>/dev/null | sort -rn | head -100' > inventory-big-files.txt
ssh lan-admin 'sudo -n find /home -xdev -type d -maxdepth 3 2>/dev/null' > inventory-tree.txt
ssh lan-admin 'sudo -n ls -la /home/pmpmt /home/pmpmt/Downloads /home/pmpmt/Documents' > inventory-home.txt
```

Deliverables: what occupies the 42 GB in `/home`, what is duplicate or stale, what is a project.

## Phase 3 — organisation protocol (the safeguards that matter before any wholesale move)

- **Nothing is deleted.** Unwanted paths move to `/home/.trash/<date>/<original-path>` and stay
  there until the user says otherwise.
- **Every move is dry-run first**: `rsync -a --dry-run` or `mv --verbose --dry-run`-equivalent
  listing, shown in chat, then a real run, then a count/checksum comparison.
- **One log**: `/home/piadmin/moves.log`, one line per moved path with source, destination, date.
  Reversible by reading the log backwards.
- **No globs that can escape a root**: every recursive operation is scoped to an explicit directory.
- **Deny-list**: `/etc`, `/boot`, `/var/lib`, `/usr`, anything bind-mounted, and any path with a
  running process holding it (`lsof +D`) are out of bounds by default.

## Phase 4 — move storage onto the large partition — DONE 2025-11-03

```bash
# as piadmin on the server
sudo install -d -o pistore -g pistore -m 0750 /home/pistore/storage
sudo rsync -a /srv/pi-storage/ /home/pistore/storage/
sudo install -d -m 0755 /srv/pi-storage-moved   # keep the old tree, do not delete
```

Then on the laptop: `scripts/storage.sh use --root /home/pistore/storage && scripts/storage.sh check`.

## Phase 5 — local Pi agent on the 3060

Order matters: driver → runtime → model → agent.

1. **Driver diagnosis** (Secure Boot MOK, DKMS, nouveau):
   `mokutil --sb-state`, `dkms status`, `lsmod | grep -E 'nvidia|nouveau'`,
   `dmesg | grep -iE 'nvidia|nvrm'`. If Secure Boot is on and the module is unsigned, enrolment is a
   console job with a reboot — human step.
2. **Runtime**: prefer Ollama for a 12 GB card (simple, service-managed, OpenAI-compatible on
   `:11434`). Alternative for more throughput work: llama.cpp server or vLLM (vLLM wants more VRAM
   than 12 GB for most useful models).
3. **Model class for 12 GB**: 7B–14B at Q4 (a coder model for scripts, a general model for text),
   one resident at a time.
4. **Pi on the server**: nvm + node 24 → `npm i -g @earendil-works/pi-coding-agent`, own agent home,
   launcher, ledger. The laptop's siblings are local paths, so the server agent needs either a
   local shim script that `ssh`es to it, or its own publication contract. Decide when the box is
   ready — the shim keeps the roster unchanged and is the smaller change.
5. **Local model wiring**: pi provider entry pointing at `http://127.0.0.1:11434/v1`, so the server
   agent runs on the 3060 instead of a paid API.

## Phase 6 — safeguards, after the work is done

- Re-scope `piadmin` sudo to the command set actually used (the way `pistore` was scoped), or keep
  blanket with the key on the laptop only.
- `pistore` gains no write access outside `remoteRoot`.
- Daily snapshot of the move log and the storage tree listing, so drift is visible.
- Optional: `restic`/`borg` to an external disk before any bulk deletion.
