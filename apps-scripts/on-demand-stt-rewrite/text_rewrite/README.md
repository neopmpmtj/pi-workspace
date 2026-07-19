# Text Rewrite

A powerful, modular Python package for rewriting and transforming text using OpenAI's API. Select from multiple predefined prompt templates or create your own custom prompts to transform clipboard text. Designed to work with Ubuntu keyboard shortcuts for seamless integration.

## Features

- 🚀 **Multi-Prompt Support**: Choose from 5+ predefined prompt templates
- ⌨️ **Ubuntu Keyboard Shortcut Integration**: Trigger rewrite operations via system keyboard shortcuts
- 🖥️ **CLI Interface**: Command-line interface for automation and scripting
- 🔧 **Custom Prompts**: Create and use your own prompt templates
- 📋 **Clipboard Integration**: Automatically reads from and writes to clipboard
- 🎯 **Modular Design**: Clean, extensible architecture for easy customization
- 🔐 **Environment Configuration**: Secure API key management via environment variables

## Installation

### Prerequisites

- Python 3.8 or higher
- OpenAI API key
- Ubuntu/Linux system with `xdotool` installed (for automatic pasting)

### Install from Source

1. Clone or download this repository
2. Navigate to the project directory
3. Create and activate a virtual environment:
   ```bash
   python -m venv .venv
   # On Windows:
   .venv\Scripts\activate
   # On macOS/Linux:
   source .venv/bin/activate
   ```
4. Install system dependencies:
   ```bash
   sudo apt-get install xdotool
   ```

5. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### Dependencies

**Python packages** (install via requirements.txt):
- `openai>=1.40,<2.0` - OpenAI API client
- `pyperclip>=1.8.2` - Clipboard operations
- `python-dotenv>=1.0.0` - Environment variable loading

**System dependencies** (install via package manager):
- `xdotool` - Keyboard automation for Linux (install with: `sudo apt-get install xdotool`)

## Quick Start

### 1. Set up your OpenAI API Key

Create a `.env` file in the project root:
```bash
OPENAI_API_KEY=your_openai_api_key_here
```

Or set it as an environment variable:
```bash
# Windows
set OPENAI_API_KEY=your_openai_api_key_here

# macOS/Linux
export OPENAI_API_KEY=your_openai_api_key_here
```

### 2. Basic Usage

#### Using the Wrapper Script (Recommended)

```bash
# List available prompts
./text_rewrite.sh --list-prompts

# Use a specific prompt (executes once and exits)
./text_rewrite.sh --prompt grammar

# Use custom prompt
./text_rewrite.sh --custom-prompt "Summarize this text: {text}"
```

#### Direct Python Execution

```bash
# Set PYTHONPATH first
export PYTHONPATH="/home/pmpmt/Documents/All Documents/cursor_scripts_python/251220-text_rewrite/text_rewrite:$PYTHONPATH"

# List available prompts
python3 -m src.text_rewrite --list-prompts

# Use a specific prompt (executes once and exits)
python3 -m src.text_rewrite --prompt grammar

# Use custom prompt
python3 -m src.text_rewrite --custom-prompt "Summarize this text: {text}"
```

#### Ubuntu Keyboard Shortcut Setup

1. Open Ubuntu Settings → Keyboard → Keyboard Shortcuts
2. Click "Custom Shortcuts" or "Add Custom Shortcut"
3. Add a new shortcut:
   - **Name**: Text Rewrite
   - **Command**: `/path/to/venv/bin/python -m text_rewrite --prompt grammar`
     (Replace with your actual virtual environment path and desired prompt)
   - **Shortcut**: Choose your preferred key combination (e.g., `Ctrl+Alt+R`)

4. Usage:
   - Copy any text to your clipboard
   - Press your configured keyboard shortcut
   - The text will be rewritten and automatically pasted at your cursor position

## Available Prompts

### Built-in Prompt Templates

| Prompt | Description | Use Case |
|--------|-------------|----------|
| `story` | Write a short fictional story | Creative writing, storytelling |
| `fairytale` | Write a fairy tale story | Children's content, fantasy |
| `grammar` | Polish grammar and clarity | Professional documents, emails |
| `professional` | Convert to professional tone | Business communication |
| `casual` | Convert to casual tone | Social media, informal writing |

### Example Outputs

**Input:** "The meeting was good. We talked about stuff."

**Grammar Prompt:**
> The meeting was productive. We discussed various topics and reached several important conclusions.

**Professional Prompt:**
> The meeting was successful and productive. We engaged in comprehensive discussions covering multiple agenda items and achieved meaningful outcomes.

**Casual Prompt:**
> The meeting went really well! We chatted about a bunch of different things and it was pretty helpful.

## Adding Custom Prompts

### Method 1: Using CLI (Temporary)

```bash
# Using module
python -m text_rewrite --custom-prompt "Translate to French: {text}"
```

### Method 2: Adding to Code (Permanent)

