import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import z, { ZodError } from "zod";

import { sliceAnimationBin } from "./animation.js";
import { config } from "./config.js";
import {
  deleteClipsByOriginId,
  ensureClipTable,
  getClipsByOriginId,
  persistClips,
} from "./db.js";
import { embedDescriptions } from "./embeddings.js";
import { logger } from "./logger.js";
import { uploadPayloadSchema, type UploadPayload } from "./schemas.js";
import {
  deleteObject,
  deleteObjectsByOriginId,
  uploadObject,
} from "./upload.js";
import {
  cleanupTempDir,
  deleteFile,
  downloadAnimationBinary,
  downloadOriginVideo,
  stageUploadedBinary,
  stageUploadedVideo,
  trimClip,
} from "./video.js";

const app = new Hono();
const publicIndexPath = path.join(process.cwd(), "public", "index.html");

type VideoSourceInput =
  | { type: "file"; file: File }
  | { type: "url"; originUrl: string };

type WorkspaceResult = {
  workDir: string;
  filePath: string;
};

const parsePayload = async (req: Request): Promise<UploadPayload> => {
  const body = await req.json();
  return uploadPayloadSchema.parse(body);
};

const isFile = (value: FormDataEntryValue | null): value is File => {
  return typeof value === "object" && value !== null && "stream" in value;
};

type MultipartPayload = {
  payload: UploadPayload;
  file: File;
  animation?: File | null;
};

const parseMultipartPayload = async (
  req: Request,
): Promise<MultipartPayload> => {
  const formData = await req.formData();
  const payloadField = formData.get("payload") ?? formData.get("metadata");
  if (typeof payloadField !== "string") {
    throw new Error("Expected JSON payload under form field `payload`");
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(payloadField);
  } catch (error) {
    throw new Error("Invalid JSON payload");
  }

  const payload = uploadPayloadSchema.parse(parsedBody);
  const fileField = formData.get("video") ?? formData.get("file");
  if (!isFile(fileField)) {
    throw new Error("Missing uploaded video file (form field `video`)");
  }

  const animationField = formData.get("animation");
  const animation = isFile(animationField) ? animationField : null;

  return { payload, file: fileField, animation };
};

type ProcessedClip = {
  originId: string;
  startFrame: number;
  endFrame: number;
  description: string;
  videoUrl: string;
  videoObjectKey: string;
  animationUrl: string | null;
  animationObjectKey: string | null;
  embedding: number[];
};

const processClip = async (params: {
  clip: UploadPayload["clips"][number];
  fps: number;
  originId: string;
  videoSourcePath: string;
  workDir: string;
  embedding: number[];
  animationBuffer?: Uint8Array | null;
}): Promise<ProcessedClip> => {
  const {
    clip,
    fps,
    originId,
    videoSourcePath,
    workDir,
    embedding,
    animationBuffer,
  } = params;
  const assetId = randomUUID();
  const trimmedVideoPath = path.join(workDir, `${assetId}.mp4`);

  await trimClip({
    inputPath: videoSourcePath,
    outputPath: trimmedVideoPath,
    startSeconds: clip.start_frame / fps,
    endSeconds: clip.end_frame / fps,
  });

  const videoObjectKey = `clips/${originId}/${assetId}.mp4`;
  const { url: videoUrl } = await uploadObject(
    videoObjectKey,
    trimmedVideoPath,
  );
  await deleteFile(trimmedVideoPath);

  let animationUrl: string | null = null;
  let animationObjectKey: string | null = null;
  if (animationBuffer) {
    const lastFrame = Math.max(clip.start_frame, clip.end_frame - 1);
    const trimmedAnimationBytes = sliceAnimationBin(
      animationBuffer,
      clip.start_frame,
      lastFrame,
    );
    const animationPath = path.join(workDir, `${assetId}.bin`);
    await writeFile(animationPath, trimmedAnimationBytes);
    animationObjectKey = `animations/${originId}/${assetId}.bin`;
    const { url } = await uploadObject(animationObjectKey, animationPath);
    animationUrl = url;
    await deleteFile(animationPath);
  }

  return {
    originId,
    startFrame: clip.start_frame,
    endFrame: clip.end_frame,
    description: clip.description,
    videoUrl,
    videoObjectKey,
    animationUrl,
    animationObjectKey,
    embedding,
  };
};

