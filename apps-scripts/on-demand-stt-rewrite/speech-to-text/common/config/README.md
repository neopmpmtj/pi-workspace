# Application Configuration

This directory contains application-level configuration settings.

## Files

- `config_app.py` - Main application configuration with dependency check flags
- `__init__.py` - Package initialization with exports

## Usage

### Importing the Configuration

```python
from common.config import config
```

### Modifying Dependency Check Flags

The configuration allows you to enable or disable specific dependency checks:

```python
from common.config import config

# Disable FFmpeg check
config.dependency_checks.check_ffmpeg = False

# Enable pydub check (default is True)
config.dependency_checks.check_pydub = True

# Disable OpenAI API key check
config.dependency_checks.check_openai_api_key = False

# Get list of enabled checks
enabled = config.dependency_checks.get_enabled_checks()
print(enabled)  # ['pydub']
```

### Configuration Structure

```python
@dataclass
class DependencyCheckFlags:
    check_ffmpeg: bool = True           # Check FFmpeg installation
    check_pydub: bool = True            # Check pydub package
    check_openai_api_key: bool = True   # Check OpenAI API key

@dataclass
class AppConfig:
    dependency_checks: DependencyCheckFlags
    
config = AppConfig()  # Global configuration instance
```

### Example: Programmatically Modify Checks

```python
from common.config import config

# In your startup script
def setup_custom_checks():
    """Configure checks for testing environment."""
    # Skip FFmpeg check if running in CI
    import os
    if os.environ.get('CI'):
        config.dependency_checks.check_ffmpeg = False
```

### Where to Modify Values

Edit `common/config/config_app.py` to change default values:

```python
# In config_app.py
@dataclass
class DependencyCheckFlags:
    check_ffmpeg: bool = True          # Change to False to disable
    check_pydub: bool = True           # Change to False to disable
    check_openai_api_key: bool = True   # Change to False to disable
```

Or modify at runtime:

```python
from common.config import config

# At runtime (e.g., in main.py before running checks)
config.dependency_checks.check_ffmpeg = False
```

## Integration

The configuration is automatically used by:
- `src/check_dependencies.py` - Dependency checker respects the flags
- `main.py` - Shows which checks are enabled before running

### Running the Application

```bash
# Normal run (skips dependency checks by default)
python main.py

# Run dependency checks (when --apply-checks flag is used)
python main.py --apply-checks
```

## Output Example

When dependency checks run, you'll see which checks are enabled:

```
Checking dependencies...
======================================================================
DEPENDENCY CHECK RESULTS
======================================================================
Enabled checks: pydub, openai_api_key
Disabled checks: ffmpeg
======================================================================
[OK] pydub is installed
[OK] OPENAI_API_KEY is set (sk-1...abc2)
======================================================================
[OK] All checked dependencies are satisfied!
```

