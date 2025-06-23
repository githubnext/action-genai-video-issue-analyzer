#!/bin/sh

# Set the script name from the input parameter, defaulting to action-video-issue-analyzer
export SCRIPT_NAME="${INPUT_SCRIPT:-action-video-issue-analyzer}"

# Set the whisper API base
export WHISPERASR_API_BASE=http://whisper:9000

# Run the action
npm --prefix /genaiscript/action run action