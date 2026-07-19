# Language Configuration Debug Enhancement

## Changes Made

Enhanced debug logging in `src/transcriber/transcribe.py` to help diagnose language configuration issues.

## What Was Added

### 1. Configuration Loading Debug Output

When the transcriber loads configuration, you'll now see:

```
[CONFIG] Looking for runtime config at: C:\Users\...\runtime_config.json
[CONFIG] Runtime config loaded successfully
[CONFIG] Language: de
[CONFIG] Model: whisper-1
```

Or if there's an issue:

```
[CONFIG] Runtime config file not found
[CONFIG] Using default values - language: pt, model: whisper-1
```

### 2. API Request Debug Output

Before sending to OpenAI API, you'll see:

```
[API] Preparing request to OpenAI Whisper API
[API] Language parameter: 'de'
[API] Model parameter: 'whisper-1'
```

## How to Use This Debug Information

### Step 1: Verify Configuration is Loading

When you make a transcription, watch the console output. You should see:

1. **Path Check**: Confirms where it's looking for `runtime_config.json`
2. **Load Status**: Shows if file was found and loaded
3. **Values**: Displays the actual language and model being used

### Step 2: Verify API Request

Check that the language parameter matches what you set in `runtime_config.json`.

### Step 3: Troubleshooting

#### If language shows wrong value:
- **Check file location**: Make sure `runtime_config.json` is in project root
- **Restart application**: Kill any old `main.py` processes and restart
- **Check JSON syntax**: Verify the file is valid JSON

#### If language shows correct value but transcription is still in English:
This indicates the OpenAI API might be:
- Auto-detecting language based on audio content
- Ignoring the language parameter for certain models
- Using language as a "hint" rather than strict requirement

## Testing Your Configuration

1. **Set language in runtime_config.json**:
   ```json
   {
     "transcription": {
       "language": "de",
       "model": "whisper-1"
     },
     "paste": {
       "add_timestamp": true
     }
   }
   ```

2. **Restart the application**:
   ```bash
   python main.py
   ```

3. **Make a test recording** with the hotkey

4. **Check console output**:
   - Look for `[CONFIG]` messages showing loaded language
   - Look for `[API]` messages showing language sent to API

5. **Compare**: If `[API] Language parameter: 'de'` appears but transcription is in English, the issue is with OpenAI API behavior, not your configuration.

## Important Notes

### OpenAI Whisper API Behavior

The OpenAI Whisper API `language` parameter is used as a **hint** to improve accuracy, but Whisper may still:
- Auto-detect the actual language from the audio
- Output in a different language if it's confident in the detection
- Mix languages if the audio contains multiple languages

**This is normal behavior** for Whisper API.

### When Language Parameter Works Best

The language parameter is most effective when:
- Audio quality is poor (helps guide the model)
- Audio contains technical terms in specific language
- You want to force transcription in a specific language for consistency

### Workaround for Strict Language Control

If you need strict language control:
1. Use the `prompt` parameter with text in target language
2. Post-process transcription to detect/translate if needed
3. Consider using different OpenAI models (gpt-4o-transcribe might behave differently)

## Summary

The debug logging will help you verify:
✅ Configuration file is being read correctly  
✅ Language parameter is being loaded properly  
✅ Correct values are being sent to OpenAI API  

If all three are correct but transcription is still in wrong language, it's OpenAI Whisper's auto-detection at work, not a configuration issue.

