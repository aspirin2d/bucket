const isDevEnv = process.env.NODE_ENV !== "production";

type LogLevel = "debug" | "info" | "warn" | "error";

const log = (
  level: LogLevel,
  context: string,
  message: string,
  meta?: Record<string, unknown>,
) => {
  const timestamp = new Date().toISOString();

  // Extract error stack if present
  let metaToLog = meta;
  if (meta?.error instanceof Error) {
    metaToLog = {
      ...meta,
      error: {
        message: meta.error.message,
        stack: meta.error.stack,
      },
    };
  }

  const metaStr = metaToLog ? ` ${JSON.stringify(metaToLog)}` : "";
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
