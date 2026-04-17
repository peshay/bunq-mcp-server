import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  BUNQ_API_BASE_URL: z.string().url().default("https://api.bunq.com/v1"),
  BUNQ_API_KEY: z.string().min(1),
  BUNQ_DEVICE_DESCRIPTION: z.string().default("bunq-mcp-server"),
  BUNQ_PERMITTED_IPS: z.string().optional(),
  BUNQ_LANGUAGE: z.string().default("en_US"),
  BUNQ_REGION: z.string().default("en_US"),
  BUNQ_GEOLOCATION: z.string().default("0 0 0 0 NL"),
  BUNQ_USER_AGENT: z.string().default("bunq-mcp-server/0.1.0"),
  BUNQ_CONTEXT_PATH: z.string().default("./data/bunq-context.json"),
  SQLITE_PATH: z.string().default("./data/bunq-mcp.sqlite"),
  WEBHOOK_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  WEBHOOK_HOST: z.string().default("0.0.0.0"),
  WEBHOOK_PORT: z.coerce.number().int().positive().default(8787),
  WEBHOOK_PATH: z.string().default("/webhook/bunq"),
  WEBHOOK_SHARED_SECRET: z.string().optional(),
  ENABLE_PAYMENTS: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  ENABLE_DRAFT_PAYMENTS: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  MCP_SERVER_NAME: z.string().default("bunq-business-mcp"),
  MCP_SERVER_VERSION: z.string().default("0.1.0"),
  DEFAULT_TRANSACTION_PAGE_SIZE: z.coerce.number().int().positive().max(200).default(100),
  DEFAULT_RECONCILIATION_DATE_WINDOW_DAYS: z.coerce.number().int().positive().default(14),
  DEFAULT_RECONCILIATION_AMOUNT_TOLERANCE: z.coerce.number().nonnegative().default(0.01),
  DEFAULT_CURRENCY: z.string().default("EUR")
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(env);
}
