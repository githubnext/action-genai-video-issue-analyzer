script({
  title: "Analyzes videos to detect slide transitions and generate timestamps",
  accept: "none",
  parameters: {
    instructions: {
      type: "string",
      description:
        "Custom prompting instructions for slide transition detection.",
      default:
        "Analyze the video frames to detect slide transitions in a presentation. Focus on identifying significant visual changes that indicate when slides change, ignore minor changes like cursor movement or highlighting. Generate timestamps with confidence scores for each detected transition.",
    },
    video_file_path: {
      type: "string",
      description: "Path to the video file in the repository.",
    },
  },
});

const { dbg, output, vars } = env;
const { instructions, video_file_path } = vars as {
  instructions: string;
  video_file_path?: string;
};

if (!instructions) {
  throw new Error(
    "No instructions provided. Please provide instructions to process the video.",
  );
}

if (!video_file_path) {
  throw new Error(
    "No video file path provided. Please provide the path to the video file in the repository.",
  );
}

dbg(`Processing video file: %s`, video_file_path);

// Process the video file directly
await processVideo(video_file_path);

async function processVideo(filename: string) {
  const transcript = await transcribe(filename, {
    model: "whisperasr:default",
    cache: true,
  });
  if (!transcript) {
    output.error(`no transcript found for video ${filename}.`);
  }

  // Extract frames for slide transition detection
  const frames = await ffmpeg.extractFrames(filename, {
    transcript,
  });

  const { text, error } = await runPrompt(
    (ctx) => {
      ctx.def("TRANSCRIPT", transcript?.srt, { ignoreEmpty: true }); // ignore silent videos
      ctx.defImages(frames, { detail: "high", sliceSample: 80 }); // higher detail for slide detection
      ctx.$`${instructions}

## Analysis Instructions

You are analyzing a video of a slide deck presentation. Your task is to:

1. **Detect Slide Transitions**: Identify when the content significantly changes between frames, indicating a new slide
2. **Filter Noise**: Ignore minor changes like cursor movement, highlighting, or small animations
3. **Generate Timestamps**: Provide accurate timestamps for each transition
4. **Assess Confidence**: Rate your confidence in each detection (0.0 to 1.0)
5. **Create Viewing Segments**: Generate recommended 2-minute viewing segments for each slide

## Output Format

Respond with a valid JSON object in the following format:

\`\`\`json
{
  "video_duration": "HH:MM:SS",
  "slide_transitions": [
    {
      "timestamp": "HH:MM:SS",
      "confidence": 0.95,
      "slide_number": 1,
      "description": "Brief description of the transition"
    }
  ],
  "recommended_segments": [
    {
      "start": "HH:MM:SS", 
      "end": "HH:MM:SS",
      "slide": 1,
      "description": "First 2 minutes of slide content"
    }
  ]
}
\`\`\`

## Key Guidelines

- Focus on major visual changes that clearly indicate slide transitions
- Confidence scores should reflect how certain you are about the transition
- Slide numbers should increment sequentially starting from 1
- Recommended segments should be exactly 2 minutes or until the next slide transition
- Use the transcript to help understand content changes when visual changes are ambiguous
- If frames show the same slide content, do not mark as a transition
- Look for changes in slide titles, bullet points, images, charts, or overall layout

Analyze the provided frames and transcript to detect slide transitions.`.role(
        "system",
      );
    },
    {
      systemSafety: true,
      model: "vision",
      responseType: "json",
      label: `analyze slide transitions ${filename}`,
    },
  );

  if (error) {
    output.error(error?.message);
  } else {
    // Parse and validate JSON response
    try {
      const analysisResult = JSON.parse(text);

      // Display results in a formatted way
      output.heading(4, "Slide Transition Analysis Results");
      output.code(JSON.stringify(analysisResult, null, 2), "json");

      // Also provide a summary
      if (
        analysisResult.slide_transitions &&
        analysisResult.slide_transitions.length > 0
      ) {
        output.heading(5, "Summary");
        output.p(
          `Found ${analysisResult.slide_transitions.length} slide transitions in video duration: ${analysisResult.video_duration}`,
        );

        output.heading(5, "Detected Transitions");
        for (const transition of analysisResult.slide_transitions) {
          output.p(
            `**Slide ${transition.slide_number}** at [${transition.timestamp}] (confidence: ${transition.confidence}) - ${transition.description}`,
          );
        }

        if (
          analysisResult.recommended_segments &&
          analysisResult.recommended_segments.length > 0
        ) {
          output.heading(5, "Recommended Viewing Segments");
          for (const segment of analysisResult.recommended_segments) {
            output.p(
              `**Slide ${segment.slide}**: [${segment.start}] - [${segment.end}] - ${segment.description}`,
            );
          }
        }
      } else {
        output.p("No slide transitions detected in this video.");
      }
    } catch (parseError) {
      output.error(`Failed to parse JSON response: ${parseError.message}`);
      output.heading(4, "Raw Response");
      output.appendContent(text);
    }
  }
}
