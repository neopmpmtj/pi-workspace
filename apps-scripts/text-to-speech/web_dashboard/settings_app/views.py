"""
Dashboard views: render the settings page, list voices (JSON), and
synthesize a short preview clip (audio/mpeg).

The dashboard and the CLI share the same .tts_state.json, so changes made
here apply to the hotkey immediately (and vice versa).
"""

import sys
from pathlib import Path

# Make the text_to_speech package importable from this dashboard process.
APP_ROOT = Path(__file__).resolve().parent.parent.parent
SRC = APP_ROOT / "src"
for p in (str(SRC), str(APP_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)

from django.http import HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_http_methods

from text_to_speech.core.engine import synthesize_audio
from text_to_speech.core.synthesizers import get_synthesizer, provider_list
from text_to_speech.core.synthesizers.base import SynthError
from text_to_speech.state.state_manager import PROVIDER_IDS, StateManager

mgr = StateManager()

PREVIEW_MAX_CHARS = 200


def _providers_with_status(state):
    providers = []
    for prov in provider_list():
        synth = get_synthesizer(prov["id"], state.get(prov["id"], {}))
        ok, reason = synth.is_configured()
        prov["configured"] = ok
        prov["key_reason"] = reason
        providers.append(prov)
    return providers


@require_http_methods(["GET", "POST"])
def dashboard_view(request):
    state = mgr.load()
    success = None

    if request.method == "POST":
        p = request.POST
        pid = p.get("provider", "edge")
        if pid in PROVIDER_IDS:
            state["provider"] = pid
            cfg = state.setdefault(pid, {})

            if p.get("voice"):
                cfg["voice"] = p["voice"]
            for field in ("model", "instructions", "emotion", "rate", "pitch", "volume"):
                if field in p:
                    cfg[field] = p[field]
            for field in ("stability", "similarity", "style"):
                if field in p:
                    try:
                        cfg[field] = float(p[field])
                    except (TypeError, ValueError):
                        pass
            cfg["use_speaker_boost"] = p.get("use_speaker_boost") == "on"

            try:
                state["global"]["speed"] = float(p.get("speed", 1.0))
            except (TypeError, ValueError):
                pass
            if p.get("output_dir"):
                state["global"]["output_dir"] = p["output_dir"].strip()
            try:
                state["global"]["retention_days"] = int(p.get("retention_days", 14))
            except (TypeError, ValueError):
                pass

            mgr.save(state)
            success = True

    context = {
        "state": state,
        "current": state.get("provider", "edge"),
        "providers": _providers_with_status(state),
        "success": success,
        "preview_text": "This is a test of the selected voice.",
    }
    return render(request, "settings_app/dashboard.html", context)


@require_http_methods(["GET"])
def voices_view(request):
    pid = request.GET.get("provider", "edge")
    if pid not in PROVIDER_IDS:
        return JsonResponse({"error": f"Unknown provider '{pid}'"}, status=400)

    state = mgr.load()
    synth = get_synthesizer(pid, state.get(pid, {}))
    ok, reason = synth.is_configured()
    if not ok:
        return JsonResponse({"error": reason}, status=400)

    voices = synth.list_voices()
    return JsonResponse({"provider": pid, "voices": voices})


@require_http_methods(["POST"])
def preview_view(request):
    p = request.POST
    pid = p.get("provider", "edge")
    if pid not in PROVIDER_IDS:
        return JsonResponse({"error": f"Unknown provider '{pid}'"}, status=400)

    text = (p.get("text") or "This is a test of the selected voice.")[:PREVIEW_MAX_CHARS]
    state = mgr.load()
    cfg = dict(state.get(pid, {}))

    # Apply form overrides so the preview reflects what's on screen right now.
    for field in ("voice", "model", "instructions", "emotion", "rate", "pitch", "volume"):
        if p.get(field):
            cfg[field] = p[field]
    for field in ("stability", "similarity", "style"):
        if p.get(field):
            try:
                cfg[field] = float(p[field])
            except (TypeError, ValueError):
                pass
    cfg["use_speaker_boost"] = p.get("use_speaker_boost") == "on"

    try:
        speed = float(p.get("speed", state.get("global", {}).get("speed", 1.0)))
    except (TypeError, ValueError):
        speed = 1.0

    preview_state = {"global": state.get("global", {}), pid: cfg}

    try:
        audio = synthesize_audio(pid, text, preview_state, speed=speed)
    except SynthError as exc:
        return JsonResponse({"error": str(exc)}, status=502)

    return HttpResponse(audio, content_type="audio/mpeg")
