import { pgTable, serial, text, integer, timestamp, vector } from "drizzle-orm/pg-core";
import { config } from "../config.js";

export const clip = pgTable("clip", {
  id: serial("id").primaryKey(),
  originId: text("origin_id").notNull(),
  startFrame: integer("start_frame").notNull(),
  endFrame: integer("end_frame").notNull(),
  videoUrl: text("video_url").notNull(),
  animationUrl: text("animation_url"),
  description: text("description").notNull(),
  embedding: vector("embedding", { dimensions: config.embedding.dimensions }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Clip = typeof clip.$inferSelect;
export type NewClip = typeof clip.$inferInsert;
