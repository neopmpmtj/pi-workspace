Here you go, Pedro — a clean, portable **Markdown reference** containing all three solutions.  
You can copy/paste it directly into a `.md` file and keep it with your project.

```md
# Running a Python Web App Without Terminal Closing the Process  
### (Ubuntu – Background Execution Solutions)

This document summarizes three reliable ways to run a Python script (such as `main.py`) so that it **keeps running even after the terminal window is closed**.

---

## 1. Using `nohup` in the `.desktop` File  
This method detaches the process from the terminal so it continues running in the background.

### `.desktop` Exec example:
```ini
Exec=bash -c 'cd ~/apps/U-speech-to-text && source .venv/bin/activate && nohup python3 main.py > logs/nohup.out 2>&1 &'
Terminal=false
```

### Notes:
- `nohup` prevents the process from being killed when the terminal closes  
- Output is redirected to `logs/nohup.out`  
- The script runs fully in the background  
- No terminal window appears  

---

## 2. Using a Wrapper Script + `.desktop` File  
This keeps your `.desktop` file clean and makes debugging easier.

### `run_stt.sh`
```bash
#!/bin/bash
cd ~/apps/U-speech-to-text
source .venv/bin/activate
nohup python3 main.py > logs/nohup.out 2>&1 &
```

Make it executable:
```bash
chmod +x ~/apps/U-speech-to-text/run_stt.sh
```

### `.desktop` file:
```ini
[Desktop Entry]
Type=Application
Name=STT Web Config
Exec=/home/pmpmt/apps/U-speech-to-text/run_stt.sh
Terminal=false
```

### Notes:
- Cleaner structure  
- Easy to modify or extend  
- Still uses `nohup` for background execution  

---

## 3. Running as a `systemd` Service (Best Long-Term Solution)  
This is the most robust and professional approach.  
Your app becomes a real Linux service that:

- Starts automatically on boot  
- Restarts if it crashes  
- Runs independently of any terminal  
- Has centralized logging  

### Example service file: `/etc/systemd/system/stt_web_config.service`
```ini
[Unit]
Description=Speech-to-Text Web App
After=network.target

[Service]
WorkingDirectory=/home/pmpmt/apps/U-speech-to-text
ExecStart=/home/pmpmt/apps/U-speech-to-text/.venv/bin/python3 main.py
Restart=always
User=pmpmt

[Install]
WantedBy=multi-user.target
```

### Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable stt
sudo systemctl start stt
```

### Notes:
- Best for production or long-running apps  
- Automatically restarts on failure  
- No terminal involved at all  

---

# Summary Table

| Goal | Recommended Method |
|------|--------------------|
| Quick fix | `nohup` in `.desktop` |
| Clean launcher | Wrapper script + `.desktop` |
| Reliable, auto-starting, crash-proof | `systemd` service |

---

If you want, I can also generate a matching `.desktop` file that **starts/stops** the systemd service instead of running Python directly.