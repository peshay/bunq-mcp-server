import fs from "node:fs";
import path from "node:path";
import { createHash, createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { SqliteStore, type BunqContextState } from "../db/database.js";
import { ExternalApiError } from "../utils/errors.js";
import type { AppLogger } from "../utils/logger.js";
import {
  extractUserIdFromSession,
  parseInstallationData,
  parseMonetaryAccounts,
  parsePayments,
  parseSessionToken,
  parseSinglePayment
} from "./parsing.js";
import type { BunqApiEnvelope, NormalizedAccount, NormalizedTransaction } from "./types.js";

interface RequestOptions {
  authToken?: string;
  body?: unknown;
  signBody?: boolean;
  query?: Record<string, string | number | undefined>;
}

interface ListTransactionsOptions {
  accountId: number;
  count?: number;
  olderId?: number;
  newerId?: number;
}

interface SyncTransactionsOptions {
  accountIds?: number[];
  count?: number;
  maxPagesPerAccount?: number;
}

function normalizePem(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function parseDate(value: string | undefined): number {
  if (!value) {
    return Number.NaN;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.NaN : ms;
}

function maybeStringify(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value);
}

export class BunqApiClient {
  private context: BunqContextState | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly store: SqliteStore
  ) {}

  async listAccounts(): Promise<NormalizedAccount[]> {
    const context = await this.ensureContext();
    const response = await this.request<BunqApiEnvelope>(
      "GET",
      `/user/${context.userId}/monetary-account`,
      { authToken: context.sessionToken }
    );

    return parseMonetaryAccounts(response);
  }

  async getAccountBalances(): Promise<
    Array<{ accountId: number; accountName: string | null; iban: string | null; balance: number | null; currency: string | null }>
  > {
    const accounts = await this.listAccounts();

    return accounts.map((account) => ({
      accountId: account.id,
      accountName: account.displayName,
      iban: account.iban,
      balance: account.balanceValue,
      currency: account.balanceCurrency
    }));
  }

  async listTransactions(options: ListTransactionsOptions): Promise<NormalizedTransaction[]> {
    const context = await this.ensureContext();

    const response = await this.request<BunqApiEnvelope>(
      "GET",
      `/user/${context.userId}/monetary-account/${options.accountId}/payment`,
      {
        authToken: context.sessionToken,
        query: {
          count: options.count,
          older_id: options.olderId,
          newer_id: options.newerId
        }
      }
    );

    return parsePayments(response, context.userId, options.accountId);
  }

  async getTransactionDetails(accountId: number, paymentId: number): Promise<NormalizedTransaction | null> {
    const context = await this.ensureContext();

    const response = await this.request<BunqApiEnvelope>(
      "GET",
      `/user/${context.userId}/monetary-account/${accountId}/payment/${paymentId}`,
      { authToken: context.sessionToken }
    );

    return parseSinglePayment(response, context.userId, accountId);
  }

  async syncTransactions(options: SyncTransactionsOptions = {}): Promise<{
    totalSynced: number;
    syncedByAccount: Array<{ accountId: number; synced: number }>;
  }> {
    const accounts = await this.listAccounts();
    const accountIds = options.accountIds?.length
      ? accounts.filter((account) => options.accountIds?.includes(account.id)).map((account) => account.id)
      : accounts.map((account) => account.id);

    const maxPages = options.maxPagesPerAccount ?? 5;
    const count = options.count ?? this.config.DEFAULT_TRANSACTION_PAGE_SIZE;
    const syncedByAccount: Array<{ accountId: number; synced: number }> = [];
    let totalSynced = 0;

    for (const accountId of accountIds) {
      let syncedForAccount = 0;
      let olderId: number | undefined;

      for (let page = 0; page < maxPages; page += 1) {
        const pageItems = await this.listTransactions({
          accountId,
          count,
          olderId
        });

        if (!pageItems.length) {
          break;
        }

        const stored = this.store.upsertTransactions(
          pageItems.map((item) => ({
            userId: item.userId,
            monetaryAccountId: item.monetaryAccountId,
            paymentId: item.paymentId,
            amountValue: item.amountValue,
            amountCurrency: item.amountCurrency,
            direction: item.direction,
            description: item.description,
            counterpartyName: item.counterpartyName,
            counterpartyIban: item.counterpartyIban,
            reference: item.reference,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            rawJson: JSON.stringify(item.raw)
          }))
        );

        syncedForAccount += stored;
        totalSynced += stored;

        const minId = Math.min(...pageItems.map((item) => item.paymentId));
        if (!Number.isFinite(minId)) {
          break;
        }
        olderId = minId;

        if (pageItems.length < count) {
          break;
        }
      }

      syncedByAccount.push({ accountId, synced: syncedForAccount });
      this.store.putSyncState(`account:${accountId}:last_sync`, { at: new Date().toISOString(), syncedForAccount });
    }

    return { totalSynced, syncedByAccount };
  }

  async refreshSession(): Promise<BunqContextState> {
    const context = await this.ensureContext();
    const refreshed = await this.createSession({
      ...context,
      updatedAt: new Date().toISOString()
    });
    this.persistContext(refreshed);
    this.context = refreshed;
    return refreshed;
  }

  async registerNotificationFilterUrl(url: string, categories: string[] = ["MUTATION", "PAYMENT"]): Promise<void> {
    const context = await this.ensureContext();
    await this.request<BunqApiEnvelope>(
      "POST",
      `/user/${context.userId}/notification-filter-url`,
      {
        authToken: context.sessionToken,
        body: {
          notification_filters: categories.map((category) => ({
            category,
            notification_target: url
          }))
        }
      }
    );
  }

  async ensureContext(): Promise<BunqContextState> {
    if (this.context && this.isContextSessionUsable(this.context)) {
      return this.context;
    }

    const stored = this.loadPersistedContext();
    if (stored) {
      if (this.isContextSessionUsable(stored)) {
        this.context = stored;
        return stored;
      }

      try {
        const refreshed = await this.createSession(stored);
        this.persistContext(refreshed);
        this.context = refreshed;
        return refreshed;
      } catch (error) {
        this.logger.warn({ err: error }, "Failed to refresh existing bunq session, re-bootstrapping");
      }
    }

    const fresh = await this.bootstrapContext();
    this.persistContext(fresh);
    this.context = fresh;
    return fresh;
  }

  private isContextSessionUsable(context: BunqContextState): boolean {
    if (!context.sessionToken) {
      return false;
    }

    const expiryMs = parseDate(context.sessionExpiryTime);
    if (!Number.isFinite(expiryMs)) {
      return true;
    }

    return expiryMs > Date.now() + 60_000;
  }

  private loadPersistedContext(): BunqContextState | null {
    const fromDb = this.store.getBunqContext();
    if (fromDb) {
      return fromDb;
    }

    const location = this.config.BUNQ_CONTEXT_PATH;
    if (!fs.existsSync(location)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(location, "utf8");
      const parsed = JSON.parse(raw) as BunqContextState;
      return parsed;
    } catch (error) {
      this.logger.warn({ err: error, location }, "Unable to load persisted bunq context file");
      return null;
    }
  }

  private persistContext(context: BunqContextState): void {
    this.store.upsertBunqContext(context);

    const location = this.config.BUNQ_CONTEXT_PATH;
    fs.mkdirSync(path.dirname(location), { recursive: true });
    fs.writeFileSync(location, `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600 });
  }

  private async bootstrapContext(): Promise<BunqContextState> {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: "spki",
        format: "pem"
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem"
      }
    });

    const createdAt = new Date().toISOString();

    const installationResponse = await this.request<BunqApiEnvelope>("POST", "/installation", {
      body: { client_public_key: normalizePem(publicKey) }
    });

    const { installationToken, serverPublicKeyPem } = parseInstallationData(installationResponse);

    await this.request<BunqApiEnvelope>("POST", "/device-server", {
      authToken: installationToken,
      signBody: true,
      body: {
        description: this.config.BUNQ_DEVICE_DESCRIPTION,
        secret: this.config.BUNQ_API_KEY,
        ...(this.config.BUNQ_PERMITTED_IPS
          ? {
              permitted_ips: this.config.BUNQ_PERMITTED_IPS.split(",")
                .map((entry) => entry.trim())
                .filter(Boolean)
            }
          : {})
      }
    }, normalizePem(privateKey));

    const bootstrappedContext: BunqContextState = {
      privateKeyPem: normalizePem(privateKey),
      publicKeyPem: normalizePem(publicKey),
      serverPublicKeyPem: normalizePem(serverPublicKeyPem),
      installationToken,
      sessionToken: "",
      userId: 0,
      createdAt,
      updatedAt: createdAt
    };

    const withSession = await this.createSession(bootstrappedContext);

    return withSession;
  }

  private async createSession(existing: BunqContextState): Promise<BunqContextState> {
    const response = await this.request<BunqApiEnvelope>(
      "POST",
      "/session-server",
      {
        authToken: existing.installationToken,
        signBody: true,
        body: {
          secret: this.config.BUNQ_API_KEY
        }
      },
      existing.privateKeyPem
    );

    const sessionToken = parseSessionToken(response);
    const userId = extractUserIdFromSession(response);

    const updatedAt = new Date().toISOString();

    return {
      ...existing,
      sessionToken,
      userId,
      updatedAt,
      sessionExpiryTime: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    };
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    endpoint: string,
    options: RequestOptions = {},
    privateKeyOverride?: string
  ): Promise<T> {
    const url = this.buildUrl(endpoint, options.query);
    const bodyString = maybeStringify(options.body);
    const signingKey = privateKeyOverride ?? this.context?.privateKeyPem;

    const headers: Record<string, string> = {
      "Cache-Control": "no-cache",
      "User-Agent": this.config.BUNQ_USER_AGENT,
      "X-Bunq-Language": this.config.BUNQ_LANGUAGE,
      "X-Bunq-Region": this.config.BUNQ_REGION,
      "X-Bunq-Geolocation": this.config.BUNQ_GEOLOCATION,
      "X-Bunq-Client-Request-Id": randomUUID()
    };

    if (options.authToken) {
      headers["X-Bunq-Client-Authentication"] = options.authToken;
    }

    if (options.signBody && signingKey) {
      headers["X-Bunq-Client-Signature"] = this.signBody(bodyString, signingKey);
    }
    if (options.signBody && !signingKey) {
      throw new ExternalApiError("Missing private key for signed bunq request", { endpoint, method });
    }

    if (bodyString) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: bodyString || undefined,
      signal: AbortSignal.timeout(30_000)
    });

    const responseText = await response.text();
    let parsed: unknown = {};
    if (responseText) {
      try {
        parsed = JSON.parse(responseText) as unknown;
      } catch {
        parsed = { raw: responseText };
      }
    }

    if (!response.ok) {
      const envelope = parsed as BunqApiEnvelope;
      const errors = envelope.Error?.map((item) => item.error_description || item.error_description_translated).filter(Boolean);
      throw new ExternalApiError(`bunq API request failed: ${response.status}`, {
        endpoint,
        status: response.status,
        method,
        requestId: headers["X-Bunq-Client-Request-Id"],
        errors,
        bodyHash: createHash("sha256").update(bodyString).digest("hex")
      });
    }

    return parsed as T;
  }

  private signBody(body: string, privateKeyPem: string): string {
    const signer = createSign("RSA-SHA256");
    signer.update(body);
    signer.end();
    return signer.sign(privateKeyPem, "base64");
  }

  private buildUrl(endpoint: string, query?: RequestOptions["query"]): string {
    const base = this.config.BUNQ_API_BASE_URL.replace(/\/$/, "");
    const root = endpoint.startsWith("http") ? endpoint : `${base}/${endpoint.replace(/^\//, "")}`;
    const url = new URL(root);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) {
          continue;
        }
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }
}