1. Open `src/text_rewrite/config/text_rewrite_config.py`
2. Add your prompt to the `PROMPT_TEMPLATES` dictionary:

```python
PROMPT_TEMPLATES = {
    'story': (
        "Write a short fictional story with the inputted text\n\n"
        "Text: {text}\n\n"
        "Story:"
    ),
    # Add your custom prompt here
    'translate_spanish': (
        "Translate the following text to Spanish, maintaining the original tone and meaning:\n\n"
        "Text: {text}\n\n"
        "Spanish Translation:"
    ),
    'summarize': (
        "Provide a concise summary of the following text in 2-3 sentences:\n\n"
        "Text: {text}\n\n"
        "Summary:"
    ),
    'expand': (
        "Expand the following text with more detail, examples, and context:\n\n"
        "Text: {text}\n\n"
        "Expanded Version:"
    ),
    'technical': (
        "Rewrite the following text using technical terminology and formal language:\n\n"
        "Text: {text}\n\n"
        "Technical Version:"
    )
}
```

3. Use your new prompt:
```bash
# Using module
python -m text_rewrite --prompt translate_spanish
python -m text_rewrite --prompt summarize
```

### Method 3: Environment Variable (Runtime)

Set a custom prompt template via environment variable:
```bash
set REWRITE_PROMPT_TEMPLATE="Your custom prompt here: {text}"

# Using module
python -m text_rewrite
```

## Stateful Configuration

The package can remember your last-used settings and apply them as defaults for the next run.

### How It Works

When enabled (default), the package saves your configuration choices to `.text_rewrite_state.json`:
- Last used prompt template
- Model selection
- Temperature setting
- Max tokens setting

### Usage Examples

```bash
# Run with grammar prompt - will be saved as default
python -m text_rewrite --prompt grammar

# Next run uses grammar automatically
python -m text_rewrite

# Disable state saving for this run
python -m text_rewrite --prompt story --no-save-state

# Clear saved state
python -m text_rewrite --clear-state
```

### Disabling State Saving

**Permanently disable:**
```bash
# Set environment variable
set SAVE_STATE=false
```

**One-time disable:**
```bash
python -m text_rewrite --no-save-state
```

### Priority Order (Updated)

1. CLI flags (`--prompt`, `--custom-prompt`)
2. Environment variables (`REWRITE_PROMPT_TEMPLATE`)
3. **Saved state file** (`.text_rewrite_state.json`) ← NEW
4. Default in code ('story')

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | Your OpenAI API key | Required |
| `OPENAI_MODEL` | OpenAI model to use | `gpt-3.5-turbo` |
| `TEMPERATURE` | Text generation temperature | `0.0` |
| `MAX_TOKENS` | Maximum response tokens | `800` |
| `REWRITE_PROMPT_TEMPLATE` | Custom prompt template | Uses predefined prompts |
| `MAX_RETRIES` | API retry attempts | `3` |
| `RETRY_DELAY` | Initial retry delay (seconds) | `1.0` |
| `RETRY_BACKOFF_FACTOR` | Retry delay multiplier | `2.0` |
| `SAVE_STATE` | Enable/disable state saving | `true` |

### Configuration Priority

1. **Environment variables** (highest priority)
2. **`.env` file** in project root
3. **Default values** in config file (lowest priority)

## Advanced Usage

### CLI Options

```bash
# Using module
python -m text_rewrite [OPTIONS]

Options:
  --prompt {story,fairytale,grammar,professional,casual}
                        Select a predefined prompt template
  --custom-prompt TEXT  Use a custom prompt template
  --list-prompts        List available prompt templates and exit
  --show-config         Show current default configuration settings and exit
  --model TEXT          OpenAI model to use (overrides config)
  --temperature FLOAT   Temperature for text generation (overrides config)
  --max-tokens INTEGER  Maximum tokens for response (overrides config)
  --verbose, -v         Enable verbose logging
  --no-save-state       Do not save current configuration as default for next run
  --clear-state         Clear saved state and exit
  --help                Show help message and exit
```

### Examples

```bash
# Use GPT-4 with custom temperature
python -m text_rewrite --prompt grammar --model gpt-4 --temperature 0.3

# Verbose logging
python -m text_rewrite --prompt story --verbose

# Custom prompt with specific model
python -m text_rewrite --custom-prompt "Make this more formal: {text}" --model gpt-4

# List all available prompts
python -m text_rewrite --list-prompts

# Show current configuration settings
python -m text_rewrite --show-config

# Clear saved state
python -m text_rewrite --clear-state

# Run without saving state
python -m text_rewrite --prompt grammar --no-save-state
```

### Programmatic Usage

```python
from text_rewrite import RewriteEngine, RewriteConfig

# Load configuration
config = RewriteConfig.load_config(prompt_name='grammar')

# Create engine
engine = RewriteEngine(config)

# Rewrite text directly
rewritten_text = engine.rewrite_text("Your text here")
print(rewritten_text)

# Or use the convenience function
from text_rewrite import rewrite_clipboard_text
success = rewrite_clipboard_text()
```

