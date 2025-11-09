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
});

export type AppConfig = typeof config;
