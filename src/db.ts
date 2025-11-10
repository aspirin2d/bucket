import { Pool } from "pg";

import { config } from "./config.js";
import { type Clip } from "./schemas.js";

import "dotenv/config";
import { count, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./db/schema.js";

export const pool = new Pool({
  user: config.db.user,
  password: config.db.password,
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  ssl: config.db.ssl,
});

export const db = drizzle({ client: pool, schema });

// Helper function to convert Drizzle's camelCase result to snake_case Clip type
const mapToClip = (dbClip: typeof schema.clip.$inferSelect): Clip => {
  return {
    id: dbClip.id,
    origin_id: dbClip.originId,
    start_frame: dbClip.startFrame,
    end_frame: dbClip.endFrame,
    description: dbClip.description,
    embedding: dbClip.embedding as number[],
    video_url: dbClip.videoUrl,
    animation_url: dbClip.animationUrl ?? undefined,
    created_at: dbClip.createdAt,
    updated_at: dbClip.updatedAt,
  };
};

export const ensureClipTable = async () => {
  // Ensure vector extension is available
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);

  // Note: Table creation is handled by Drizzle migrations
  // The schema is defined in src/db/schema.ts
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

export const persistClips = async (
  clips: PersistableClip[],
): Promise<Clip[]> => {
  if (clips.length === 0) {
    return [];
  }

  return await db.transaction(async (tx) => {
    const inserted: Clip[] = [];

    for (const clip of clips) {
      const [result] = await tx
        .insert(schema.clip)
        .values({
          originId: clip.originId,
          startFrame: clip.startFrame,
          endFrame: clip.endFrame,
          description: clip.description,
          videoUrl: clip.videoUrl,
          animationUrl: clip.animationUrl ?? null,
          embedding: clip.embedding, // Drizzle handles vector serialization
        })
        .returning();

      inserted.push(mapToClip(result));
    }

    return inserted;
  });
};

export type PersistClipsInput = PersistableClip[];

export const getClipsByOriginId = async (originId: string): Promise<Clip[]> => {
  const clips = await db
    .select()
    .from(schema.clip)
    .where(eq(schema.clip.originId, originId));

  return clips.map(mapToClip);
};

export const deleteClipsByOriginId = async (
  originId: string,
): Promise<number> => {
  const result = await db
    .delete(schema.clip)
    .where(eq(schema.clip.originId, originId));

  return result.rowCount ?? 0;
};

export const getAllClips = async (params: {
  limit: number;
  offset: number;
}): Promise<{ clips: Clip[]; total: number }> => {
  const { limit, offset } = params;

  // Get total count
  const [countResult] = await db.select({ count: count() }).from(schema.clip);

  const total = Number(countResult.count);

  // Get paginated clips
  const dbClips = await db
    .select()
    .from(schema.clip)
    .orderBy(desc(schema.clip.createdAt))
    .limit(limit)
    .offset(offset);

  return { clips: dbClips.map(mapToClip), total };
};

export type SimilarClip = Clip & { similarity_score: number };

export const searchClipsBySimilarity = async (params: {
  queryEmbedding: number[];
  limit: number;
  threshold?: number;
}): Promise<SimilarClip[]> => {
  const { queryEmbedding, limit, threshold } = params;

  // pgvector cosine distance operator: <=>
  // Returns 0 for identical vectors, 2 for opposite vectors
  // We convert to similarity score: 1 - (distance / 2)
  const distanceExpr = sql`${schema.clip.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`;

  const query = db
    .select({
      id: schema.clip.id,
      originId: schema.clip.originId,
      startFrame: schema.clip.startFrame,
      endFrame: schema.clip.endFrame,
      description: schema.clip.description,
      embedding: schema.clip.embedding,
      videoUrl: schema.clip.videoUrl,
      animationUrl: schema.clip.animationUrl,
      createdAt: schema.clip.createdAt,
      updatedAt: schema.clip.updatedAt,
      distance: distanceExpr.as("distance"),
    })
    .from(schema.clip)
    .orderBy(distanceExpr)
    .limit(limit);

  const results = await query;

  const similarClips: SimilarClip[] = [];

  for (const row of results) {
    const distance = Number(row.distance);
    const similarityScore = 1 - distance / 2; // Convert distance to similarity (0-1 range)

    // Filter by threshold if provided
    if (threshold !== undefined && similarityScore < threshold) {
      continue;
    }

    similarClips.push({
      id: row.id,
      origin_id: row.originId,
      start_frame: row.startFrame,
      end_frame: row.endFrame,
      description: row.description,
      embedding: row.embedding as number[],
      video_url: row.videoUrl,
      animation_url: row.animationUrl ?? undefined,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      similarity_score: similarityScore,
    });
  }

  return similarClips;
};