## Ubuntu Keyboard Shortcut Integration

The script is designed to be triggered by Ubuntu's keyboard shortcut system. Each execution performs a single rewrite operation and exits.

### Setting Up a Keyboard Shortcut

**Option 1: Using the wrapper script (recommended)**

1. **Use the provided wrapper script:**
   ```bash
   /home/pmpmt/Documents/All\ Documents/cursor_scripts_python/251220-text_rewrite/text_rewrite/text_rewrite.sh --prompt grammar
   ```
   (Replace with your actual project path)

2. **Add to Ubuntu Keyboard Shortcuts:**
   - Open Settings → Keyboard → Keyboard Shortcuts
   - Click "Custom Shortcuts" → "Add Custom Shortcut"
   - **Name**: Text Rewrite
   - **Command**: `/home/pmpmt/Documents/All Documents/cursor_scripts_python/251220-text_rewrite/text_rewrite/text_rewrite.sh --prompt grammar`
   - Assign your preferred key combination (e.g., `Ctrl+Alt+R`)

**Option 2: Direct Python command**

1. **Set PYTHONPATH and run:**
   ```bash
   cd /path/to/text_rewrite
   export PYTHONPATH="$(pwd):$PYTHONPATH"
   python3 -m src.text_rewrite --prompt grammar
   ```

2. **Or use the full module path:**
   ```bash
   /path/to/venv/bin/python3 -m src.text_rewrite --prompt grammar
   ```
   (Use the full path to ensure it works from the keyboard shortcut)

### Usage Workflow

1. Copy any text to your clipboard
2. Press your configured keyboard shortcut
3. The text will be rewritten and automatically pasted at your cursor position

**Note:** If `xdotool` is not installed, the text will still be copied to clipboard but automatic pasting will fail. You can manually paste with `Ctrl+V`.

## Project Structure

```
text_rewrite/
├── src/text_rewrite/
│   ├── __init__.py              # Package exports
│   ├── __main__.py              # CLI entry point
│   ├── main.py                  # Main execution entry point
│   ├── cli.py                   # Command-line interface
│   ├── config/
│   │   ├── __init__.py
│   │   └── text_rewrite_config.py  # Configuration and prompts
│   └── core/
│       ├── __init__.py
│       ├── clipboard.py         # Clipboard operations
│       └── text_rewrite_engine.py  # Core rewriting logic
├── common/                      # Shared utilities
│   ├── logging_utils/           # Logging configuration
│   └── utils/                   # File system utilities
├── requirements.txt             # Dependencies
└── README.md                    # This file
```

## Creating Your Own Prompt Templates

### Best Practices

1. **Use `{text}` placeholder**: Always include `{text}` where the input should go
2. **Be specific**: Clearly describe what transformation you want
3. **Include context**: Explain the desired tone, style, or format
4. **Test thoroughly**: Try with various input types

### Example Custom Prompts

```python
# Technical documentation
'technical_doc': (
    "Convert the following text into clear, technical documentation:\n\n"
    "Text: {text}\n\n"
    "Technical Documentation:"
),

# Email writing
'email': (
    "Write a professional email based on the following notes:\n\n"
    "Notes: {text}\n\n"
    "Email:"
),

# Code comments
'code_comments': (
    "Add detailed comments to explain this code:\n\n"
    "Code: {text}\n\n"
    "Commented Code:"
),

# Social media post
'social_media': (
    "Convert this text into an engaging social media post:\n\n"
    "Text: {text}\n\n"
    "Social Media Post:"
),

# Academic writing
'academic': (
    "Rewrite this text in academic style with proper citations:\n\n"
    "Text: {text}\n\n"
    "Academic Version:"
)
```

## Troubleshooting

### Common Issues

**"No module named text_rewrite"**
- Make sure you've installed the dependencies: `pip install -r requirements.txt`
- Check that you're in the correct virtual environment
- Run from the project root directory

**"OPENAI_API_KEY is required"**
- Set your API key in `.env` file or environment variable
- Verify the key is valid and has sufficient credits

**"Failed to paste text" or "xdotool is not installed"**
- Install xdotool: `sudo apt-get install xdotool`
- Ensure xdotool has proper permissions (usually works without special permissions)
- If xdotool fails, the text is still copied to clipboard - you can manually paste with `Ctrl+V`

**Keyboard shortcut not working**
- Verify the command path in your keyboard shortcut is correct (use absolute paths)
- Test the command manually in terminal first
- Ensure your virtual environment is activated or use full path to Python executable
- Check that the script has execute permissions

### Debug Mode

Enable verbose logging to see what's happening:

```bash
python -m text_rewrite --prompt grammar --verbose
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add your custom prompts to `text_rewrite_config.py`
4. Test thoroughly
5. Submit a pull request

## License

This project is open source. Feel free to use, modify, and distribute as needed.

## Support

For issues, questions, or feature requests, please open an issue in the repository.

---

**Happy rewriting!** 🚀
