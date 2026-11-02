"""
Views for the Speech-to-Text Settings Dashboard

This module handles GET and POST requests for the settings dashboard,
allowing real-time configuration changes via Python dataclasses and environment variables (no runtime_config.json).
"""

from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from dashboard_project.config_handler import load_runtime_config, save_runtime_config


@require_http_methods(["GET", "POST"])
def dashboard_view(request):
    """
    Main dashboard view for settings management.
    
    GET: Load current settings and render the form
    POST: Save updated settings to Python dataclasses and environment variables (no runtime_config.json)
    """
    if request.method == "POST":
        # Get form data
        language = request.POST.get('language', 'en')
        model = request.POST.get('model', 'gpt-transcribe')
        add_timestamp = request.POST.get('add_timestamp') == 'on'
        hotkey = request.POST.get('paste_hotkey', 'auto')

        valid_hotkeys = {"auto", "ctrl_v", "ctrl_shift_v", "command_v"}
        if hotkey not in valid_hotkeys:
            hotkey = "auto"
        
        # Prepare config data
        config_data = {
            "transcription": {
                "language": language,
                "model": model
            },
            "paste": {
                "add_timestamp": add_timestamp,
                "hotkey": hotkey
            }
        }
        
        # Save configuration
        success = save_runtime_config(config_data)
        
        # Return to dashboard with success message
        context = {
            'config': config_data,
            'success': success,
            'message': 'Settings saved successfully! Changes will take effect on the next transcription.' if success else 'Failed to save settings.'
        }
        return render(request, 'settings_app/dashboard.html', context)
    
    # GET request - load current settings
    config_data = load_runtime_config()
    context = {
        'config': config_data,
        'success': None,
        'message': None
    }
    return render(request, 'settings_app/dashboard.html', context)
