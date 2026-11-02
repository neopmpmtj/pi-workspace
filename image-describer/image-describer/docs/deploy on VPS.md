# Deploy on a VPS

Ubuntu LTS. The Pi agent and the dashboard listen on `127.0.0.1` only. Open them from your laptop with an SSH tunnel. Start both by hand. The systemd units at the end are reference only.

This repo has no remote. Copy the tree with `rsync`. Do not copy generated files or secrets from the machine you are leaving.

## Layout

```text
~/image_describer/image-describer/                         repo root
  .env                                                     mode 600
  image-describer/                                         PI_CODING_AGENT_DIR
    settings.json
    AGENTS.md
    APPEND_SYSTEM.md
    extensions/describe-images/
    src/
    dashboard/
    package.json
    auth.json                                              created on the VPS
    trust.json                                             created on the VPS
    models-store.json                                      created on the VPS
    sessions/                                              created by Pi
    logs/                                                  created by a describe run
~/.nvm/versions/node/v24.21.0/                             Node and the pi binary
~/.local/bin/pi-image-describer                            launcher
```

`models-store.json` is Pi's provider catalog. The first interactive start downloads it from `https://pi.dev` and writes it in the agent directory. Leave `PI_OFFLINE` unset for that download. The dashboard does not read this file.

## 1. Packages

On the VPS:

```bash
sudo apt update
sudo apt install -y curl ca-certificates build-essential libheif-examples
```

`libheif-examples` supplies `heif-thumbnailer`. HEIC and HEIF images are decoded with that binary. Confirm it:

```bash
command -v heif-thumbnailer
```

If that prints nothing, install the Ubuntu package that ships the `heif-thumbnailer` command and run the check again.

`build-essential` is for `sharp` if the prebuilt binary does not match this machine. Install it before `npm install`.

## 2. Node 24.21.0

The app requires Node `>=24.21.0`. Pin `24.21.0` with nvm.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 24.21.0
nvm alias default 24.21.0
```

Open a new shell so `~/.bashrc` loads nvm, then:

```bash
node -v
```

The line must be `v24.21.0`. `which node` must be `$HOME/.nvm/versions/node/v24.21.0/bin/node`.

## 3. Pi 1.4.0

With that Node first on `PATH`:

```bash
npm install -g @earendil-works/pi-coding-agent@1.4.0
hash -r
pi --version
```

`pi --version` must print `1.4.0`. The binary is:

```text
~/.nvm/versions/node/v24.21.0/bin/pi
```

## 4. Copy the tree

On the laptop, from the repo root (`~/image_describer/image-describer` on the machine you are copying from):

```bash
ssh user@vps 'mkdir -p ~/image_describer'
rsync -a \
  --exclude node_modules \
  --exclude sessions \
  --exclude logs \
  --exclude .env \
  --exclude auth.json \
  --exclude trust.json \
  --exclude models-store.json \
  --exclude dashboard/dist \
  ./ user@vps:~/image_describer/image-describer/
```

Replace `user@vps` with the SSH login. Do not copy `node_modules/`, `sessions/`, `logs/`, `.env`, `auth.json`, `trust.json`, or `models-store.json`.

## 5. Secrets and the launcher

On the VPS, create the env file at the repo root. `.env.example` still mentions `~/image_describer/.env`. That path is stale. The file that the launcher and the describer read is:

```text
~/image_describer/image-describer/.env
```

```bash
install -m 600 /dev/null "$HOME/image_describer/image-describer/.env"
```

Edit that file. Name the variables. Do not commit the file and do not paste the values into the shell history of a shared log. Only the selected model's key is required.

```text
DEEPSEEK_API_KEY=
# OPENAI_API_KEY=
# GEMINI_API_KEY=
```

`describe_images` reads these names from this file. The launcher sources the same file into the Pi process.

Create the launcher. It must use `$HOME`, not a path from another machine.

```bash
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/pi-image-describer" << 'EOF'
#!/bin/bash
# Sources only this agent's .env. Does not use a launcher that loads another agent's .env.

set -a
ENV_FILE="$HOME/image_describer/image-describer/.env"
[ -f "$ENV_FILE" ] && source "$ENV_FILE"
set +a

export PI_CODING_AGENT_DIR="$HOME/image_describer/image-describer/image-describer"