const discardUploadedObjects = async (clips: ProcessedClip[]) => {
  const objectKeys = clips
    .flatMap((clip) => [clip.videoObjectKey, clip.animationObjectKey])
    .filter((key): key is string => Boolean(key));

  await Promise.all(
    objectKeys.map((objectKey) =>
      deleteObject(objectKey).catch((error) => {
        logger.warn(
          "upload",
          "Failed to delete uploaded object during rollback",
          { objectKey, error },
        );
      }),
    ),
  );
};

app.get("/", async (c) => {
  try {
    const html = await readFile(publicIndexPath, "utf-8");
    return c.html(html);
  } catch (error) {
    logger.error("harness", "Failed to read public/index.html", { error });
    return c.text("Upload harness unavailable", 500);
  }
});

app.post("/api/clips", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  logger.debug("upload", "Incoming /api/clips request", { contentType });
  let payload: UploadPayload;
  let videoSourceInput: VideoSourceInput;
  let animationFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    try {
      const multipart = await parseMultipartPayload(c.req.raw);
      payload = multipart.payload;
      videoSourceInput = { type: "file", file: multipart.file };
      animationFile = multipart.animation ?? null;
      logger.debug("upload", "Parsed multipart payload", {
        clips: payload.clips.length,
        hasVideoFile: true,
        hasAnimationFile: Boolean(animationFile),
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return c.json({ error: z.formatError(error) }, 400);
      }
      logger.error("upload", "Failed to parse multipart payload", { error });
      return c.json({ error: (error as Error).message }, 400);
    }
  } else {
    try {
      payload = await parsePayload(c.req.raw);
    } catch (error) {
      if (error instanceof ZodError) {
        return c.json({ error: z.formatError(error) }, 400);
      }
      return c.json({ error: "Invalid request" }, 400);
    }

    const originUrl = payload.origin_url ?? payload.video_url;
    if (!originUrl) {
      return c.json(
        { error: "origin_url is required when no video file is uploaded" },
        400,
      );
    }
    videoSourceInput = { type: "url", originUrl };
    logger.debug("upload", "Parsed JSON payload", {
      clips: payload.clips.length,
      originUrl,
      animationUrl: payload.anim_url,
    });
  }

  // Optimize: Generate embeddings in parallel with video preparation
  const embeddingsPromise = embedDescriptions(
    payload.clips.map((clip) => clip.description),
  )
    .then((embeddings) => {
      logger.debug("upload", "Generated embeddings", {
        count: embeddings.length,
      });
      return embeddings;
    })
    .catch((error) => {
      logger.error("upload", "Failed to embed descriptions", { error });
      throw new Error("Failed to embed descriptions");
    });

  // Acquire video source (uploaded file or remote URL)
  let workspace: WorkspaceResult;
  try {
    if (videoSourceInput.type === "file") {
      const result = await stageUploadedVideo(videoSourceInput.file);
      workspace = { workDir: result.tempDir, filePath: result.filePath };
      logger.debug("upload", "Staged uploaded video", {
        workDir: workspace.workDir,
      });
    } else {
      const result = await downloadOriginVideo(videoSourceInput.originUrl);
      workspace = { workDir: result.tempDir, filePath: result.filePath };
      logger.debug("upload", "Downloaded video from origin", {
        originUrl: videoSourceInput.originUrl,
      });
    }
  } catch (error) {
    logger.error("upload", "Failed to acquire video source", { error });
    return c.json({ error: "Failed to ingest origin video" }, 502);
  }

  const { workDir, filePath: videoSourcePath } = workspace;

  // Acquire animation source if provided
  let animationBuffer: Uint8Array | null = null;
  if (animationFile) {
    try {
      const stagedAnimation = await stageUploadedBinary({
        file: animationFile,
        tempDir: workDir,
        fallbackName: animationFile.name || "origin.bin",
      });
      animationBuffer = await readFile(stagedAnimation.filePath);
      logger.debug("upload", "Staged uploaded animation", { workDir });
    } catch (error) {
      logger.error("upload", "Failed to stage animation file", { error });
      await cleanupTempDir(workDir);
      return c.json({ error: "Failed to ingest origin animation" }, 502);
    }
  } else if (payload.anim_url) {
    try {
      const animationPath = await downloadAnimationBinary(
        payload.anim_url,
        workDir,
      );
      animationBuffer = await readFile(animationPath);
      logger.debug("upload", "Downloaded animation from origin", {
        animationUrl: payload.anim_url,
      });
    } catch (error) {
      logger.error("upload", "Failed to download animation file", { error });
      await cleanupTempDir(workDir);
      return c.json({ error: "Failed to ingest origin animation" }, 502);
    }
  }

  // Wait for embeddings to complete
  let embeddings: number[][];
  try {
    embeddings = await embeddingsPromise;
  } catch (error) {
    await cleanupTempDir(workDir);
    return c.json({ error: "Failed to embed descriptions" }, 502);
  }

  // Check if origin_id already exists and clean up old records
  try {
    const existingClips = await getClipsByOriginId(payload.origin_id);
    if (existingClips.length > 0) {
      logger.info("upload", "Found existing clips for origin_id, cleaning up", {
        origin_id: payload.origin_id,
        existingClipCount: existingClips.length,
      });

      // Delete old files from OSS
      const deletedKeys = await deleteObjectsByOriginId(payload.origin_id);
      logger.debug("upload", "Deleted old OSS objects", {
        origin_id: payload.origin_id,
        deletedCount: deletedKeys.length,
      });

      // Delete old database records
      const deletedCount = await deleteClipsByOriginId(payload.origin_id);
      logger.info("upload", "Deleted old database records", {
        origin_id: payload.origin_id,
        deletedCount,
      });
    }
  } catch (error) {
    logger.error("upload", "Failed to cleanup old records", {
      origin_id: payload.origin_id,
      error,
    });
    await cleanupTempDir(workDir);
    return c.json({ error: "Failed to cleanup old records" }, 500);
  }

  // Process all clips in parallel for better performance
  let processedClips: ProcessedClip[] = [];
  try {
    logger.debug("upload", "Processing clips in parallel", {
      count: payload.clips.length,
    });
    processedClips = await Promise.all(
      payload.clips.map(async (clip, index) => {
        const embedding = embeddings[index];
        if (!embedding) {
          throw new Error(`Missing embedding for clip at index ${index}`);
        }

        const processed = await processClip({
          clip,
          fps: payload.fps,
          originId: payload.origin_id,
          videoSourcePath,
          workDir,
          embedding,
          animationBuffer,
        });

        logger.debug("upload", "Processed clip", {
          index: index + 1,
          total: payload.clips.length,
          videoObjectKey: processed.videoObjectKey,
          hasAnimation: Boolean(processed.animationUrl),
        });

        return processed;
      }),
    );

    const persisted = await persistClips(
      processedClips.map((clip) => ({
        originId: clip.originId,
        startFrame: clip.startFrame,
        endFrame: clip.endFrame,
        description: clip.description,
        videoUrl: clip.videoUrl,
        animationUrl: clip.animationUrl,
        embedding: clip.embedding,
      })),
    );
    logger.info("upload", "Persisted clips successfully", {
      count: persisted.length,
    });
    return c.json({ clips: persisted });
  } catch (error) {
    console.error(error);
    logger.error("upload", "Failed to process clips", { error });
    if (processedClips.length > 0) {
      await discardUploadedObjects(processedClips);
    }
    return c.json({ error: "Failed to process upload" }, 500);
  } finally {
    await cleanupTempDir(workDir);
    logger.debug("upload", "Cleaned up workspace", { workDir });
  }
});

const bootstrap = async () => {
  try {
    await ensureClipTable();
    logger.info("app", "Database tables initialized");
    serve(
      {
        fetch: app.fetch,
        port: config.port,
      },
      (info) => {
        logger.info(
          "app",
          `Server is running on http://localhost:${info.port}`,
        );
      },
    );
  } catch (error) {
    logger.error("app", "Failed to initialize application", { error });
    process.exit(1);
  }
};

void bootstrap();
