"""
URL Configuration for Settings App
"""

from django.urls import path
from . import views

app_name = 'settings_app'

urlpatterns = [
    path('', views.dashboard_view, name='dashboard'),
]