export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
exec "$HOME/.nvm/versions/node/v24.21.0/bin/pi" "$@"
EOF
chmod 755 "$HOME/.local/bin/pi-image-describer"
```

Put `~/.local/bin` on `PATH` for login shells. Add this to `~/.bashrc` when `echo "$PATH"` does not already contain it:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Open a new shell, then:

```bash
command -v pi-image-describer
```

## 6. Install the app

On the VPS:

```bash
cd "$HOME/image_describer/image-describer/image-describer"
npm install
cd dashboard
npm install
```

If `sharp` fails because no prebuild exists for this platform, `build-essential` is already installed. Run `npm install` again in `~/image_describer/image-describer/image-describer`.

`model-rates.json` is optional. It lives in the repo root, beside `.env`. When it is absent, the dashboard uses its built-in rates.

## 7. Start the agent

```bash
cd "$HOME/image_describer/image-describer"
pi-image-describer
```

The working directory is the repo root. `PI_CODING_AGENT_DIR` is `~/image_describer/image-describer/image-describer`.

On that first start:

- Pi downloads `models-store.json` into the agent directory.
- If Pi asks whether to trust the project, trust `~/image_describer/image-describer`. That writes `trust.json` in the agent directory.
- In the Pi prompt, run `/login deepseek` and supply the DeepSeek key when asked. That writes `auth.json` in the agent directory. Repeat with `openai` or `gemini` only when that provider's key is in `.env`.

Check the chat credential without printing it:

```bash
pi-image-describer auth check --provider deepseek
```

Do not pass `--credentials`. That flag prints the key.

Leave this process running while you use the agent. A second SSH session is the place to start the dashboard.

## 8. Web UI

Two processes, both on the VPS, both on localhost. The API default is `127.0.0.1:8788`. The site default is port `5173`, which is the origin the API accepts. Port `8787` belongs to the orchestrator dashboard.

### API

In a second shell on the VPS:

```bash
cd "$HOME/image_describer/image-describer/image-describer"
npm run dashboard
```

That runs `node --experimental-strip-types dashboard/server.ts`. It reads `logs/` and `sessions/` under this directory. `DASHBOARD_HOST` defaults to `127.0.0.1`. Do not set it to `0.0.0.0`.

### Site, dev server

In a third shell on the VPS:

```bash
cd "$HOME/image_describer/image-describer/image-describer/dashboard"
npm run dev
```

Vite uses port `5173`. If it reports that the port is busy and picks another one, stop the other process or start the API with that origin:

```bash
DASHBOARD_ORIGIN=http://127.0.0.1:<port> npm run dashboard
```

A Settings save from any other origin returns 403.

### SSH tunnel

On the laptop:

```bash
ssh -L 5173:127.0.0.1:5173 -L 8788:127.0.0.1:8788 user@vps
```

In the browser on the laptop:

- `http://127.0.0.1:5173/#metrics`
- `http://127.0.0.1:5173/#settings`

The page calls `http://127.0.0.1:8788`. Both ports must be forwarded, or the charts and the save buttons fail.

### Site, built files

Use this when you do not want the Vite dev server. On the VPS:

```bash
cd "$HOME/image_describer/image-describer/image-describer/dashboard"
VITE_API_URL=http://127.0.0.1:8788 npm run build
npx vite preview --host 127.0.0.1 --port 5173
```

`VITE_API_URL` is written into the built files. Keep it at `http://127.0.0.1:8788` so the browser on the laptop, through the tunnel, reaches the API on the laptop's forwarded port. Use the same `ssh -L` command. The API process from the previous section still has to be running. A public domain is a different `VITE_API_URL`, set when the site is built.

## 9. systemd reference

This section is not required for the steps above. Use it when the API should restart on boot and a Pi TUI should stay up in tmux after you disconnect.

Install tmux if it is missing:

```bash
sudo apt install -y tmux
```

Replace `USER` in the system unit with the login name. The user unit uses systemd's `%h` and does not need that replacement.

### Dashboard API

File: `/etc/systemd/system/image-describer-dashboard.service`

```ini
[Unit]
Description=image-describer dashboard API
After=network.target

[Service]
Type=simple
User=USER
WorkingDirectory=/home/USER/image_describer/image-describer/image-describer
Environment=PI_CODING_AGENT_DIR=/home/USER/image_describer/image-describer/image-describer
Environment=DASHBOARD_HOST=127.0.0.1
Environment=DASHBOARD_PORT=8788
Environment=PATH=/home/USER/.nvm/versions/node/v24.21.0/bin:/usr/bin
ExecStart=/home/USER/.nvm/versions/node/v24.21.0/bin/node --experimental-strip-types dashboard/server.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now image-describer-dashboard.service
sudo systemctl status image-describer-dashboard.service
```

The socket stays on `127.0.0.1:8788`. Stop a hand-started `npm run dashboard` before enabling this, or the port is already taken.

### Pi TUI in tmux

File: `~/.config/systemd/user/pi-image-describer.service`

```ini
[Unit]
Description=image-describer Pi agent

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=%h/image_describer/image-describer
ExecStart=/usr/bin/tmux new-session -d -s pi-image-describer -c %h/image_describer/image-describer -- %h/.local/bin/pi-image-describer
ExecStop=/usr/bin/tmux kill-session -t pi-image-describer

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now pi-image-describer.service
sudo loginctl enable-linger "$USER"
```

`enable-linger` keeps the user service running after you log out. Attach with:

```bash
tmux attach -t pi-image-describer
```

Detach with `Ctrl-b` then `d`. That leaves the agent running. `systemctl --user stop pi-image-describer.service` closes the tmux session.

The dev server and `vite preview` stay manual. The tunnel command does not change.

## 10. Check

On the VPS:

```bash
node -v
pi --version
command -v heif-thumbnailer
command -v pi-image-describer
```

Expect `v24.21.0`, `1.4.0`, a path to `heif-thumbnailer`, and `~/.local/bin/pi-image-describer`.

Confirm the launcher points at this tree:

```bash
grep -E 'ENV_FILE|PI_CODING_AGENT_DIR|nvm/versions/node' "$HOME/.local/bin/pi-image-describer"
```

Expect:

```text
ENV_FILE="$HOME/image_describer/image-describer/.env"
export PI_CODING_AGENT_DIR="$HOME/image_describer/image-describer/image-describer"
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
exec "$HOME/.nvm/versions/node/v24.21.0/bin/pi" "$@"
```

With the API running, from the laptop through the tunnel, or on the VPS:

```bash
curl -sS http://127.0.0.1:8788/api/default-mode
```

A missing `default-mode.json` still returns JSON. The body names `general` as the default.

Run one description only after `DEEPSEEK_API_KEY` is in `.env` and the agent is up. In Pi, pass a directory of images to `/describe-images`. A missing key fails before a paid call and names `DEEPSEEK_API_KEY`.
