"""URL configuration for the TTS dashboard project."""

from django.urls import path

from settings_app import views

urlpatterns = [
    path('', views.dashboard_view, name='dashboard'),
    path('voices', views.voices_view, name='voices'),
    path('preview', views.preview_view, name='preview'),
]
