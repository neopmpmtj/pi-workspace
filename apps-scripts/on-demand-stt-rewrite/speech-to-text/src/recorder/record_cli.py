#!/usr/bin/env python3
"""
Command-line interface for audio recording functionality.
Provides a simple CLI for recording, pausing, and saving audio.
"""

import os
import sys
import time
import argparse
import threading
import keyboard
import traceback
from pathlib import Path

# Import the Record class from the package
from recorder.record import Record
from common.logging_utils import get_logger

# Set up logger for this module
logger = get_logger("record_cli")

# Command constants
CMD_START = "start"
CMD_STOP = "stop"
CMD_PAUSE = "pause"
CMD_RESUME = "resume"
CMD_SAVE = "save"
CMD_DISCARD = "discard"

# Keyboard shortcuts (default)
KEY_PAUSE = "ctrl+space"
KEY_STOP = "ctrl+q"
KEY_SAVE = "ctrl+s"
KEY_DISCARD = "ctrl+d"

class RecorderCLI:
    """Command-line interface for the audio recorder."""
    
    def __init__(self):
        """Initialize the recorder CLI."""
        self.recorder = Record()
        self.recording_thread = None
        self.is_running = False
        self.custom_filename = None
    
    def start_recording(self, custom_filename=None):
        """Start recording audio."""
        try:
            logger.info("Starting recording")
            self.custom_filename = custom_filename
            
            if not self.recorder.start():
                print("Failed to start recording. Check logs for details.")
                return False
            
            print(f"Recording started. Press {KEY_PAUSE} to pause/resume, {KEY_STOP} to stop.")
            print(f"Press {KEY_SAVE} to save or {KEY_DISCARD} to discard.")
            
            # Register keyboard handlers
            keyboard.add_hotkey(KEY_PAUSE, self.toggle_pause)
            keyboard.add_hotkey(KEY_STOP, self.stop_recording)
            keyboard.add_hotkey(KEY_SAVE, self.save_recording)
            keyboard.add_hotkey(KEY_DISCARD, self.discard_recording)
            
            # Mark as running
            self.is_running = True
            
            return True
        except Exception as e:
            logger.error(f"Error starting recording: {e}")
            logger.debug(traceback.format_exc())
            print(f"Error: {e}")
            return False
    
    def toggle_pause(self):
        """Toggle between pause and resume states."""
        try:
            if not self.is_running:
                return
                
            if self.recorder.state == 1:  # RECORDING
                if self.recorder.pause():
                    print("Recording paused. Press ctrl+space to resume.")
            elif self.recorder.state == 2:  # PAUSED
                if self.recorder.resume():
                    print("Recording resumed.")
        except Exception as e:
            logger.error(f"Error toggling pause/resume: {e}")
            print(f"Error: {e}")
    
    def stop_recording(self):
        """Stop the recording."""
        try:
            if not self.is_running:
                return
                
            self.is_running = False
            result = self.recorder.stop()
            
            print("Recording stopped. Options:")
            print(f"- Press {KEY_SAVE} to save")
            print(f"- Press {KEY_DISCARD} to discard")
            
            duration = self.recorder.get_duration()
            print(f"Recording duration: {duration:.2f} seconds")
            
            return result
        except Exception as e:
            logger.error(f"Error stopping recording: {e}")
            print(f"Error: {e}")
            return False
    
    def save_recording(self):
        """Save the recording to a file."""
        try:
            # If still recording, stop first
            if self.recorder.state != 0:  # Not STOPPED
                self.stop_recording()
            
            # Save the recording
            result = self.recorder.save(custom_filename=self.custom_filename)
            
            if result["status"] == "success":
                print(f"Recording saved to: {result['file_path']}")
                # Clean up and exit
                self.cleanup()
                sys.exit(0)
            else:
                print(f"Failed to save recording: {result['message']}")
                return False
        except Exception as e:
            logger.error(f"Error saving recording: {e}")
            print(f"Error: {e}")
            return False
    
    def discard_recording(self):
        """Discard the recording without saving."""
        try:
            # If still recording, stop first
            if self.recorder.state != 0:  # Not STOPPED
                self.stop_recording()
            
            if self.recorder.discard():
                print("Recording discarded.")
                # Clean up and exit
                self.cleanup()
                sys.exit(0)
            else:
                print("Failed to discard recording.")
                return False
        except Exception as e:
            logger.error(f"Error discarding recording: {e}")
            print(f"Error: {e}")
            return False
    
    def cleanup(self):
        """Clean up resources."""
        try:
            # Unregister all keyboard hooks
            keyboard.unhook_all()
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")
    
    def run_interactive(self, custom_filename=None):
        """
        Run the recorder in interactive mode, until stopped with keyboard.
        
        Args:
            custom_filename: Optional custom filename to use for saving
        """
        try:
            self.start_recording(custom_filename)
            
            print("\nRecording... Press Ctrl+C to exit completely")
            
            # Keep the main thread alive to process keyboard events
            try:
                while True:
                    time.sleep(0.1)
            except KeyboardInterrupt:
                print("\nExiting...")
                if self.recorder.state != 0:  # Not STOPPED
                    self.stop_recording()
                self.cleanup()
        except Exception as e:
            logger.error(f"Error in interactive mode: {e}")
            logger.debug(traceback.format_exc())
            print(f"Error: {e}")
            self.cleanup()


def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description="Audio Recorder CLI")
    parser.add_argument("command", choices=[CMD_START, CMD_STOP, CMD_PAUSE, CMD_RESUME, CMD_SAVE, CMD_DISCARD],
                        help="Command to execute")
    parser.add_argument("--filename", "-f", help="Custom filename for saving (without extension)")
    
    return parser.parse_args()


def main():
    """Main entry point for the CLI."""
    args = parse_args()
    cli = RecorderCLI()
    
    if args.command == CMD_START:
        cli.run_interactive(args.filename)
    else:
        print(f"Command '{args.command}' is only available in interactive mode.")
        print("Please start the recorder first with 'record_cli.py start'")
        return 1
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
