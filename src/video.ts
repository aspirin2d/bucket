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
  const response = await fetch(originUrl);
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download origin video: ${response.status} ${response.statusText}`,
    );
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), config.tmpDirPrefix));
  const fileName = path.basename(new URL(originUrl).pathname) || "origin.mp4";
  const filePath = path.join(tempDir, fileName);
  const webStream = response.body as NodeReadableStream<Uint8Array>;
  await pipeline(Readable.fromWeb(webStream), createWriteStream(filePath));
  return { tempDir, filePath };
};

export const stageUploadedVideo = async (file: File) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), config.tmpDirPrefix));
  const fileName = file.name || "origin.mp4";
  const filePath = path.join(tempDir, fileName);
  const webStream = file.stream() as NodeReadableStream<Uint8Array>;
  await pipeline(Readable.fromWeb(webStream), createWriteStream(filePath));
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

    const ffmpeg = spawn("ffmpeg", args, { stdio: "inherit" });
    ffmpeg.on("error", (error) => reject(error));
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
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
