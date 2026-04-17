import "dotenv/config";
import { loadConfig } from "./config.js";
import { BunqApiClient } from "./bunq/client.js";
import { SqliteStore } from "./db/database.js";
import { BunqMcpServer } from "./mcp/server.js";
import { createLogger } from "./utils/logger.js";
import { BunqWebhookServer } from "./webhook/server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const store = new SqliteStore(config.SQLITE_PATH, logger);
  const bunqClient = new BunqApiClient(config, logger, store);
  const webhookServer = new BunqWebhookServer(config, logger, store, bunqClient);
  const mcpServer = new BunqMcpServer(config, logger, bunqClient, store, webhookServer);

  await webhookServer.start();
  await mcpServer.start();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down bunq MCP server");
    await webhookServer.stop();
    store.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
