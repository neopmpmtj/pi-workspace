import argparse
import io
import os
import sys
from pathlib import Path

# Import from package
from transcriber.transcribe import Transcriber
from common.logging_utils import get_logger

# Import pydub for audio conversion
try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False

# Supported audio formats
SUPPORTED_FORMATS = {'.wav', '.mp3', '.aac', '.m4a'}

def parse_arguments():
    """Parse command line arguments for the transcription CLI."""
    parser = argparse.ArgumentParser(
        description="Transcribe audio files using OpenAI Whisper API"
    )
    
    parser.add_argument(
        "--input", "-i", 
        required=True,
        help="Path to the input audio file (supported formats: WAV, MP3, AAC, M4A)"
    )
    
    parser.add_argument(
        "--output", "-o",
        help="Path to save the transcription output (default: input_filename.txt)"
    )
    
    parser.add_argument(
        "--language",
        help="Language code for transcription (e.g., 'en', 'fr', 'es')"
    )
    
    parser.add_argument(
        "--model",
        help="Whisper model to use (default from config)"
    )
    
    parser.add_argument(
        "--temperature",
        type=float,
        help="Temperature for transcription (0.0 to 1.0)"
    )
    
    parser.add_argument(
        "--prompt",
        help="Optional prompt to guide the transcription"
    )
    
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force processing even if file is not in a supported format (use with caution)"
    )
    
    parser.add_argument(
        "--no-convert",
        action="store_true",
        help="Disable automatic conversion from non-WAV formats to WAV"
    )
    
    return parser.parse_args()

def convert_to_wav(file_path, logger):
    """Convert audio file to WAV format using pydub."""
    if not PYDUB_AVAILABLE:
        logger.error("pydub is not installed. Cannot convert audio formats.")
        print("Error: pydub is required for audio format conversion.")
        print("Please install it using: pip install pydub")
        sys.exit(1)
    
    try:
        # Get the file extension
        file_ext = file_path.suffix.lower()
        logger.debug(f"Converting {file_ext} file to WAV: {file_path}")
        
        # Load the audio file based on its format
        if file_ext == '.mp3':
            audio = AudioSegment.from_mp3(file_path)
        elif file_ext == '.aac' or file_ext == '.m4a':
            audio = AudioSegment.from_file(file_path, format="aac" if file_ext == '.aac' else "m4a")
        else:
            # For other formats, let pydub try to figure it out
            audio = AudioSegment.from_file(file_path)
        
        # Convert to WAV (in memory)
        wav_data = io.BytesIO()
        audio.export(wav_data, format="wav")
        wav_data.seek(0)
        
        logger.debug(f"Successfully converted {file_ext} to WAV (size: {wav_data.getbuffer().nbytes} bytes)")
        return wav_data
    except Exception as e:
        logger.error(f"Failed to convert audio format: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise

def read_audio_file(file_path, convert=True, logger=None):
    """
    Read an audio file into a BytesIO object.
    If the file is not WAV and convert=True, automatically convert it to WAV.
    """
    try:
        # Check if conversion is needed
        if convert and file_path.suffix.lower() != '.wav':
            logger.debug(f"Non-WAV format detected, converting to WAV: {file_path}")
            return convert_to_wav(file_path, logger)
        else:
            # Just read the file as binary
            with open(file_path, "rb") as f:
                audio_bytes = io.BytesIO(f.read())
            return audio_bytes
    except Exception as e:
        if logger:
            logger.error(f"Failed to read audio file: {e}")
        raise

def validate_audio_format(file_path, force=False):
    """
    Validate that the file is in a supported audio format.
    Returns True if valid or force is True, False otherwise.
    """
    # If force is enabled, skip validation
    if force:
        return True
        
    # Check file extension is in supported formats
    file_ext = file_path.suffix.lower()
    if file_ext not in SUPPORTED_FORMATS:
        return False
    
    # Basic validation for WAV files
    if file_ext == '.wav':
        try:
            with open(file_path, 'rb') as f:
                header = f.read(12)
                # Check for RIFF header and WAVE format
                if header[0:4] != b'RIFF' or header[8:12] != b'WAVE':
                    return False
        except Exception:
            return False
    
    # For other formats, we'll let pydub handle validation during conversion
    return True

def main():
    """Main function to handle the CLI transcription process."""
    # Parse command line arguments
    args = parse_arguments()
    
    # Set up logger
    global logger
    logger = get_logger("transcribe_cli")
    logger.debug(f"Starting CLI transcription with arguments: {args}")
    
    # Convert input path to absolute path
    input_path = Path(args.input).resolve()
    logger.debug(f"Input file: {input_path}")
    
    # Check if input file exists
    if not input_path.exists():
        logger.error(f"Input file not found: {input_path}")
        print(f"Error: Input file not found: {input_path}")
        sys.exit(1)
    
    # Check if pydub is available for conversion
    if not PYDUB_AVAILABLE and input_path.suffix.lower() != '.wav' and not args.no_convert:
        logger.warning("pydub is not installed but non-WAV format detected.")
        print("Warning: pydub is not installed for audio format conversion.")
        print("Attempting to process the file directly, which may not work with the OpenAI API.")
    
    # Validate file format
    if not validate_audio_format(input_path, args.force):
        logger.error(f"Unsupported audio format: {input_path}")
        print(f"Error: Unsupported audio format: {input_path}")
        print(f"Supported formats: {', '.join(SUPPORTED_FORMATS)}")
        print("Use --force to attempt processing this file anyway (may not work with OpenAI API)")
        sys.exit(1)
    
    # Determine output file path
    if args.output:
        output_path = Path(args.output).resolve()
    else:
        # Default to input filename with .txt extension
        output_path = input_path.with_suffix(".txt")
    logger.debug(f"Output file: {output_path}")
    
    try:
        # Initialize transcriber
        transcriber = Transcriber()
        logger.debug("Transcriber initialized")
        
        # Override config settings if provided in arguments
        if args.language:
            transcriber.language = args.language
            logger.debug(f"Language override: {args.language}")
        
        if args.model:
            transcriber.model = args.model
            logger.debug(f"Model override: {args.model}")
        
        if args.temperature is not None:
            transcriber.temperature = args.temperature
            logger.debug(f"Temperature override: {args.temperature}")
            
        if args.prompt:
            transcriber.prompt = args.prompt
            logger.debug(f"Prompt override: {args.prompt}")
        
        # Read audio file (with auto-conversion if needed)
        print(f"Reading audio file: {input_path}")
        audio_bytes = read_audio_file(input_path, 
                                     convert=not args.no_convert and input_path.suffix.lower() != '.wav',
                                     logger=logger)
        
        # Transcribe audio
        print(f"Transcribing audio using OpenAI Whisper API (model: {transcriber.model})...")
        result = transcriber.transcribe(audio_bytes)
        
        if not result:
            logger.error("Transcription failed or returned empty result")
            print("Error: Transcription failed or returned empty result")
            sys.exit(1)
        
        # Display the transcription result
        print("\nTranscription result:")
        print("-" * 40)
        print(result)
        print("-" * 40)
        
        # Save to output file
        print(f"Saving transcription to: {output_path}")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(result)
        
        logger.info(f"Transcription completed and saved to {output_path}")
        print(f"Transcription completed successfully!")
        
    except Exception as e:
        logger.error(f"Transcription process failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
