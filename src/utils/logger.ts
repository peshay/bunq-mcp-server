import pino from "pino";
import type { AppConfig } from "../config.js";

export function createLogger(config: AppConfig) {
  return pino({
    name: "bunq-mcp-server",
    level: config.LOG_LEVEL,
    base: { pid: process.pid, service: "bunq-mcp-server" },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.x-bunq-client-authentication",
        "bunqApiKey",
        "apiKey",
        "headers.x-bunq-client-authentication"
      ],
      censor: "[REDACTED]"
    }
  });
}

export type AppLogger = ReturnType<typeof createLogger>;
