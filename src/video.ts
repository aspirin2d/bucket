import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { config } from "./config.js";

export const downloadOriginVideo = async (originUrl: string) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    config.video.downloadTimeoutMs,
  );

  try {
    const response = await fetch(originUrl, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to download origin video: ${response.status} ${response.statusText}`,
      );
    }

    // Validate content length if provided
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const sizeMB = parseInt(contentLength, 10) / (1024 * 1024);
      if (sizeMB > config.video.maxDownloadSizeMB) {
        throw new Error(
          `Video file too large: ${sizeMB.toFixed(1)}MB exceeds limit of ${config.video.maxDownloadSizeMB}MB`,
        );
      }
    }

    const tempDir = await mkdtemp(path.join(tmpdir(), config.tmpDirPrefix));
    const fileName = path.basename(new URL(originUrl).pathname) || "origin.mp4";
    const filePath = path.join(tempDir, fileName);
    const webStream = response.body as NodeReadableStream<Uint8Array>;
    await pipeline(Readable.fromWeb(webStream), createWriteStream(filePath));
    return { tempDir, filePath };
  } finally {
    clearTimeout(timeoutId);
  }
};

export const downloadAnimationBinary = async (
  originUrl: string,
  tempDir: string,
) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    config.video.downloadTimeoutMs,
  );

  try {
    const response = await fetch(originUrl, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to download origin animation: ${response.status} ${response.statusText}`,
      );
    }

    // Validate content length if provided
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const sizeMB = parseInt(contentLength, 10) / (1024 * 1024);
      if (sizeMB > config.video.maxDownloadSizeMB) {
        throw new Error(
          `Animation file too large: ${sizeMB.toFixed(1)}MB exceeds limit of ${config.video.maxDownloadSizeMB}MB`,
        );
      }
    }

    const fileName = path.basename(new URL(originUrl).pathname) || "origin.bin";
    const filePath = path.join(tempDir, fileName);
    const webStream = response.body as NodeReadableStream<Uint8Array>;
    await pipeline(Readable.fromWeb(webStream), createWriteStream(filePath));
    return filePath;
  } finally {
    clearTimeout(timeoutId);
  }
};

const writeUploadedAsset = async (params: {
  file: File;
  tempDir: string;
  fallbackName: string;
}) => {
  const { file, tempDir, fallbackName } = params;
  const fileName = file.name?.trim() ? path.basename(file.name) : fallbackName;
  const safeName = fileName || fallbackName;
  const filePath = path.join(tempDir, safeName);
  const webStream = file.stream() as NodeReadableStream<Uint8Array>;
  await pipeline(Readable.fromWeb(webStream), createWriteStream(filePath));
  return filePath;
};

export const stageUploadedVideo = async (
  file: File,
  options?: { tempDir?: string },
) => {
  const tempDir =
    options?.tempDir ??
    (await mkdtemp(path.join(tmpdir(), config.tmpDirPrefix)));
  const filePath = await writeUploadedAsset({
    file,
    tempDir,
    fallbackName: "origin.mp4",
  });
  return { tempDir, filePath };
};

export const stageUploadedBinary = async (params: {
  file: File;
  tempDir: string;
  fallbackName?: string;
}) => {
  const { file, tempDir, fallbackName = "origin.bin" } = params;
  const filePath = await writeUploadedAsset({
    file,
    tempDir,
    fallbackName,
  });
  return { tempDir, filePath };
};

export const trimClip = async (params: {
  inputPath: string;
  outputPath: string;
  startSeconds: number;
  endSeconds: number;
}) => {
  const { inputPath, outputPath, startSeconds, endSeconds } = params;
  return new Promise<void>((resolve, reject) => {
    const args = [
      "-y",
      "-ss",
      startSeconds.toFixed(3),
      "-to",
      endSeconds.toFixed(3),
      "-i",
      inputPath,
      "-c",
      "copy",
      "-avoid_negative_ts",
      "1",
      outputPath,
    ];

    const ffmpeg = spawn("ffmpeg", args);
    const stderrChunks: Buffer[] = [];

    // Capture stderr for better error reporting
    ffmpeg.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    ffmpeg.on("error", (error) => {
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      const errorMessage = `FFmpeg process error: ${error.message}${stderr ? `\nStderr: ${stderr.slice(-500)}` : ""}`;
      reject(new Error(errorMessage));
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");
        const errorMessage = `FFmpeg exited with code ${code}${stderr ? `\nStderr: ${stderr.slice(-500)}` : ""}`;
        reject(new Error(errorMessage));
      }
    });
  });
};

export const cleanupTempDir = async (dirPath: string) => {
  await rm(dirPath, { recursive: true, force: true });
};

export const deleteFile = async (filePath: string) => {
  await rm(filePath, { force: true });
};
