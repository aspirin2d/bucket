import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import z, { ZodError } from "zod";

import { config } from "./config.js";
import { ensureClipTable, persistClips } from "./db.js";
import { embedDescriptions } from "./embeddings.js";
import { uploadPayloadSchema, type UploadPayload } from "./schemas.js";
import { deleteObject, uploadObject } from "./upload.js";
import {
  cleanupTempDir,
  deleteFile,
  downloadOriginVideo,
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

const parseMultipartPayload = async (req: Request) => {
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

  return { payload, file: fileField };
};

type PreparedClip = {
  originId: string;
  startFrame: number;
  endFrame: number;
  description: string;
  url: string;
  embedding: number[];
  objectKey: string;
};

const prepareClipArtifact = async (params: {
  clip: UploadPayload["clips"][number];
  fps: number;
  originId: string;
  sourcePath: string;
  tempDir: string;
  embedding: number[];
}): Promise<PreparedClip> => {
  const { clip, fps, originId, sourcePath, tempDir, embedding } = params;
  const trimmedPath = path.join(tempDir, `${randomUUID()}.mp4`);

  await trimClip({
    inputPath: sourcePath,
    outputPath: trimmedPath,
    startSeconds: clip.start_frame / fps,
    endSeconds: clip.end_frame / fps,
  });

  const objectKey = `clips/${originId}/${randomUUID()}.mp4`;
  const { url } = await uploadObject(objectKey, trimmedPath);
  await deleteFile(trimmedPath);

  return {
    originId,
    startFrame: clip.start_frame,
    endFrame: clip.end_frame,
    description: clip.description,
    url,
    embedding,
    objectKey,
  };
};

const discardUploadedObjects = async (clips: PreparedClip[]) => {
  await Promise.all(
    clips.map((clip) =>
      deleteObject(clip.objectKey).catch((error) => {
        console.warn(
          `Failed to delete uploaded object ${clip.objectKey} during rollback`,
          error,
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
    console.error("Failed to read public/index.html", error);
    return c.text("Upload harness unavailable", 500);
  }
});

app.post("/api/clips", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  let payload: UploadPayload;
  let source:
    | { type: "file"; file: File }
    | { type: "url"; originUrl: string };

  if (contentType.includes("multipart/form-data")) {
    try {
      const multipart = await parseMultipartPayload(c.req.raw);
      payload = multipart.payload;
      source = { type: "file", file: multipart.file };
    } catch (error) {
      if (error instanceof ZodError) {
        return c.json({ error: z.formatError(error) }, 400);
      }
      console.error("Failed to parse multipart payload", error);
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

    if (!payload.origin_url) {
      return c.json(
        { error: "origin_url is required when no video file is uploaded" },
        400,
      );
    }
    source = { type: "url", originUrl: payload.origin_url };
  }

  let stagedVideo: Awaited<ReturnType<typeof stageUploadedVideo>> | null = null;
  let downloadedVideo: Awaited<ReturnType<typeof downloadOriginVideo>> | null =
    null;
  try {
    if (source.type === "file") {
      stagedVideo = await stageUploadedVideo(source.file);
    } else {
      downloadedVideo = await downloadOriginVideo(source.originUrl);
    }
  } catch (error) {
    console.error("Failed to acquire origin video", error);
    return c.json({ error: "Failed to ingest origin video" }, 502);
  }

  const sourceVideo = stagedVideo ?? downloadedVideo;
  if (!sourceVideo) {
    return c.json({ error: "Failed to ingest origin video" }, 502);
  }

  const { tempDir, filePath } = sourceVideo;

  let embeddings: number[][];
  try {
    embeddings = await embedDescriptions(
      payload.clips.map((clip) => clip.description),
    );
  } catch (error) {
    console.error("Failed to embed descriptions", error);
    await cleanupTempDir(tempDir);
    return c.json({ error: "Failed to embed descriptions" }, 502);
  }

  const preparedClips: PreparedClip[] = [];
  try {
    for (const [index, clip] of payload.clips.entries()) {
      const embedding = embeddings[index];
      if (!embedding) {
        throw new Error("Missing embedding for clip");
      }

      const prepared = await prepareClipArtifact({
        clip,
        fps: payload.fps,
        originId: payload.origin_id,
        sourcePath: filePath,
        tempDir,
        embedding,
      });

      preparedClips.push(prepared);
    }

    const persisted = await persistClips(preparedClips);
    return c.json({ clips: persisted });
  } catch (error) {
    console.error("Failed to process upload", error);
    if (preparedClips.length > 0) {
      await discardUploadedObjects(preparedClips);
    }
    return c.json({ error: "Failed to process upload" }, 500);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

const bootstrap = async () => {
  try {
    await ensureClipTable();
    serve(
      {
        fetch: app.fetch,
        port: config.port,
      },
      (info) => {
        console.log(`Server is running on http://localhost:${info.port}`);
      },
    );
  } catch (error) {
    console.error("Failed to initialize application", error);
    process.exit(1);
  }
};

void bootstrap();
