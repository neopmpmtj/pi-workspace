"""
File Moving Utilities Module

This module provides utilities for moving processed files from the downloads
directory to the processed directory after successful transcription/ingestion.

Key Features:
- Move entire UUID folders atomically
- Preserve folder structure
- Handle naming conflicts automatically
- Cross-platform path handling
- Comprehensive logging

Author: [Your Name]
Date: [Current Date]
Version: 1.0.0
"""

import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from common.logging_utils.logging_config import get_logger

# Initialize logger for this module
logger = get_logger('file_move_utils')


def get_uuid_folder(file_path: Path) -> Path:
    """
    Get the UUID folder (parent directory) of a file.
    
    Args:
        file_path (Path): Path to a file within a UUID folder
        
    Returns:
        Path: The parent UUID folder path
        
    Example:
        >>> get_uuid_folder(Path("downloads/uuid-123/file.mp3"))
        Path("downloads/uuid-123")
    """
    return file_path.parent


def move_uuid_folder(source_folder: Path, processed_root: Path) -> Path:
    """
    Move an entire UUID folder from downloads to processed directory.
    
    This function moves the entire UUID folder atomically, preserving its
    structure and contents. If a folder with the same name exists in the
    processed directory, a timestamp is appended to avoid conflicts.
    
    Args:
        source_folder (Path): Path to the UUID folder in downloads
        processed_root (Path): Root directory for processed files
        
    Returns:
        Path: The new path where the folder was moved
        
    Raises:
        OSError: If the move operation fails
        ValueError: If source_folder doesn't exist or isn't a directory
        
    Example:
        >>> move_uuid_folder(
        ...     Path("downloads/uuid-123"),
        ...     Path("processed")
        ... )
        Path("processed/uuid-123")
    """
    logger.debug(f"Attempting to move folder: {source_folder} -> {processed_root}")
    
    # Validate source folder
    if not source_folder.exists():
        error_msg = f"Source folder does not exist: {source_folder}"
        logger.error(error_msg)
        raise ValueError(error_msg)
    
    if not source_folder.is_dir():
        error_msg = f"Source path is not a directory: {source_folder}"
        logger.error(error_msg)
        raise ValueError(error_msg)
    
    # Ensure processed root exists
    processed_root = Path(processed_root)
    if not processed_root.exists():
        logger.info(f"Creating processed directory: {processed_root}")
        processed_root.mkdir(parents=True, exist_ok=True)
    
    # Determine destination path
    folder_name = source_folder.name
    destination = processed_root / folder_name
    
    # Handle naming conflicts by appending timestamp
    if destination.exists():
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        new_folder_name = f"{folder_name}-{timestamp}"
        destination = processed_root / new_folder_name
        logger.warning(
            f"Destination folder already exists, using timestamped name: {new_folder_name}"
        )
    
    # Perform the move operation
    try:
        logger.info(f"Moving folder: {source_folder} -> {destination}")
        shutil.move(str(source_folder), str(destination))
        logger.info(f"Successfully moved folder to: {destination}")
        return destination
    except Exception as e:
        error_msg = f"Failed to move folder from {source_folder} to {destination}: {e}"
        logger.error(error_msg)
        raise OSError(error_msg) from e


def ensure_processed_dir_exists(processed_root: Path) -> None:
    """
    Ensure the processed directory exists, creating it if necessary.
    
    Args:
        processed_root (Path): Path to the processed directory
        
    Raises:
        OSError: If the directory cannot be created
    """
    try:
        if not processed_root.exists():
            logger.info(f"Creating processed directory: {processed_root}")
            processed_root.mkdir(parents=True, exist_ok=True)
            logger.debug(f"Processed directory created successfully")
    except Exception as e:
        error_msg = f"Failed to create processed directory {processed_root}: {e}"
        logger.error(error_msg)
        raise OSError(error_msg) from e
