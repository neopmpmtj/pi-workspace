"""
Common configuration module.

This package contains application-wide configuration settings.
"""

from .config_app import config, AppConfig, DependencyCheckFlags

__all__ = ['config', 'AppConfig', 'DependencyCheckFlags']

