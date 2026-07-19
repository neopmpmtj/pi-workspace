#!/usr/bin/env python3
"""
Speech-to-Text Main Entry Point

This is the main entry point for the speech-to-text application.
Dependency checks are optional. (Hotkey detection removed for Ubuntu-only version)

Usage:
    python main.py
    
Or to run dependency checks:
    python main.py --apply-checks
"""

import sys
import argparse
import signal
import subprocess
import threading
import time
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent / "src"))

# Event used to keep the service alive until a termination signal arrives
stop_event = threading.Event()

# Early error catching for startup issues
try:
    from common.logging_utils import get_logger
    from common.config import config
    from src.check_dependencies import check_all_dependencies, print_results
    
    logger = get_logger("main")
except Exception as e:
    print("\n" + "="*70)
    print("CRITICAL ERROR DURING STARTUP")
    print("="*70)
    print(f"\nFailed to import required modules: {e}")
    print(f"\nError type: {type(e).__name__}")
    import traceback
    print("\nFull traceback:")
    print(traceback.format_exc())
    print("\n" + "="*70)
    print("\nPossible causes:")
    print("1. Missing dependencies (run: pip install -r requirements.txt)")
    print("2. Incorrect Python path configuration")
    print("3. Corrupted installation")
    print("="*70)
    input("\n\nPress ENTER to exit...")
    sys.exit(1)


def start_django_server():
    """
    Start the Django web dashboard server in a background thread.
    
    This function runs the Django development server on port 8030
    to provide a web interface for changing settings on the fly.
    """
    try:
        logger.info("Starting Django web dashboard on port 8030")
        print("Starting Django web dashboard on http://localhost:8030")
        
        # Get the path to the Django manage.py script
        django_dir = Path(__file__).parent / "web_dashboard"
        manage_py = django_dir / "manage.py"
        
        if not manage_py.exists():
            logger.warning(f"Django manage.py not found at {manage_py}")
            print("Warning: Django dashboard not available (manage.py not found)")
            return
        
        # Start Django server as a subprocess
        # Using creationflags on Windows to prevent showing a separate console window
        import platform
        if platform.system() == "Windows":
            # On Windows, hide the Django server console
            subprocess.Popen(
                [sys.executable, str(manage_py), "runserver", "8030", "--noreload"],
                cwd=str(django_dir),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
        else:
            # On Linux/Mac
            subprocess.Popen(
                [sys.executable, str(manage_py), "runserver", "8030", "--noreload"],
                cwd=str(django_dir),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        
        # Give Django a moment to start
        time.sleep(2)
        logger.info("Django web dashboard started successfully")
        print("Dashboard ready at http://localhost:8030\n")
        
    except Exception as e:
        logger.error(f"Failed to start Django server: {e}")
        print(f"Warning: Could not start Django dashboard: {e}")
        print("The application will continue without the web dashboard.\n")


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Speech-to-Text Application (Ubuntu-only, hotkey detection removed)"
    )
    parser.add_argument(
        "--apply-checks",
        action="store_true",
        help="Run dependency checks before starting the application"
    )
    return parser.parse_args()


def main():
    """Main application entry point."""
    try:
        print("\n" + "="*70)
        print("L-SPEECH-TO-TEXT - Starting...")
        print("="*70)
        
        args = parse_args()
        
        # Run dependency checks only if requested
        if args.apply_checks:
            logger.info("Running dependency checks as requested")
            # Log which checks are enabled
            enabled_checks = config.dependency_checks.get_enabled_checks()
            logger.info(f"Running dependency checks (enabled: {', '.join(enabled_checks) if enabled_checks else 'none'})")
            print("\nChecking dependencies...")
            
            results = check_all_dependencies()
            all_ok = print_results(results)
            
            if not all_ok:
                logger.error("Dependency checks failed. Please fix the issues above.")
                print("\nCannot start application due to missing dependencies.")
                print("Fix the issues above and try again.\n")
                input("\nPress ENTER to exit...")
                return 1
            
            print("\nStarting application...\n")
        else:
            logger.info("Skipping dependency checks by default")
            print("\nSkipping dependency checks (run with --apply-checks to verify dependencies)...\n")
        
        # Start Django web dashboard
        start_django_server()

        # Wait until the service is stopped via a signal
        logger.info("STT web config service is running")
        stop_event.wait()
        logger.info("STT web config service shutdown complete")
        return 0
        
    except KeyboardInterrupt:
        logger.info("Application interrupted by user")
        print("\n\nApplication stopped by user.")
        return 0
    except Exception as e:
        logger.error(f"Fatal error in main: {e}")
        import traceback
        logger.error(traceback.format_exc())
        print("\n" + "="*70)
        print("FATAL ERROR")
        print("="*70)
        print(f"\nError: {e}")
        print(f"\nError type: {type(e).__name__}")
        print("\nFull traceback:")
        print(traceback.format_exc())
        print("="*70)
        print("\nCheck logs for more details (if logs were created).")
        print("="*70)
        input("\n\nPress ENTER to exit...")
        return 1


def setup_signal_handlers():
    """Configure signal handlers so the process can exit gracefully."""
    def handle_signal(signum, frame):
        logger.info("Received signal %s, shutting down", signum)
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, handle_signal)


if __name__ == "__main__":
    try:
        setup_signal_handlers()
        exit_code = main()
        sys.exit(exit_code)
    except Exception as e:
        print("\n" + "="*70)
        print("UNHANDLED EXCEPTION AT TOP LEVEL")
        print("="*70)
        print(f"\nError: {e}")
        import traceback
        print("\nFull traceback:")
        print(traceback.format_exc())
        print("="*70)
        input("\n\nPress ENTER to exit...")
        sys.exit(1)

