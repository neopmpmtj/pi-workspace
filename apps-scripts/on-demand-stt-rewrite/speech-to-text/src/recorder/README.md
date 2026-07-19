# Audio Recorder Module

A high-performance audio recorder for the jassist package that keeps recordings in memory until explicitly saved.

## Features

- **Memory-first recording:** All audio is kept in memory until explicitly saved
- **Fast startup:** Uses `sounddevice` for fast audio device initialization
- **Multiple control options:** Start, stop, pause, resume, save, and discard operations
- **Configurable:** JSON configuration for audio parameters and output settings
- **CLI interface:** Command-line interface with keyboard shortcuts
- **Robust error handling:** Comprehensive logging and error recovery
- **Cross-platform:** Works on Windows, macOS, and Linux

## Installation

The recorder module is part of the jassist package. No separate installation is needed if you have installed jassist.

## Configuration

The recorder uses a JSON configuration file located at `src/jassist/recorder/configs/recorder_config.json`. Default settings include:

```json
{
    "audio": {
        "sample_rate": 16000,
        "channels": 1,
        "bit_depth": 16,
        "buffer_size": 1024
    },
    "output": {
        "base_filename": "recording",
        "timestamp_format": "%Y%m%d_%H%M%S",
        "output_directory": "recordings",
        "format": "wav"
    },
    "feedback": {
        "show_status_messages": true
    }
}
```

## Usage Examples

### Using the Recorder Class in Python

```python
from jassist.recorder import Record

# Initialize the recorder
recorder = Record()

# Start recording
recorder.start()

# ... wait or perform other operations ...

# Pause recording
recorder.pause()

# ... wait ...

# Resume recording
recorder.resume()

# ... wait ...

# Stop recording
recorder.stop()

# Save the recording
result = recorder.save(custom_filename="my_recording")
if result["status"] == "success":
    print(f"Saved to {result['file_path']}")
    
    # You can access the audio bytes if needed
    audio_bytes = result["audio_bytes"]
    
# OR discard the recording without saving
# recorder.discard()
```

### Using the Command-Line Interface

#### Starting a Recording

```bash
# Start with default filename
python -m jassist.recorder.record_cli start

# Start with custom filename
python -m jassist.recorder.record_cli start --filename my_recording
```

#### Keyboard Controls

Once recording has started, you can use these keyboard shortcuts:

- **Ctrl+Space**: Toggle between pause and resume
- **Ctrl+Q**: Stop recording
- **Ctrl+S**: Save the recording (will stop first if needed)
- **Ctrl+D**: Discard the recording (will stop first if needed)
- **Ctrl+C**: Exit completely (emergency exit)

## API Reference

### Record Class

#### `__init__()`
Initialize the recorder with configuration from the JSON file.

#### `start()`
Start recording audio.
- **Returns**: `bool` - Success status

#### `pause()`
Pause the current recording.
- **Returns**: `bool` - Success status

#### `resume()`
Resume a paused recording.
- **Returns**: `bool` - Success status

#### `stop()`
Stop recording but keep the audio data in memory.
- **Returns**: `bool` - Success status

#### `save(custom_filename=None)`
Save the recorded audio to a file.
- **Parameters**:
  - `custom_filename` (str, optional): Custom base filename (timestamp will be appended)
- **Returns**: `dict` with keys:
  - `status`: "success" or "error"
  - `message`: Description
  - `file_path`: Path to saved file (if successful)
  - `audio_bytes`: BytesIO object with WAV data (if successful)

#### `discard()`
Discard the recording without saving.
- **Returns**: `bool` - Success status

#### `get_duration()`
Get the duration of the current recording in seconds.
- **Returns**: `float` - Duration in seconds

### RecorderCLI Class

#### `run_interactive(custom_filename=None)`
Run the recorder in interactive mode with keyboard controls.
- **Parameters**:
  - `custom_filename` (str, optional): Custom filename for saving

## Error Handling

The recorder provides detailed error messages and logs. Common issues include:

- **Audio device not available**: Check your audio input device connections
- **Permission denied**: Ensure your application has permission to access audio devices
- **Invalid configuration**: Verify your recorder_config.json file has the correct format

## Advanced Usage

### Getting Audio Bytes Without Saving to File

```python
from jassist.recorder import Record

recorder = Record()
recorder.start()
# ... record audio ...
recorder.stop()

# Get audio bytes directly without saving to disk
audio_bytes = recorder._get_audio_bytes()

# Use the audio bytes for further processing
# e.g., send to a speech recognition API
```

### Using a Different Output Directory

You can change the output directory at runtime:

```python
from jassist.recorder import Record
from pathlib import Path

recorder = Record()
recorder.output_directory = Path.home() / "my_recordings"
```

## Troubleshooting

### Recording Not Starting

- Check if your microphone is properly connected
- Verify microphone permissions in your operating system
- Check the logs at `src/jassist/logs/recorder.log`

### Audio Quality Issues

- Adjust the `sample_rate` and `bit_depth` in the configuration file
- For voice recordings, 16kHz mono (1 channel) is usually sufficient
- For music or higher quality, use 44.1kHz stereo (2 channels) with 24-bit depth

### High Memory Usage

The recorder keeps all audio in memory until saved. For very long recordings, monitor your application's memory usage and consider implementing a maximum recording duration in your application.

## Contributing

Contributions to improve the recorder module are welcome. Please ensure that your changes maintain backward compatibility and are well-tested. 