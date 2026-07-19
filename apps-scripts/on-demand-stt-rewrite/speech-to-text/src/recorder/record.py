"""
Record class for audio recording functionality.

This module provides a class for recording, pausing, resuming, and saving audio.
Audio is kept in memory until explicitly saved.
"""

import io
import time
import wave
import queue
import threading
import numpy as np
import sounddevice as sd
from datetime import datetime
from pathlib import Path
import traceback

from common.logging_utils import get_logger
from recorder.configs.recorder_config import config

# Get script directory for reliable absolute paths
SCRIPT_DIR = Path(__file__).resolve().parent

class RecordingState:
    """Enumeration for recording states."""
    STOPPED = 0
    RECORDING = 1
    PAUSED = 2


class Record:
    """
    Handles audio recording with memory-only storage until saved.
    
    Features:
    - Start/stop/pause/resume recording
    - Save recording to file with timestamp
    - Discard recording without saving
    """
    
    def __init__(self):
        """Initialize the recorder with configuration settings."""
        # Set up logger for the recorder module
        self.logger = get_logger("recorder")
        self.logger.debug("Loading recorder configuration")
        
        # Load configuration from Python config module
        cfg = config
        
        # Audio configuration
        self.sample_rate = cfg.audio.sample_rate
        self.channels = cfg.audio.channels
        self.bit_depth = cfg.audio.bit_depth
        self.buffer_size = cfg.audio.buffer_size
        
        # Output configuration
        self.save_to_file = cfg.output.save_to_file
        self.base_filename = cfg.output.base_filename
        self.timestamp_format = cfg.output.timestamp_format
        self.output_directory = cfg.output.output_directory
        self.format = cfg.output.format
        
        # Feedback configuration
        self.show_status_messages = cfg.feedback.show_status_messages
        
        # Internal state
        self.state = RecordingState.STOPPED
        self.audio_data = []
        self.audio_queue = queue.Queue()
        self.stream = None
        self.thread = None
        self.start_time = None
        self.paused_time = 0
        self.logger.debug("Recorder initialized with config")
    
    def _audio_callback(self, indata, frames, time_info, status):
        """
        Callback function for sounddevice stream.
        Queues audio data for processing.
        """
        if status:
            status_flags = ', '.join(f'{name}' for name in dir(status) if getattr(status, name) is True)
            self.logger.warning(f"Audio callback status: {status_flags}")
        
        # Only queue data if we are in RECORDING state
        if self.state == RecordingState.RECORDING:
            self.audio_queue.put(indata.copy())
    
    def _process_audio_thread(self):
        """
        Background thread to process audio data from the queue.
        """
        try:
            while True:
                # Get audio data from the queue
                data = self.audio_queue.get()
                
                # Check if this is the termination signal
                if data is None:
                    break
                
                # Store data in our list
                self.audio_data.append(data)
                
                # Mark task as done
                self.audio_queue.task_done()
        except Exception as e:
            self.logger.error(f"Error in audio processing thread: {e}")
            self.logger.debug(traceback.format_exc())
    
    def start(self):
        """
        Start audio recording.
        
        Returns:
            bool: True if recording started successfully, False otherwise
        """
        if self.state != RecordingState.STOPPED:
            self.logger.warning("Cannot start: recording already in progress")
            return False
        
        try:
            # Clear any previous data
            self.audio_data = []
            
            # Start the audio processing thread
            self.thread = threading.Thread(target=self._process_audio_thread, daemon=True)
            self.thread.start()
            
            # Start the audio stream
            self.stream = sd.InputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype=f'int{self.bit_depth}',
                blocksize=self.buffer_size,
                callback=self._audio_callback
            )
            self.stream.start()
            
            # Update state and time
            self.state = RecordingState.RECORDING
            self.start_time = time.time()
            self.paused_time = 0
            
            # Log and show feedback
            self.logger.info("Recording started")
            if self.show_status_messages:
                print("Recording started...")
            
            return True
        except Exception as e:
            self.logger.error(f"Failed to start recording: {e}")
            self.logger.debug(traceback.format_exc())
            if isinstance(e, sd.PortAudioError):
                self.logger.error("Audio device error - check device availability")
            
            # Clean up if we failed
            self._cleanup()
            return False
    
    def pause(self):
        """
        Pause the current recording.
        
        Returns:
            bool: True if paused successfully, False otherwise
        """
        if self.state != RecordingState.RECORDING:
            self.logger.warning("Cannot pause: not currently recording")
            return False
        
        try:
            # Update state
            self.state = RecordingState.PAUSED
            self.paused_time = time.time()
            
            # Log and show feedback
            self.logger.info("Recording paused")
            if self.show_status_messages:
                print("Recording paused...")
            
            return True
        except Exception as e:
            self.logger.error(f"Failed to pause recording: {e}")
            self.logger.debug(traceback.format_exc())
            return False
    
    def resume(self):
        """
        Resume recording after being paused.
        
        Returns:
            bool: True if resumed successfully, False otherwise
        """
        if self.state != RecordingState.PAUSED:
            self.logger.warning("Cannot resume: recording not paused")
            return False
        
        try:
            # Update state
            self.state = RecordingState.RECORDING
            
            # Log and show feedback
            self.logger.info("Recording resumed")
            if self.show_status_messages:
                print("Recording resumed...")
            
            return True
        except Exception as e:
            self.logger.error(f"Failed to resume recording: {e}")
            self.logger.debug(traceback.format_exc())
            return False
    
    def stop(self):
        """
        Stop recording but keep the audio data in memory.
        
        Returns:
            bool: True if stopped successfully, False otherwise
        """
        if self.state == RecordingState.STOPPED:
            self.logger.warning("Cannot stop: not currently recording")
            return False
        
        try:
            # Update state
            prev_state = self.state
            self.state = RecordingState.STOPPED
            
            # Stop the stream if it exists
            if self.stream:
                self.stream.stop()
                self.stream.close()
                self.stream = None
            
            # Signal the processing thread to stop and wait for it
            self.audio_queue.put(None)
            if self.thread and self.thread.is_alive():
                self.thread.join(timeout=2.0)
            self.thread = None
            
            # Log and show feedback
            action = "stopped" if prev_state == RecordingState.RECORDING else "stopped (was paused)"
            self.logger.info(f"Recording {action}")
            if self.show_status_messages:
                duration = self.get_duration()
                print(f"Recording stopped. Duration: {duration:.2f} seconds")
            
            return True
        except Exception as e:
            self.logger.error(f"Failed to stop recording: {e}")
            self.logger.debug(traceback.format_exc())
            # Attempt cleanup anyway
            self._cleanup()
            return False
    
    def save(self, custom_filename=None):
        """
        Save the recorded audio to a file.
        
        Args:
            custom_filename (str, optional): Custom filename to use instead of the default.
        
        Returns:
            dict: Result with status, message, and file_path if successful
        """
        # Check if we have audio data
        if not self.audio_data:
            self.logger.warning("Cannot save: no audio data available")
            return {
                "status": "error",
                "message": "No audio data available to save"
            }
        
        try:
            # Prepare output directory
            output_dir = Path(self.output_directory)
            if not output_dir.is_absolute():
                output_dir = SCRIPT_DIR.parent / self.output_directory
            output_dir.mkdir(parents=True, exist_ok=True)
            
            # Generate filename
            timestamp = datetime.now().strftime(self.timestamp_format)
            if custom_filename:
                filename = f"{custom_filename}_{timestamp}.{self.format}"
            else:
                filename = f"{self.base_filename}_{timestamp}.{self.format}"
            
            file_path = output_dir / filename
            
            # Convert audio data to bytes
            audio_bytes = self._get_audio_bytes()
            
            # Save to file
            with open(file_path, "wb") as f:
                f.write(audio_bytes.getbuffer())
            
            self.logger.info(f"Recording saved to {file_path}")
            if self.show_status_messages:
                print(f"Recording saved to {file_path}")
            
            return {
                "status": "success",
                "message": f"Recording saved to {file_path}",
                "file_path": str(file_path),
                "audio_bytes": audio_bytes
            }
        except Exception as e:
            self.logger.error(f"Failed to save recording: {e}")
            self.logger.debug(traceback.format_exc())
            return {
                "status": "error",
                "message": f"Failed to save recording: {str(e)}"
            }
    
    def discard(self):
        """
        Discard the current recording without saving.
        
        Returns:
            bool: True if discarded successfully
        """
        try:
            # Clear audio data
            self.audio_data = []
            
            # Clean up resources
            self._cleanup()
            
            self.logger.info("Recording discarded")
            if self.show_status_messages:
                print("Recording discarded")
            
            return True
        except Exception as e:
            self.logger.error(f"Error while discarding recording: {e}")
            self.logger.debug(traceback.format_exc())
            return False
    
    def get_duration(self):
        """
        Get the duration of the current recording in seconds.
        
        Returns:
            float: Recording duration in seconds
        """
        if not self.audio_data:
            return 0.0
        
        # Calculate from number of frames and sample rate
        total_frames = sum(len(chunk) for chunk in self.audio_data)
        return total_frames / self.sample_rate
    
    def _get_audio_bytes(self):
        """
        Convert the recorded audio data to WAV format in a BytesIO object.
        
        Returns:
            io.BytesIO: BytesIO object containing the WAV audio data
        """
        # Create a memory buffer for the WAV file
        wav_buffer = io.BytesIO()
        
        # Concatenate all audio chunks
        if self.audio_data:
            all_audio = np.concatenate(self.audio_data)
            
            # Create WAV file in memory
            with wave.open(wav_buffer, 'wb') as wav_file:
                wav_file.setnchannels(self.channels)
                wav_file.setsampwidth(self.bit_depth // 8)
                wav_file.setframerate(self.sample_rate)
                wav_file.writeframes(all_audio.tobytes())
        
        # Reset buffer position for reading
        wav_buffer.seek(0)
        return wav_buffer
    
    def _cleanup(self):
        """Clean up resources."""
        try:
            # Stop the stream if it exists
            if self.stream:
                self.stream.stop()
                self.stream.close()
                self.stream = None
            
            # Signal the processing thread to stop if it exists
            if self.thread and self.thread.is_alive():
                self.audio_queue.put(None)
                self.thread.join(timeout=1.0)
                self.thread = None
            
            # Update state
            self.state = RecordingState.STOPPED
        except Exception as e:
            self.logger.error(f"Error during cleanup: {e}")
