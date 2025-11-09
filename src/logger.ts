const isDevEnv = process.env.NODE_ENV !== "production";

type LogLevel = "debug" | "info" | "warn" | "error";

const serializeError = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
      ...(error.cause ? { cause: serializeError(error.cause) } : {}),
    };
  }
  return { value: String(error) };
};

const serializeMeta = (meta?: Record<string, unknown>): string => {
  if (!meta) return "";

  const serialized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (key === "error" && (value instanceof Error || typeof value === "object")) {
      serialized[key] = serializeError(value);
    } else {
      serialized[key] = value;
    }
  }

  return ` ${JSON.stringify(serialized)}`;
};

const log = (level: LogLevel, context: string, message: string, meta?: Record<string, unknown>) => {
  const timestamp = new Date().toISOString();
  const metaStr = serializeMeta(meta);
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}${metaStr}`;

  switch (level) {
    case "error":
      console.error(logMessage);
      break;
    case "warn":
      console.warn(logMessage);
      break;
    case "debug":
      if (isDevEnv) {
        console.log(logMessage);
      }
      break;
    default:
      console.log(logMessage);
  }
};

export const logger = {
  debug: (context: string, message: string, meta?: Record<string, unknown>) =>
    log("debug", context, message, meta),
  info: (context: string, message: string, meta?: Record<string, unknown>) =>
    log("info", context, message, meta),
  warn: (context: string, message: string, meta?: Record<string, unknown>) =>
    log("warn", context, message, meta),
  error: (context: string, message: string, meta?: Record<string, unknown>) =>
    log("error", context, message, meta),
};
