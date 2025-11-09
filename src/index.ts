import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import z, { ZodError } from "zod";

import { sliceAnimationBin } from "./animation.js";
import { config } from "./config.js";
import { ensureClipTable, persistClips } from "./db.js";
import { embedDescriptions } from "./embeddings.js";
import { logger } from "./logger.js";
import { uploadPayloadSchema, type UploadPayload } from "./schemas.js";
import { deleteObject, uploadObject } from "./upload.js";
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

type PreparedClip = {
  originId: string;
  startFrame: number;
  endFrame: number;
  description: string;
  videoUrl: string;
  videoObjectKey: string;
  animUrl: string | null;
  animObjectKey: string | null;
  embedding: number[];
};

const prepareClipArtifact = async (params: {
  clip: UploadPayload["clips"][number];
  fps: number;
  originId: string;
  sourcePath: string;
  tempDir: string;
  embedding: number[];
  animSource?: { buffer: Uint8Array } | null;
}): Promise<PreparedClip> => {
  const { clip, fps, originId, sourcePath, tempDir, embedding, animSource } =
    params;
  const assetId = randomUUID();
  const trimmedVideoPath = path.join(tempDir, `${assetId}.mp4`);

  await trimClip({
    inputPath: sourcePath,
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

  let animUrl: string | null = null;
  let animObjectKey: string | null = null;
  if (animSource?.buffer) {
    const lastFrame = Math.max(clip.start_frame, clip.end_frame - 1);
    const trimmedAnimBytes = sliceAnimationBin(
      animSource.buffer,
      clip.start_frame,
      lastFrame,
    );
    const animPath = path.join(tempDir, `${assetId}.bin`);
    await writeFile(animPath, trimmedAnimBytes);
    animObjectKey = `animations/${originId}/${assetId}.bin`;
    const { url } = await uploadObject(animObjectKey, animPath);
    animUrl = url;
    await deleteFile(animPath);
  }

  return {
    originId,
    startFrame: clip.start_frame,
    endFrame: clip.end_frame,
    description: clip.description,
    videoUrl,
    videoObjectKey,
    animUrl,
    animObjectKey,
    embedding,
  };
};

const discardUploadedObjects = async (clips: PreparedClip[]) => {
  const objectKeys = clips
    .flatMap((clip) => [clip.videoObjectKey, clip.animObjectKey])
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
  let source: { type: "file"; file: File } | { type: "url"; originUrl: string };
  let animFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    try {
      const multipart = await parseMultipartPayload(c.req.raw);
      payload = multipart.payload;
      source = { type: "file", file: multipart.file };
      animFile = multipart.animation ?? null;
      logger.debug("upload", "Parsed multipart payload", {
        clips: payload.clips.length,
        hasVideoFile: true,
        hasAnimFile: Boolean(animFile),
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
    source = { type: "url", originUrl: originUrl };
    logger.debug("upload", "Parsed JSON payload", {
      clips: payload.clips.length,
      originUrl,
      animUrl: payload.anim_url,
    });
  }

  // Optimize: Generate embeddings in parallel with video preparation
  const embeddingsPromise = embedDescriptions(
    payload.clips.map((clip) => clip.description),
  )
    .then((embeddings) => {
      logger.debug("upload", "Generated embeddings", { count: embeddings.length });
      return embeddings;
    })
    .catch((error) => {
      logger.error("upload", "Failed to embed descriptions", { error });
      throw new Error("Failed to embed descriptions");
    });

  let videoUpload: Awaited<ReturnType<typeof stageUploadedVideo>> | null = null;
  let videoDownload: Awaited<ReturnType<typeof downloadOriginVideo>> | null =
    null;
  try {
    if (source.type === "file") {
      videoUpload = await stageUploadedVideo(source.file);
      logger.debug("upload", "Staged uploaded video", { tempDir: videoUpload.tempDir });
    } else {
      videoDownload = await downloadOriginVideo(source.originUrl);
      logger.debug("upload", "Downloaded video from origin", { originUrl: source.originUrl });
    }
  } catch (error) {
    logger.error("upload", "Failed to acquire origin video", { error });
    return c.json({ error: "Failed to ingest origin video" }, 502);
  }

  const videoSource = videoUpload ?? videoDownload;
  if (!videoSource) {
    return c.json({ error: "Failed to ingest origin video" }, 502);
  }

  const { tempDir: workspaceDir, filePath: videoFilePath } = videoSource;

  let animBuffer: Uint8Array | null = null;
  if (animFile) {
    try {
      const stagedAnimation = await stageUploadedBinary({
        file: animFile,
        tempDir: workspaceDir,
        fallbackName: animFile.name || "origin.bin",
      });
      animBuffer = await readFile(stagedAnimation.filePath);
      logger.debug("upload", "Staged uploaded animation", { tempDir: workspaceDir });
    } catch (error) {
      logger.error("upload", "Failed to acquire origin animation", { error });
      await cleanupTempDir(workspaceDir);
      return c.json({ error: "Failed to ingest origin animation" }, 502);
    }
  } else if (payload.anim_url) {
    try {
      const animPath = await downloadAnimationBinary(
        payload.anim_url,
        workspaceDir,
      );
      animBuffer = await readFile(animPath);
      logger.debug("upload", "Downloaded animation from origin", { animUrl: payload.anim_url });
    } catch (error) {
      logger.error("upload", "Failed to download origin animation", { error });
      await cleanupTempDir(workspaceDir);
      return c.json({ error: "Failed to ingest origin animation" }, 502);
    }
  }

  // Wait for embeddings to complete
  let embeddings: number[][];
  try {
    embeddings = await embeddingsPromise;
  } catch (error) {
    await cleanupTempDir(workspaceDir);
    return c.json({ error: "Failed to embed descriptions" }, 502);
  }

  const animSource = animBuffer ? { buffer: animBuffer } : null;
  let preparedClips: PreparedClip[] = [];
  try {
    // Process clips in parallel for better performance
    logger.debug("upload", "Processing clips in parallel", { count: payload.clips.length });
    preparedClips = await Promise.all(
      payload.clips.map(async (clip, index) => {
        const embedding = embeddings[index];
        if (!embedding) {
          throw new Error(`Missing embedding for clip at index ${index}`);
        }

        const prepared = await prepareClipArtifact({
          clip,
          fps: payload.fps,
          originId: payload.origin_id,
          sourcePath: videoFilePath,
          tempDir: workspaceDir,
          embedding,
          animSource,
        });

        logger.debug("upload", "Prepared clip artifact", {
          index: index + 1,
          total: payload.clips.length,
          videoObjectKey: prepared.videoObjectKey,
          hasAnimation: Boolean(prepared.animUrl),
        });

        return prepared;
      }),
    );

    const persisted = await persistClips(
      preparedClips.map((clip) => ({
        originId: clip.originId,
        startFrame: clip.startFrame,
        endFrame: clip.endFrame,
        description: clip.description,
        videoUrl: clip.videoUrl,
        animUrl: clip.animUrl,
        embedding: clip.embedding,
      })),
    );
    logger.info("upload", "Persisted clips successfully", { count: persisted.length });
    return c.json({ clips: persisted });
  } catch (error) {
    logger.error("upload", "Failed to process upload", { error });
    if (preparedClips.length > 0) {
      await discardUploadedObjects(preparedClips);
    }
    return c.json({ error: "Failed to process upload" }, 500);
  } finally {
    await cleanupTempDir(workspaceDir);
    logger.debug("upload", "Cleaned up workspace", { tempDir: workspaceDir });
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
        logger.info("app", `Server is running on http://localhost:${info.port}`);
      },
    );
  } catch (error) {
    logger.error("app", "Failed to initialize application", { error });
    process.exit(1);
  }
};

void bootstrap();
