#!/bin/sh

# Set the script name from the input parameter, defaulting to action-video-issue-analyzer
export SCRIPT_NAME="${INPUT_SCRIPT:-action-video-issue-analyzer}"

# Set the whisper API base
export WHISPERASR_API_BASE=http://whisper:9000

# Build the command arguments
ARGS="--github-workspace --pull-request-comment --no-run-trace --no-output-trace"

# Add video file path parameter if provided and using slide deck annotator
if [ "$SCRIPT_NAME" = "action-video-slide-deck-annotator" ] && [ -n "$INPUT_VIDEO_FILE_PATH" ]; then
    ARGS="$ARGS --args video_file_path=\"$INPUT_VIDEO_FILE_PATH\""
fi

# Run genaiscript directly with the selected script
cd /genaiscript/action
npx genaiscript run "$SCRIPT_NAME" $ARGS