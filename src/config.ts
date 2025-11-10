import "dotenv/config";

import z from "zod";

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  tmpDirPrefix: z.string().default("bucket-"),
  db: z.object({
    user: z.string(),
    password: z.string(),
    host: z.string(),
    port: z.coerce.number().int().positive(),
    database: z.string(),
    ssl: z.coerce.boolean().default(false),
  }),
  embedding: z.object({
    baseUrl: z.url(),
    apiKey: z.string(),
    model: z.string(),
    dimensions: z.coerce.number().int().positive().default(1536),
    maxBatch: z.coerce.number().int().positive().default(10),
  }),
  video: z.object({
    defaultFps: z.coerce.number().int().positive().default(30),
    maxDownloadSizeMB: z.coerce.number().int().positive().default(500),
    downloadTimeoutMs: z.coerce.number().int().positive().default(120000),
  }),
  upload: z.object({
    timeoutMs: z.coerce.number().int().positive().default(120000),
  }),
  ffmpeg: z.object({
    gpuAcceleration: z.coerce.boolean().default(false),
    gpuEncoder: z.enum(["h264_nvenc", "hevc_nvenc", "av1_nvenc"]).default("h264_nvenc"),
    gpuPreset: z.enum(["p1", "p2", "p3", "p4", "p5", "p6", "p7"]).default("p4"),
    gpuBitrate: z.string().default("5M"),
    gpuSpatialAQ: z.coerce.boolean().default(true),
    gpuTemporalAQ: z.coerce.boolean().default(true),
    gpuRcLookahead: z.coerce.number().int().min(0).max(32).default(20),
  }),
});

export const config = configSchema.parse({
  port: process.env.PORT,
  tmpDirPrefix: process.env.TMP_DIR_PREFIX,
  db: {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL,
  },
  embedding: {
    baseUrl: process.env.EMBEDDING_BASE_URL,
    apiKey: process.env.DASHSCOPE_API_KEY,
    model: process.env.EMBEDDING_MODEL,
    dimensions: process.env.EMBEDDING_DIMENSIONS,
    maxBatch: process.env.MAX_EMBEDDINGS_PER_BATCH,
  },
  video: {
    defaultFps: process.env.DEFAULT_FPS,
    maxDownloadSizeMB: process.env.MAX_DOWNLOAD_SIZE_MB,
    downloadTimeoutMs: process.env.DOWNLOAD_TIMEOUT_MS,
  },
  upload: {
    timeoutMs: process.env.UPLOAD_TIMEOUT_MS,
  },
  ffmpeg: {
    gpuAcceleration: process.env.FFMPEG_GPU_ACCELERATION,
    gpuEncoder: process.env.FFMPEG_GPU_ENCODER,
    gpuPreset: process.env.FFMPEG_GPU_PRESET,
    gpuBitrate: process.env.FFMPEG_GPU_BITRATE,
    gpuSpatialAQ: process.env.FFMPEG_GPU_SPATIAL_AQ,
    gpuTemporalAQ: process.env.FFMPEG_GPU_TEMPORAL_AQ,
    gpuRcLookahead: process.env.FFMPEG_GPU_RC_LOOKAHEAD,
  },
});

export type AppConfig = typeof config;
