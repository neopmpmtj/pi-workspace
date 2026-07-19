# Django Web Dashboard

A beautiful web interface for managing Speech-to-Text settings on the fly.

## Overview

The Django dashboard provides a user-friendly web interface to change transcription settings without restarting the application. Changes take effect immediately on the next transcription.

## Features

- **Real-time Configuration**: Changes apply instantly to the application's in-memory configuration (Python dataclasses and environment variables). The file `runtime_config.json` is not used.
- **Beautiful UI**: Modern Bootstrap 5 design with gradient background
- **Three Settings**:
  1. **Language Selector**: Choose from 6 common languages (en, pt, es, fr, de, it)
  2. **Model Selector**: Select OpenAI transcription model (whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe)
  3. **Timestamp Toggle**: Enable/disable timestamp prefix on transcribed text

## Usage

### Automatic Start

When you run `main.py`, the Django dashboard automatically starts on **port 8030**:

```bash
python main.py
```

You'll see:
```
Starting Django web dashboard on http://localhost:8030
Dashboard ready at http://localhost:8030
```

### Access the Dashboard

Open your web browser and navigate to:

```
http://localhost:8030
```

### Change Settings

1. Select your preferred language from the dropdown
2. Choose your transcription model
3. Check/uncheck the timestamp option
4. Click "Save Settings"

Settings are immediately applied in memory and will be used for the next transcription. There is no `runtime_config.json` file.

## Technical Details

### Architecture

```
web_dashboard/
├── manage.py                           # Django management script
├── dashboard_project/                  # Main Django project
│   ├── settings.py                     # Django configuration
│   ├── urls.py                         # URL routing
│   ├── wsgi.py                         # WSGI application
│   └── config_handler.py               # Runtime config I/O module
└── settings_app/                       # Dashboard app
    ├── views.py                        # Dashboard view logic
    ├── urls.py                         # App-specific URLs
    └── templates/
        └── settings_app/
            └── dashboard.html          # Bootstrap 5 template
```

### Integration

The dashboard is launched by `main.py` as a background subprocess:
- Runs on port 8030
- Non-blocking (main app continues to run)
- Graceful error handling if dashboard fails to start

## Dependencies

- `django` - Web framework
- `django-bootstrap5` - Bootstrap 5 integration

Both are already included in `requirements.txt`.

## Troubleshooting

### Dashboard Not Starting

If the dashboard fails to start, the application will continue without it. Check:
1. Port 8030 is not already in use
2. Django dependencies are installed: `pip install django django-bootstrap5`

### Changes Not Taking Effect

Settings changes are loaded on the next transcription operation. Try:
1. Make a new recording with the hotkey
2. Verify your changes are reflected in the application's behavior (no `runtime_config.json` file is used)

### 500 Server Error

If you see a server error:
1. Check that migrations were run: `cd web_dashboard && python manage.py migrate`
2. Verify all Django apps in `INSTALLED_APPS` are properly configured

## Development

### Running Standalone

You can run the dashboard independently for testing:

```bash
cd web_dashboard
python manage.py runserver 8030
```

### Running Migrations

If you modify Django models or settings:

```bash
cd web_dashboard
python manage.py migrate
```

## Design

The dashboard features:
- **Purple gradient background** for visual appeal
- **White card layout** with rounded corners and shadow
- **Responsive design** that works on mobile and desktop
- **Smooth animations** for form interactions
- **Success/error messages** for user feedback

Built with UX best practices for a pleasant user experience.

