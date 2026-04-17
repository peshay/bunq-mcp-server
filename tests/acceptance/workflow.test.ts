import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../../src/config.js";
import { SqliteStore } from "../../src/db/database.js";
import { ReconciliationService } from "../../src/services/reconciliation-service.js";
import { ReportingService } from "../../src/services/reporting-service.js";
import { TransactionService } from "../../src/services/transaction-service.js";
import { createLogger } from "../../src/utils/logger.js";
import { BunqWebhookServer } from "../../src/webhook/server.js";
import { BunqMcpServer } from "../../src/mcp/server.js";
import type { BunqApiClient } from "../../src/bunq/client.js";

const tempDirs: string[] = [];

function makeTempPath(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bunq-mcp-test-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    BUNQ_API_BASE_URL: "https://api.bunq.com/v1",
    BUNQ_API_KEY: "test-key",
    BUNQ_DEVICE_DESCRIPTION: "test-device",
    BUNQ_PERMITTED_IPS: undefined,
    BUNQ_LANGUAGE: "en_US",
    BUNQ_REGION: "en_US",
    BUNQ_GEOLOCATION: "0 0 0 0 NL",
    BUNQ_USER_AGENT: "bunq-mcp-test/0.1.0",
    BUNQ_CONTEXT_PATH: makeTempPath("context.json"),
    SQLITE_PATH: makeTempPath("test.sqlite"),
    WEBHOOK_ENABLED: false,
    WEBHOOK_HOST: "127.0.0.1",
    WEBHOOK_PORT: 8787,
    WEBHOOK_PATH: "/webhook/bunq",
    WEBHOOK_SHARED_SECRET: undefined,
    ENABLE_PAYMENTS: false,
    ENABLE_DRAFT_PAYMENTS: false,
    MCP_SERVER_NAME: "bunq-test-mcp",
    MCP_SERVER_VERSION: "0.1.0",
    DEFAULT_TRANSACTION_PAGE_SIZE: 100,
    DEFAULT_RECONCILIATION_DATE_WINDOW_DAYS: 14,
    DEFAULT_RECONCILIATION_AMOUNT_TOLERANCE: 0.01,
    DEFAULT_CURRENCY: "EUR",
    ...overrides
  };
}

class FakeBunq {
  async listAccounts() {
    return [
      {
        id: 1111,
        type: "MonetaryAccountBank",
        description: "Main business",
        status: "ACTIVE",
        iban: "NL11BUNQ0001111111",
        displayName: "Business Main",
        balanceValue: 4200.12,
        balanceCurrency: "EUR"
      }
    ];
  }

  async getAccountBalances() {
    return [
      {
        accountId: 1111,
        accountName: "Business Main",
        iban: "NL11BUNQ0001111111",
        balance: 4200.12,
        currency: "EUR"
      }
    ];
  }

  async syncTransactions() {
    return {
      totalSynced: 2,
      syncedByAccount: [{ accountId: 1111, synced: 2 }]
    };
  }

  async getTransactionDetails(accountId: number, paymentId: number) {
    return {
      userId: 42,
      monetaryAccountId: accountId,
      paymentId,
      amountValue: 1200,
      amountCurrency: "EUR",
      direction: "incoming" as const,
      description: "INV-2026-001",
      counterpartyName: "Acme BV",
      counterpartyIban: "NL91ABNA0417164300",
      reference: "INV-2026-001",
      createdAt: "2026-03-12",
      updatedAt: "2026-03-12",
      raw: {
        id: paymentId,
        created: "2026-03-12",
        updated: "2026-03-12",
        amount: { value: "1200.00", currency: "EUR" }
      }
    };
  }

