import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, desc, sql } from "drizzle-orm";

import { config } from "./config.js";
import { clip, type Clip, type NewClip } from "./db/schema.js";

// Create PostgreSQL connection pool
export const pool = new Pool({
  user: config.db.user,
  password: config.db.password,
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  ssl: config.db.ssl,
});

// Initialize Drizzle ORM with the pool
export const db = drizzle(pool);

// Ensure pgvector extension and clip table are created
export const ensureClipTable = async () => {
  // Enable pgvector extension
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);

  // Create table with Drizzle schema
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clip (
      id SERIAL PRIMARY KEY,
      origin_id TEXT NOT NULL,

      start_frame INTEGER NOT NULL,
      end_frame INTEGER NOT NULL,

      video_url TEXT NOT NULL,
      animation_url TEXT,

      description TEXT NOT NULL,
      embedding vector(${config.embedding.dimensions}) NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

type PersistableClip = {
  originId: string;
  startFrame: number;
  endFrame: number;
  description: string;
  videoUrl: string;
  animationUrl?: string | null;
  embedding: number[];
};

// Helper to convert number array to PostgreSQL vector literal
const vectorLiteral = (values: number[]) => `[${values.join(",")}]`;

// Persist clips to database using Drizzle
export const persistClips = async (clips: PersistableClip[]): Promise<Clip[]> => {
  if (clips.length === 0) {
    return [];
  }

  // Use transaction for atomicity
  return await db.transaction(async (tx) => {
    const inserted: Clip[] = [];

    for (const clipData of clips) {
      // Insert clip and return the inserted row
      const [insertedClip] = await tx
        .insert(clip)
        .values({
          originId: clipData.originId,
          startFrame: clipData.startFrame,
          endFrame: clipData.endFrame,
          description: clipData.description,
          videoUrl: clipData.videoUrl,
          animationUrl: clipData.animationUrl ?? null,
          // Use SQL fragment to cast the vector literal
          embedding: sql`${vectorLiteral(clipData.embedding)}::vector`,
        })
        .returning();

      // Add the embedding array back to the returned clip
      inserted.push({
        ...insertedClip,
        embedding: clipData.embedding,
      });
    }

    return inserted;
  });
};

export type PersistClipsInput = PersistableClip[];

// Get clips by origin ID
export const getClipsByOriginId = async (originId: string): Promise<Clip[]> => {
  const clips = await db
    .select()
    .from(clip)
    .where(eq(clip.originId, originId));

  // Parse embedding vectors from PostgreSQL format
  return clips.map((c) => ({
    ...c,
    embedding: parseVector(c.embedding as unknown as string),
  }));
};

// Delete clips by origin ID
export const deleteClipsByOriginId = async (originId: string): Promise<number> => {
  const result = await db
    .delete(clip)
    .where(eq(clip.originId, originId));

  return result.rowCount ?? 0;
};

// Get all clips with pagination
export const getAllClips = async (params: {
  limit: number;
  offset: number;
}): Promise<{ clips: Clip[]; total: number }> => {
  const { limit, offset } = params;

  // Get total count
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clip);
  const total = countResult.count;

  // Get paginated clips
  const clips = await db
    .select()
    .from(clip)
    .orderBy(desc(clip.createdAt))
    .limit(limit)
    .offset(offset);

  // Parse embedding vectors from PostgreSQL format
  return {
    clips: clips.map((c) => ({
      ...c,
      embedding: parseVector(c.embedding as unknown as string),
    })),
    total,
  };
};

// Helper to parse PostgreSQL vector format to number array
const parseVector = (vectorString: string): number[] => {
  // Handle null, undefined, or non-string values
  if (!vectorString || typeof vectorString !== "string") {
    return [];
  }

  // PostgreSQL vector type returns as "[1,2,3]" string format
  // Remove brackets and split by comma, then parse each value as float
  const cleaned = vectorString.trim().replace(/^\[|\]$/g, "");
  if (!cleaned) {
    return [];
  }
  return cleaned.split(",").map((v) => parseFloat(v.trim()));
};
