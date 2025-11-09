import z from "zod";

import { config } from "./config.js";

export const clipSchema = z.object({
  id: z.int(),
  origin_id: z.string(),
  start_frame: z.int(),
  end_frame: z.int(),
  description: z.string(),
  embedding: z.array(z.number()).length(config.embedding.dimensions),
  url: z.url(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const clipInputSchema = z
  .object({
    start_frame: z.number().int().nonnegative(),
    end_frame: z.number().int().positive(),
    description: z.string().min(1).max(512),
  })
  .refine((value) => value.end_frame > value.start_frame, {
    message: "end_frame must be greater than start_frame",
    path: ["end_frame"],
  });

export const uploadPayloadSchema = z.object({
  origin_id: z.string().min(1),
  origin_url: z.string().url().optional(),
  fps: z.number().int().positive().max(240).default(config.video.defaultFps),
  clips: z.array(clipInputSchema).min(1).max(config.embedding.maxBatch),
});

export type UploadPayload = z.infer<typeof uploadPayloadSchema>;
export type Clip = z.infer<typeof clipSchema>;
