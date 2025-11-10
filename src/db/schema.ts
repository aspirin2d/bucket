import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";

const MEMORY_CATEGORIES = [
  "USER_INFO",
  "USER_PREFERENCE",
  "USER_GOAL",
  "USER_RELATIONSHIP",
  "EVENT",
  "OTHER",
] as const;

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const apikey = pgTable("apikey", {
  id: text("id").primaryKey(),
  name: text("name"),
  start: text("start"),
  prefix: text("prefix"),
  key: text("key").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  refillInterval: integer("refill_interval"),
  refillAmount: integer("refill_amount"),
  lastRefillAt: timestamp("last_refill_at"),
  enabled: boolean("enabled").default(true),
  rateLimitEnabled: boolean("rate_limit_enabled").default(true),
  rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
  rateLimitMax: integer("rate_limit_max").default(10),
  requestCount: integer("request_count").default(0),
  remaining: integer("remaining"),
  lastRequest: timestamp("last_request"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  permissions: text("permissions"),
  metadata: text("metadata"),
});

export const story = pgTable(
  "story",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider", { enum: ["openai", "ollama"] })
      .notNull()
      .default("openai"),
    handler: text("handler").notNull().default("simple"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // Index for finding stories by user
    index("story_user_id_idx").on(table.userId),
  ],
);

export const message = pgTable(
  "message",
  {
    id: serial("id").primaryKey(),
    storyId: integer("story_id")
      .notNull()
      .references(() => story.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["system", "user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    extracted: boolean("extracted").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // Index for finding messages by story (most common query)
    index("message_story_id_idx").on(table.storyId),
    // Index for filtering by extracted flag
    index("message_extracted_idx").on(table.extracted),
    // Composite index for story + extracted queries (even faster)
    index("message_story_extracted_idx").on(table.storyId, table.extracted),
  ],
);

export const memory = pgTable(
  "memory",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    content: text("content"),
    prevContent: text("previous_content"),

    // Memory metadata fields
    category: text("category", {
      enum: MEMORY_CATEGORIES,
    }),
    importance: real("importance"), // 0-1 scale
    confidence: real("confidence"), // 0-1 scale
    action: text("action", { enum: ["ADD", "UPDATE", "DELETE"] }),

    embedding: vector("embedding", { dimensions: 1536 }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("memory_user_idx").on(table.userId),
    index("memory_embedding_cos_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const clip = pgTable(
  "clip",
  {
    id: serial().primaryKey(),
    originId: text("origin_id").notNull(),

    startFrame: integer("start_frame").notNull(),
    endFrame: integer("end_frame").notNull(),

    videoUrl: text("video_url").notNull(),
    animationUrl: text("animation_url"),

    description: text("description").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(), // Vector type for embedding in Drizzle ORM

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("clip_embedding_cos_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);
