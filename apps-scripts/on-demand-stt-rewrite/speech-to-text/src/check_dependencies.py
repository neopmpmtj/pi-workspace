#!/usr/bin/env python3
"""
Dependency Checker

This script checks for required dependencies, specifically FFmpeg for audio conversion.
It's designed to be run before starting the application to provide early feedback
about missing dependencies.

Configuration for enabled/disabled checks can be found in common.config.config_app

Usage:
    python src/check_dependencies.py
"""

import sys
import subprocess
import os
from pathlib import Path

from common.logging_utils import get_logger
from common.config import config

logger = get_logger("dependency_checker")


def check_ffmpeg():
    """
    Check if FFmpeg is installed and accessible.
    
    Returns:
        tuple: (bool, str) - (is_installed, message)
    """
    try:
        result = subprocess.run(
            ['ffmpeg', '-version'],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if result.returncode == 0:
            version_line = result.stdout.split('\n')[0]
            logger.info(f"FFmpeg found: {version_line}")
            return True, f"[OK] FFmpeg is installed: {version_line}"
        else:
            logger.warning("FFmpeg check returned non-zero exit code")
            return False, "[FAIL] FFmpeg not found or not working properly"
            
    except FileNotFoundError:
        logger.error("FFmpeg not found in system PATH")
        return False, "[FAIL] FFmpeg is NOT installed"
    except subprocess.TimeoutExpired:
        logger.error("FFmpeg check timed out")
        return False, "[FAIL] FFmpeg check timed out"
    except Exception as e:
        logger.error(f"Error checking FFmpeg: {e}")
        return False, f"[FAIL] Error checking FFmpeg: {e}"


def check_pydub():
    """
    Check if pydub is installed.
    
    Returns:
        tuple: (bool, str) - (is_installed, message)
    """
    try:
        import pydub
        # pydub doesn't always have __version__, so check if it works instead
        logger.info("pydub found")
        return True, f"[OK] pydub is installed"
    except ImportError:
        logger.error("pydub not installed")
        return False, "[FAIL] pydub is NOT installed - required for audio conversion"


def check_openai_api_key():
    """
    Check if OPENAI_API_KEY environment variable is set and validate it by making an API call.
    
    Returns:
        tuple: (bool, str) - (is_valid, message)
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    
    if not api_key:
        logger.error("OPENAI_API_KEY not set in environment variables")
        return False, "[FAIL] OPENAI_API_KEY environment variable is NOT set in environment variables"
    
    # Check if key is empty or whitespace only
    if not api_key.strip():
        logger.error("OPENAI_API_KEY is set but empty")
        return False, "[FAIL] OPENAI_API_KEY environment variable is set but empty (no value provided)"
    
    # Show first and last 4 characters for security
    masked = f"{api_key[:4]}...{api_key[-4:]}" if len(api_key) > 8 else "****"
    
    # Validate the API key by making an actual API call
    logger.debug(f"Validating OpenAI API key ({masked})...")
    try:
        import requests
        
        url = "https://api.openai.com/v1/models"
        headers = {"Authorization": f"Bearer {api_key}"}
        
        # Make a lightweight GET request to validate the key
        response = requests.get(url, headers=headers, timeout=5)
        
        if response.status_code == 200:
            logger.info(f"OpenAI API key is valid ({masked})")
            return True, f"[OK] OPENAI_API_KEY is valid ({masked})"
        elif response.status_code == 401:
            logger.error(f"OpenAI API key is invalid, expired, or not properly created ({masked})")
            logger.error("This could mean: key is invalid, expired, revoked, or incorrectly formatted")
            return False, "[FAIL] OPENAI_API_KEY is invalid, expired, or not properly created - verify your API key at https://platform.openai.com/api-keys"
        else:
            # Other API errors
            error_msg = response.text if response.text else "Unknown error"
            logger.error(f"OpenAI API validation failed: {response.status_code} - {error_msg}")
            logger.error(f"API key present in environment: {masked}")
            return False, f"[FAIL] Cannot validate OPENAI_API_KEY: API returned {response.status_code} - {error_msg}"
            
    except requests.exceptions.Timeout:
        logger.error(f"OpenAI API key validation timed out ({masked})")
        logger.error("API key is present in environment variables but validation failed due to network timeout")
        return False, "[FAIL] OPENAI_API_KEY is set but validation failed: Network timeout (check internet connection)"
    except requests.exceptions.ConnectionError as e:
        logger.error(f"OpenAI API key validation connection error ({masked}): {e}")
        logger.error("API key is present in environment variables but validation failed due to network error")
        return False, f"[FAIL] OPENAI_API_KEY is set but validation failed: Network error - {str(e)}"
    except ImportError:
        logger.error("requests library not available for API key validation")
        logger.warning("Falling back to basic check (only verifying environment variable is set)")
        # Fallback to basic check if requests is not available
        return True, f"[OK] OPENAI_API_KEY is set ({masked}) [validation skipped - requests not installed]"
    except Exception as e:
        logger.error(f"Unexpected error validating OpenAI API key ({masked}): {e}")
        logger.error("API key is present in environment variables but validation encountered an unexpected error")
        import traceback
        logger.error(traceback.format_exc())
        return False, f"[FAIL] OPENAI_API_KEY is set but validation failed: {str(e)}"


def check_all_dependencies():
    """
    Check all enabled dependencies based on configuration flags.
    
    Returns:
        dict: Status of all dependency checks (only enabled checks are included)
    """
    results = {}
    
    # Check FFmpeg if enabled
    if config.dependency_checks.check_ffmpeg:
        logger.debug("Running FFmpeg check (enabled)")
        results['ffmpeg'] = check_ffmpeg()
    else:
        logger.debug("Skipping FFmpeg check (disabled in config)")
    
    # Check pydub if enabled
    if config.dependency_checks.check_pydub:
        logger.debug("Running pydub check (enabled)")
        results['pydub'] = check_pydub()
    else:
        logger.debug("Skipping pydub check (disabled in config)")
    
    # Check OpenAI API key if enabled
    if config.dependency_checks.check_openai_api_key:
        logger.debug("Running OpenAI API key check (enabled)")
        results['openai_api_key'] = check_openai_api_key()
    else:
        logger.debug("Skipping OpenAI API key check (disabled in config)")
    
    return results


def print_results(results):
    """
    Print formatted results of dependency checks.
    
    Args:
        results: Dictionary of check results
        
    Returns:
        bool: True if all checks passed, False otherwise
    """
    print("\n" + "=" * 70)
    print("DEPENDENCY CHECK RESULTS")
    print("=" * 70)
    
    # Show which checks are enabled/disabled
    enabled_checks = config.dependency_checks.get_enabled_checks()
    if enabled_checks:
        print(f"Enabled checks: {', '.join(enabled_checks)}")
    
    disabled_checks = []
    if not config.dependency_checks.check_ffmpeg:
        disabled_checks.append('ffmpeg')
    if not config.dependency_checks.check_pydub:
        disabled_checks.append('pydub')
    if not config.dependency_checks.check_openai_api_key:
        disabled_checks.append('openai_api_key')
    
    if disabled_checks:
        print(f"Disabled checks: {', '.join(disabled_checks)}")
    
    print("=" * 70)
    
    if not results:
        print("\n[INFO] No checks were enabled. All dependency checks are disabled.")
        return True
    
    all_ok = True
    for name, (status, message) in results.items():
        print(f"{message}")
        if not status:
            all_ok = False
    
    print("=" * 70)
    
    if all_ok:
        print("\n[OK] All checked dependencies are satisfied!")
        print("You can run the application normally.")
    else:
        print("\n[FAIL] Some dependencies are missing or incorrect.")
        print("\nRequired for audio format conversion:")
        print("  - FFmpeg: https://ffmpeg.org/download.html")
        print("  - pydub: pip install pydub")
        print("\nRequired for transcription:")
        print("  - OPENAI_API_KEY: Set this environment variable")
        print("    Windows: set OPENAI_API_KEY=your_key_here")
        print("    Linux/Mac: export OPENAI_API_KEY=your_key_here")
    
    print("\n" + "=" * 70)
    
    return all_ok


def main():
    """Main entry point for the dependency checker."""
    try:
        logger.info("Starting dependency check")
        
        results = check_all_dependencies()
        all_ok = print_results(results)
        
        # Log summary
        passed = sum(1 for status, _ in results.values() if status)
        total = len(results)
        logger.info(f"Dependency check completed: {passed}/{total} passed")
        
        return 0 if all_ok else 1
        
    except Exception as e:
        logger.error(f"Error during dependency check: {e}")
        import traceback
        logger.error(traceback.format_exc())
        print(f"Error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

