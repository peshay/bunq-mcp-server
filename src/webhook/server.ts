import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import type { BunqApiClient } from "../bunq/client.js";
import type { BunqPayment } from "../bunq/types.js";
import type { AppConfig } from "../config.js";
import type { SqliteStore } from "../db/database.js";
import type { AppLogger } from "../utils/logger.js";

interface PaymentHint {
  paymentId?: number;
  accountId?: number;
  payment?: BunqPayment;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  const content = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("content-length", Buffer.byteLength(content));
  res.end(content);
}

function findByKey(root: unknown, key: string): unknown {
  const stack: unknown[] = [root];

  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }

    const obj = current as Record<string, unknown>;
    if (key in obj) {
      return obj[key];
    }

    stack.push(...Object.values(obj));
  }

  return undefined;
}

function extractPaymentHint(payload: unknown): PaymentHint {
  const payment = findByKey(payload, "Payment") as BunqPayment | undefined;
  const paymentId = typeof payment?.id === "number" ? payment.id : undefined;

  const accountCandidate =
    findByKey(payload, "monetary_account_id") ??
    findByKey(payload, "monetary-accountID") ??
    findByKey(payload, "monetaryAccountId");

  const accountId = typeof accountCandidate === "number" ? accountCandidate : undefined;

  return { paymentId, accountId, payment };
}

export class BunqWebhookServer {
  private server: http.Server | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly store: SqliteStore,
    private readonly bunqClient: BunqApiClient
  ) {}

  async start(): Promise<void> {
    if (!this.config.WEBHOOK_ENABLED) {
      this.logger.info("Webhook receiver disabled by configuration");
      return;
    }

    if (this.server) {
      return;
    }

    this.server = http.createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== this.config.WEBHOOK_PATH) {
        writeJson(res, 404, { error: "not_found" });
        return;
      }

      try {
        const rawBody = await readBody(req);

        if (this.config.WEBHOOK_SHARED_SECRET) {
          const provided = req.headers["x-webhook-secret"];
          if (provided !== this.config.WEBHOOK_SHARED_SECRET) {
            writeJson(res, 401, { error: "unauthorized" });
            return;
          }
        }

        const payload = rawBody ? (JSON.parse(rawBody) as unknown) : {};
        const externalEventId = req.headers["x-bunq-event-id"];
        const eventKey = typeof externalEventId === "string"
          ? externalEventId
          : createHash("sha256").update(rawBody).digest("hex");

        const inserted = this.store.tryInsertWebhookEvent(eventKey, "bunq_webhook", payload);
        if (!inserted) {
          writeJson(res, 200, { status: "duplicate_ignored" });
          return;
        }

        const status = await this.processWebhookPayload(payload);
        this.store.markWebhookEventProcessed(eventKey, status);

        writeJson(res, 200, { status });
      } catch (error) {
        this.logger.error({ err: error }, "Webhook processing failed");
        writeJson(res, 500, { error: "processing_failed" });
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.config.WEBHOOK_PORT, this.config.WEBHOOK_HOST, () => {
        this.server?.off("error", reject);
        resolve();
      });
    });

    this.logger.info(
      {
        host: this.config.WEBHOOK_HOST,
        port: this.config.WEBHOOK_PORT,
        path: this.config.WEBHOOK_PATH
      },
      "Webhook receiver listening"
    );
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.server = null;
  }

  async processWebhookPayload(payload: unknown): Promise<"processed" | "ignored" | "failed"> {
    try {
      const hint = extractPaymentHint(payload);
      if (!hint.accountId) {
        return "ignored";
      }

      if (hint.payment) {
        const context = await this.bunqClient.ensureContext();
        const amountValue = Number(hint.payment.amount?.value ?? "0");
        this.store.upsertTransactions([
          {
            userId: context.userId,
            monetaryAccountId: hint.accountId,
            paymentId: hint.payment.id,
            amountValue,
            amountCurrency: hint.payment.amount?.currency ?? "EUR",
            direction: amountValue >= 0 ? "incoming" : "outgoing",
            description: hint.payment.description ?? "",
            counterpartyName: hint.payment.counterparty_alias?.display_name ?? null,
            counterpartyIban: hint.payment.counterparty_alias?.iban ?? null,
            reference: hint.payment.merchant_reference ?? null,
            createdAt: hint.payment.created,
            updatedAt: hint.payment.updated,
            rawJson: JSON.stringify(hint.payment)
          }
        ]);
        return "processed";
      }

      if (hint.paymentId) {
        const detail = await this.bunqClient.getTransactionDetails(hint.accountId, hint.paymentId);
        if (!detail) {
          return "ignored";
        }
        this.store.upsertTransactions([
          {
            userId: detail.userId,
            monetaryAccountId: detail.monetaryAccountId,
            paymentId: detail.paymentId,
            amountValue: detail.amountValue,
            amountCurrency: detail.amountCurrency,
            direction: detail.direction,
            description: detail.description,
            counterpartyName: detail.counterpartyName,
            counterpartyIban: detail.counterpartyIban,
            reference: detail.reference,
            createdAt: detail.createdAt,
            updatedAt: detail.updatedAt,
            rawJson: JSON.stringify(detail.raw)
          }
        ]);
        return "processed";
      }

      await this.bunqClient.syncTransactions({ accountIds: [hint.accountId], maxPagesPerAccount: 1, count: 50 });
      return "processed";
    } catch (error) {
      this.logger.error({ err: error, payload }, "Webhook payload handling failed");
      return "failed";
    }
  }
}
