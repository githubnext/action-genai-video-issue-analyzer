script({
  title: "Analyzes videos upload as assets",
  accept: "none",
  parameters: {
    instructions: {
      type: "string",
      description: "Custom prompting instructions for each video.",
      default:
        "Analyze the video and provide a summary of its content. Extract list of followup subissues if any. The transcript is your primary source of text information, ignore text in images.",
    },
  },
});

const { dbg, output, vars } = env;
const issue = await github.getIssue();
if (!issue)
  throw new Error(
    "No issue found in the context. This action requires an issue to be present.",
  );
const { instructions } = vars as { instructions: string };
if (!instructions)
  throw new Error(
    "No instructions provided. Please provide instructions to process the video.",
  );

// Pattern for GitHub user attachments
const USER_ATTACHMENTS_RX =
  /^https:\/\/github.com\/user-attachments\/assets\/.+$/gim;
// Pattern for Git LFS files (raw GitHub URLs, releases, etc.)
const GIT_LFS_RX =
  /^https:\/\/github.com\/[^\/]+\/[^\/]+\/(?:raw\/[^\/]+\/|releases\/download\/[^\/]+\/|blob\/[^\/]+\/).+\.(mp4|mov|avi|mkv|webm|flv|m4v)$/gim;

const userAttachmentLinks = Array.from(
  new Set(Array.from(issue.body.matchAll(USER_ATTACHMENTS_RX), (m) => m[0])),
);
const gitLfsLinks = Array.from(
  new Set(Array.from(issue.body.matchAll(GIT_LFS_RX), (m) => m[0])),
);
const assetLinks = [...userAttachmentLinks, ...gitLfsLinks];
if (assetLinks.length === 0)
  cancel("No video assets found in the issue body, nothing to do.");

dbg(`issue: %s`, issue.title);

for (const assetLink of assetLinks) await processAssetLink(assetLink);

async function processAssetLink(assetLink: string) {
  output.heading(3, assetLink);
  dbg(assetLink);

  let downloadUrl: string;
  let isGitLfs = false;

  // Determine if this is a Git LFS URL or user attachment
  if (assetLink.match(GIT_LFS_RX)) {
    isGitLfs = true;
    downloadUrl = assetLink; // Use the URL directly for Git LFS files
    dbg(`Detected Git LFS URL: %s`, assetLink);
  } else {
    downloadUrl = await github.resolveAssetUrl(assetLink);
    dbg(`Resolved user attachment URL: %s`, downloadUrl);
  }

  // Add appropriate headers for Git LFS if needed
  const headers: Record<string, string> = {};
  if (isGitLfs) {
    headers["Accept"] = "application/vnd.git-lfs+json";
    // GitHub token will be handled by the environment if needed
  }

  const res = await fetch(downloadUrl, {
    method: "GET",
    headers,
  });

  const contentType = res.headers.get("content-type") || "";
  const contentLength = res.headers.get("content-length");

  dbg(`download url: %s`, downloadUrl);
  dbg(`headers: %O`, res.headers);
  dbg(`content-type: %s`, contentType);
  dbg(`content-length: %s`, contentLength);

  if (!res.ok) {
    if (res.status === 404 && isGitLfs) {
      throw new Error(
        `Git LFS file not found: ${assetLink}. The file may be too large or not available via LFS.`,
      );
    }
    throw new Error(
      `Failed to download asset from ${downloadUrl}: ${res.status} ${res.statusText}`,
    );
  }

  // Check file size before downloading large files
  if (contentLength) {
    const sizeInMb = parseInt(contentLength) / 1e6;
    dbg(`File size: ${sizeInMb.toFixed(1)}MB`);

    // Warn for very large files (>500MB) but still process them
    if (sizeInMb > 500) {
      output.p(
        `⚠️ Large file detected (${sizeInMb.toFixed(1)}MB). Processing may take longer.`,
      );
    }
  }

  // For Git LFS, we might get a JSON response with download info instead of the actual file
  if (isGitLfs && contentType.includes("application/json")) {
    try {
      const lfsInfo = await res.json();
      if (lfsInfo.download_url) {
        dbg(`Git LFS redirect to: %s`, lfsInfo.download_url);
        return processAssetLink(lfsInfo.download_url); // Recursively process the actual download URL
      }
    } catch (e) {
      // If JSON parsing fails, treat as regular download
      dbg(
        `Failed to parse LFS JSON response, treating as direct download: %s`,
        e.message,
      );
    }
  }

  // Check if content type indicates a video file
  if (!/^video\//.test(contentType)) {
    // For Git LFS URLs, also check file extension since content-type might not be set correctly
    if (isGitLfs && /\.(mp4|mov|avi|mkv|webm|flv|m4v)$/i.test(assetLink)) {
      dbg(
        `Git LFS file extension indicates video, proceeding despite content-type: %s`,
        contentType,
      );
    } else {
      output.p(
        `Asset is not a video file (content-type: ${contentType}), skipping`,
      );
      return;
    }
  }

  // save and cache
  const buffer = await res.arrayBuffer();
  dbg(`size`, `${(buffer.byteLength / 1e6) | 0}Mb`);
  const filename = await workspace.writeCached(buffer, { scope: "run" });
  dbg(`filename`, filename);

  await processVideo(filename);
}

async function processVideo(filename: string) {
  const transcript = await transcribe(filename, {
    model: "whisperasr:default",
    cache: true,
  });
  if (!transcript) {
    output.error(`no transcript found for video ${filename}.`);
  }
  const frames = await ffmpeg.extractFrames(filename, {
    transcript,
  });
  const { text, error } = await runPrompt(
    (ctx) => {
      ctx.def("TRANSCRIPT", transcript?.srt, { ignoreEmpty: true }); // ignore silent videos
      ctx.defImages(frames, { detail: "low", sliceSample: 40 }); // low detail for better performance
      ctx.$`${instructions}
## Output format
- Use GitHub Flavored Markdown (GFM) for markdown syntax formatting.
- If you need to list tasks, use the format \`- [ ] task description\`.
- Do not generate links.
- When possible, include a pointer to the \`[minute:second]\` location in the video using YouTube format.
- The video is included as a set of <FRAMES> images and the <TRANSCRIPT>.`.role(
        "system",
      );
    },
    {
      systemSafety: true,
      model: "vision",
      responseType: "markdown",
      label: `analyze video ${filename}`,
    },
  );

  if (error) {
    output.error(error?.message);
  } else {
    output.appendContent(text);
  }
}
