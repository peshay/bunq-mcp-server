import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadInvoices } from "../../src/invoices/loaders.js";
import { createLogger } from "../../src/utils/logger.js";

describe("invoice loader", () => {
  const logger = createLogger({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    BUNQ_API_BASE_URL: "https://api.bunq.com/v1",
    BUNQ_API_KEY: "test",
    BUNQ_DEVICE_DESCRIPTION: "test",
    BUNQ_PERMITTED_IPS: undefined,
    BUNQ_LANGUAGE: "en_US",
    BUNQ_REGION: "en_US",
    BUNQ_GEOLOCATION: "0 0 0 0 NL",
    BUNQ_USER_AGENT: "test",
    BUNQ_CONTEXT_PATH: "./tmp/context.json",
    SQLITE_PATH: "./tmp/db.sqlite",
    WEBHOOK_ENABLED: false,
    WEBHOOK_HOST: "127.0.0.1",
    WEBHOOK_PORT: 8787,
    WEBHOOK_PATH: "/webhook/bunq",
    WEBHOOK_SHARED_SECRET: undefined,
    ENABLE_PAYMENTS: false,
    ENABLE_DRAFT_PAYMENTS: false,
    MCP_SERVER_NAME: "test",
    MCP_SERVER_VERSION: "0.1.0",
    DEFAULT_TRANSACTION_PAGE_SIZE: 100,
    DEFAULT_RECONCILIATION_DATE_WINDOW_DAYS: 14,
    DEFAULT_RECONCILIATION_AMOUNT_TOLERANCE: 0.01,
    DEFAULT_CURRENCY: "EUR"
  });

  it("loads invoices from JSON, CSV, and SQLite", () => {
    const jsonInvoices = loadInvoices(
      { type: "json", path: path.resolve("tests/fixtures/invoices.sample.json") },
      logger
    );
    const csvInvoices = loadInvoices(
      { type: "csv", path: path.resolve("tests/fixtures/invoices.sample.csv") },
      logger
    );
    const sqliteInvoices = loadInvoices(
      {
        type: "sqlite",
        path: path.resolve("tests/fixtures/invoices.sample.sqlite"),
        query: "SELECT * FROM invoices"
      },
      logger
    );

    expect(jsonInvoices).toHaveLength(2);
    expect(csvInvoices).toHaveLength(2);
    expect(sqliteInvoices).toHaveLength(2);
    expect(sqliteInvoices[0]?.invoiceNumber).toBe("2026-001");
  });
});
