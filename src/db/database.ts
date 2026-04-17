import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AppLogger } from "../utils/logger.js";

export interface StoredTransaction {
  userId: number;
  monetaryAccountId: number;
  paymentId: number;
  amountValue: number;
  amountCurrency: string;
  direction: "incoming" | "outgoing";
  description: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  reference: string | null;
  createdAt: string;
  updatedAt: string;
  rawJson: string;
}

export interface BunqContextState {
  privateKeyPem: string;
  publicKeyPem: string;
  serverPublicKeyPem: string;
  installationToken: string;
  sessionToken: string;
  sessionExpiryTime?: string;
  userId: number;
  deviceServerId?: number;
  createdAt: string;
  updatedAt: string;
}

export class SqliteStore {
  private readonly db: DatabaseSync;

  constructor(private readonly sqlitePath: string, private readonly logger: AppLogger) {
    const dir = path.dirname(sqlitePath);
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(sqlitePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bunq_context (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transaction_cache (
        user_id INTEGER NOT NULL,
        monetary_account_id INTEGER NOT NULL,
        payment_id INTEGER NOT NULL,
        amount_value REAL NOT NULL,
        amount_currency TEXT NOT NULL,
        direction TEXT NOT NULL,
        description TEXT NOT NULL,
        counterparty_name TEXT,
        counterparty_iban TEXT,
        reference TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (monetary_account_id, payment_id)
      );

      CREATE INDEX IF NOT EXISTS idx_transaction_cache_created_at
        ON transaction_cache (created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_transaction_cache_counterparty_iban
        ON transaction_cache (counterparty_iban);

      CREATE TABLE IF NOT EXISTS webhook_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        received_at TEXT NOT NULL,
        processed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reconciliation_report (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_type TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payment_intent_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    this.logger.debug({ sqlitePath: this.sqlitePath }, "SQLite migrations complete");
  }

  close(): void {
    this.db.close();
  }

  getBunqContext(): BunqContextState | null {
    const row = this.db
      .prepare("SELECT payload_json FROM bunq_context WHERE id = 1")
      .get() as { payload_json: string } | undefined;

    return row ? (JSON.parse(row.payload_json) as BunqContextState) : null;
  }

  upsertBunqContext(state: BunqContextState): void {
    this.db
      .prepare(
        `INSERT INTO bunq_context (id, payload_json, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id)
         DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(state), new Date().toISOString());
  }

  upsertTransactions(records: StoredTransaction[]): number {
    const stmt = this.db.prepare(
      `INSERT INTO transaction_cache (
          user_id,
          monetary_account_id,
          payment_id,
          amount_value,
          amount_currency,
          direction,
          description,
          counterparty_name,
          counterparty_iban,
          reference,
          created_at,
          updated_at,
          raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(monetary_account_id, payment_id)
        DO UPDATE SET
          amount_value = excluded.amount_value,
          amount_currency = excluded.amount_currency,
          direction = excluded.direction,
          description = excluded.description,
          counterparty_name = excluded.counterparty_name,
          counterparty_iban = excluded.counterparty_iban,
          reference = excluded.reference,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          raw_json = excluded.raw_json`
    );

    this.db.exec("BEGIN TRANSACTION");
    try {
      for (const item of records) {
        stmt.run(
          item.userId,
          item.monetaryAccountId,
          item.paymentId,
          item.amountValue,
          item.amountCurrency,
          item.direction,
          item.description,
          item.counterpartyName,
          item.counterpartyIban,
          item.reference,
          item.createdAt,
          item.updatedAt,
          item.rawJson
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return records.length;
  }

  listTransactionsFromCache(filters: {
    userId?: number;
    monetaryAccountIds?: number[];
    fromDate?: string;
    toDate?: string;
    query?: string;
    limit?: number;
  }): StoredTransaction[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters.userId !== undefined) {
      clauses.push("user_id = ?");
      params.push(filters.userId);
    }

    if (filters.monetaryAccountIds?.length) {
      clauses.push(`monetary_account_id IN (${filters.monetaryAccountIds.map(() => "?").join(",")})`);
      params.push(...filters.monetaryAccountIds);
    }

    if (filters.fromDate) {
      clauses.push("created_at >= ?");
      params.push(filters.fromDate);
    }

    if (filters.toDate) {
      clauses.push("created_at <= ?");
      params.push(filters.toDate);
    }

    if (filters.query) {
      clauses.push("(description LIKE ? OR counterparty_name LIKE ? OR reference LIKE ?)");
      const needle = `%${filters.query}%`;
      params.push(needle, needle, needle);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = filters.limit ?? 100;

    return this.db
      .prepare(
        `SELECT
          user_id as userId,
          monetary_account_id as monetaryAccountId,
          payment_id as paymentId,
          amount_value as amountValue,
          amount_currency as amountCurrency,
          direction,
          description,
          counterparty_name as counterpartyName,
          counterparty_iban as counterpartyIban,
          reference,
          created_at as createdAt,
          updated_at as updatedAt,
          raw_json as rawJson
         FROM transaction_cache
         ${where}
         ORDER BY created_at DESC
         LIMIT ${Number(limit)}`
      )
      .all(...(params as Array<string | number | null>)) as unknown as StoredTransaction[];
  }

  getTransactionFromCache(monetaryAccountId: number, paymentId: number): StoredTransaction | null {
    const row = this.db
      .prepare(
        `SELECT
          user_id as userId,
          monetary_account_id as monetaryAccountId,
          payment_id as paymentId,
          amount_value as amountValue,
          amount_currency as amountCurrency,
          direction,
          description,
          counterparty_name as counterpartyName,
          counterparty_iban as counterpartyIban,
          reference,
          created_at as createdAt,
          updated_at as updatedAt,
          raw_json as rawJson
         FROM transaction_cache
         WHERE monetary_account_id = ? AND payment_id = ?`
      )
      .get(monetaryAccountId, paymentId) as StoredTransaction | undefined;

    return row ?? null;
  }

  listDistinctCounterparties(userId?: number): Array<{ name: string | null; iban: string | null }> {
    const sql = userId
      ? `SELECT DISTINCT counterparty_name as name, counterparty_iban as iban
         FROM transaction_cache WHERE user_id = ?`
      : `SELECT DISTINCT counterparty_name as name, counterparty_iban as iban
         FROM transaction_cache`;

    const rows = userId ? this.db.prepare(sql).all(userId) : this.db.prepare(sql).all();
    return rows as Array<{ name: string | null; iban: string | null }>;
  }

  tryInsertWebhookEvent(eventKey: string, source: string, payload: unknown): boolean {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO webhook_event (event_key, source, payload_json, status, received_at)
       VALUES (?, ?, ?, 'received', ?)`
    );

    try {
      stmt.run(eventKey, source, JSON.stringify(payload), now);
      return true;
    } catch {
      return false;
    }
  }

  markWebhookEventProcessed(eventKey: string, status: "processed" | "ignored" | "failed"): void {
    this.db
      .prepare("UPDATE webhook_event SET status = ?, processed_at = ? WHERE event_key = ?")
      .run(status, new Date().toISOString(), eventKey);
  }

  putSyncState(key: string, value: unknown): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sync_state (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key)
         DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), now);
  }

  getSyncState<T>(key: string): T | null {
    const row = this.db
      .prepare("SELECT value_json FROM sync_state WHERE key = ?")
      .get(key) as { value_json: string } | undefined;

    return row ? (JSON.parse(row.value_json) as T) : null;
  }

  storeReconciliationReport(reportType: string, report: unknown): number {
    const result = this.db
      .prepare(
        `INSERT INTO reconciliation_report (report_type, report_json, created_at)
         VALUES (?, ?, ?)`
      )
      .run(reportType, JSON.stringify(report), new Date().toISOString());

    return Number(result.lastInsertRowid);
  }

  listIncomingTransactions(userId?: number): StoredTransaction[] {
    const sql = userId
      ? `SELECT
          user_id as userId,
          monetary_account_id as monetaryAccountId,
          payment_id as paymentId,
          amount_value as amountValue,
          amount_currency as amountCurrency,
          direction,
          description,
          counterparty_name as counterpartyName,
          counterparty_iban as counterpartyIban,
          reference,
          created_at as createdAt,
          updated_at as updatedAt,
          raw_json as rawJson
        FROM transaction_cache
        WHERE direction = 'incoming' AND user_id = ?
        ORDER BY created_at DESC`
      : `SELECT
          user_id as userId,
          monetary_account_id as monetaryAccountId,
          payment_id as paymentId,
          amount_value as amountValue,
          amount_currency as amountCurrency,
          direction,
          description,
          counterparty_name as counterpartyName,
          counterparty_iban as counterpartyIban,
          reference,
          created_at as createdAt,
          updated_at as updatedAt,
          raw_json as rawJson
        FROM transaction_cache
        WHERE direction = 'incoming'
        ORDER BY created_at DESC`;

    return (userId ? this.db.prepare(sql).all(userId) : this.db.prepare(sql).all()) as unknown as StoredTransaction[];
  }

  logPaymentIntent(action: string, payload: unknown): void {
    this.db
      .prepare(
        `INSERT INTO payment_intent_log (action, payload_json, created_at)
         VALUES (?, ?, ?)`
      )
      .run(action, JSON.stringify(payload), new Date().toISOString());
  }
}
