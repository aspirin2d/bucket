import { Pool } from "pg";

import { config } from "./config.js";
import { clipSchema, type Clip } from "./schemas.js";

const vectorLiteral = (values: number[]) => `[${values.join(",")}]`;

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
  await pool.query(`DROP TABLE clip`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clip (
      id SERIAL PRIMARY KEY,
      origin_id TEXT NOT NULL,
      start_frame INTEGER NOT NULL,
      end_frame INTEGER NOT NULL,
      url TEXT NOT NULL,
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
  url: string;
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
    url: row.url,
    embedding,
    created_at: new Date(row.created_at as string | number | Date),
    updated_at: new Date(row.updated_at as string | number | Date),
  });
};

export const persistClips = async (clips: PersistableClip[]) => {
  if (clips.length === 0) {
    return [];
  }

  try {
    await pool.query("BEGIN");

    const inserted: Clip[] = [];
    for (const clip of clips) {
      const vectorValue = vectorLiteral(clip.embedding);
      const res = await pool.query(
        `INSERT INTO clip (origin_id, start_frame, end_frame, description, url, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)
         RETURNING id, origin_id, start_frame, end_frame, description, url, created_at, updated_at`,
        [
          clip.originId,
          clip.startFrame,
          clip.endFrame,
          clip.description,
          clip.url,
          vectorValue,
        ],
      );

      const [row] = res.rows;
      inserted.push(parseClipRow(row, clip.embedding));
    }

    await pool.query("COMMIT");
    return inserted;
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  } finally {
  }
};

export type PersistClipsInput = PersistableClip[];