  async ensureContext() {
    return {
      privateKeyPem: "",
      publicKeyPem: "",
      serverPublicKeyPem: "",
      installationToken: "inst",
      sessionToken: "sess",
      userId: 42,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01"
    };
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("acceptance workflow", () => {
  it("lists accounts, syncs transactions, reconciles invoices, and reports budget", async () => {
    const config = makeConfig();
    const logger = createLogger(config);
    const store = new SqliteStore(config.SQLITE_PATH, logger);
    const bunqClient = new FakeBunq() as unknown as BunqApiClient;

    const transactionService = new TransactionService(config, logger, bunqClient, store);

    const accounts = await transactionService.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.id).toBe(1111);

    const syncResult = await transactionService.syncTransactions({ accountIds: [1111] });
    expect(syncResult.totalSynced).toBe(2);

    store.upsertTransactions([
      {
        userId: 42,
        monetaryAccountId: 1111,
        paymentId: 9001,
        amountValue: 1200,
        amountCurrency: "EUR",
        direction: "incoming",
        description: "Payment INV-2026-001",
        counterpartyName: "Acme BV",
        counterpartyIban: "NL91ABNA0417164300",
        reference: "INV-2026-001",
        createdAt: "2026-03-12",
        updatedAt: "2026-03-12",
        rawJson: "{}"
      },
      {
        userId: 42,
        monetaryAccountId: 1111,
        paymentId: 9002,
        amountValue: -300,
        amountCurrency: "EUR",
        direction: "outgoing",
        description: "Software subscription",
        counterpartyName: "SaaS Inc",
        counterpartyIban: "NL00TEST0000000000",
        reference: null,
        createdAt: "2026-03-14",
        updatedAt: "2026-03-14",
        rawJson: "{}"
      }
    ]);

    const reconciliation = new ReconciliationService(config, logger, store).reconcile({
      invoiceSource: { type: "json", path: path.resolve("tests/fixtures/invoices.sample.json") },
      userId: 42,
      matchThreshold: 0.55
    });

    expect(reconciliation.totalInvoices).toBe(2);
    expect(reconciliation.matchedInvoices).toBeGreaterThanOrEqual(1);

    const budgetReport = new ReportingService(store).monthlyBudgetReport({
      month: "2026-03",
      plan: [
        { category: "revenue", plannedAmount: 2000 },
        { category: "subscriptions", plannedAmount: -200 }
      ],
      userId: 42
    });

    expect(budgetReport.month).toBe("2026-03");
    expect(budgetReport.categoryTotals.length).toBeGreaterThan(0);

    store.close();
  });

  it("handles webhook simulation and updates cache incrementally", async () => {
    const config = makeConfig();
    const logger = createLogger(config);
    const store = new SqliteStore(config.SQLITE_PATH, logger);
    const bunqClient = new FakeBunq() as unknown as BunqApiClient;
    const webhook = new BunqWebhookServer(config, logger, store, bunqClient);

    const payload = JSON.parse(fs.readFileSync(path.resolve("tests/fixtures/webhook.sample.json"), "utf8")) as unknown;
    const status = await webhook.processWebhookPayload(payload);

    expect(status).toBe("processed");

    const transactions = store.listTransactionsFromCache({ userId: 42, limit: 10 });
    expect(transactions.length).toBe(1);
    expect(transactions[0]?.paymentId).toBe(9001);

    store.close();
  });

  it("does not expose payment tools unless explicitly enabled", () => {
    const config = makeConfig({ ENABLE_PAYMENTS: false, ENABLE_DRAFT_PAYMENTS: false });
    const logger = createLogger(config);
    const store = new SqliteStore(config.SQLITE_PATH, logger);
    const bunqClient = new FakeBunq() as unknown as BunqApiClient;
    const webhook = new BunqWebhookServer(config, logger, store, bunqClient);

    const server = new BunqMcpServer(config, logger, bunqClient, store, webhook);
    const internalTools = (server as unknown as { toolDefinitions: Array<{ name: string }> }).toolDefinitions;

    expect(internalTools.some((tool) => tool.name === "create_draft_payment")).toBe(false);
    store.close();
  });
});
