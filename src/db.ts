import { Pool } from "pg";

import { config } from "./config.js";
import { clipSchema, type Clip } from "./schemas.js";

const vectorLiteral = (values: number[]) => `[${values.join(",")}]`;

const parseVector = (vectorString: string): number[] => {
  // PostgreSQL returns vectors as strings like "[1,2,3,...]"
  const trimmed = vectorString.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error(`Invalid vector format: ${vectorString}`);
  }
  const content = trimmed.slice(1, -1);
  if (content.length === 0) {
    return [];
  }
  return content.split(",").map((s) => parseFloat(s.trim()));
};

export const pool = new Pool({
  user: config.db.user,
  password: config.db.password,
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  ssl: config.db.ssl,
});

export const ensureClipTable = async () => {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
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

const parseClipRow = (
  row: Record<string, unknown>,
  embedding: number[],
): Clip => {
  return clipSchema.parse({
    id: row.id,
    origin_id: row.origin_id,
    start_frame: row.start_frame,
    end_frame: row.end_frame,
    description: row.description,
    video_url: row.video_url,
    animation_url: row.animation_url ?? null,
    embedding,
    created_at: new Date(row.created_at as string | number | Date),
    updated_at: new Date(row.updated_at as string | number | Date),
  });
};

export const persistClips = async (clips: PersistableClip[]) => {
  if (clips.length === 0) {
    return [];
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inserted: Clip[] = [];
    for (const clip of clips) {
      const vectorValue = vectorLiteral(clip.embedding);
      const res = await client.query(
        `INSERT INTO clip (origin_id, start_frame, end_frame, description, video_url, animation_url, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
         RETURNING id, origin_id, start_frame, end_frame, description, video_url, animation_url, created_at, updated_at`,
        [
          clip.originId,
          clip.startFrame,
          clip.endFrame,
          clip.description,
          clip.videoUrl,
          clip.animationUrl ?? null,
          vectorValue,
        ],
      );

      const [row] = res.rows;
      inserted.push(parseClipRow(row, clip.embedding));
    }

    await client.query("COMMIT");
    return inserted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export type PersistClipsInput = PersistableClip[];

export const getClipsByOriginId = async (
  originId: string,
): Promise<Clip[]> => {
  const res = await pool.query(
    `SELECT id, origin_id, start_frame, end_frame, description, video_url, animation_url, embedding, created_at, updated_at
     FROM clip
     WHERE origin_id = $1`,
    [originId],
  );

  return res.rows.map((row) => {
    const embedding = parseVector(row.embedding as string);
    return parseClipRow(row, embedding);
  });
};

export const deleteClipsByOriginId = async (originId: string) => {
  const res = await pool.query(`DELETE FROM clip WHERE origin_id = $1`, [
    originId,
  ]);
  return res.rowCount ?? 0;
};
