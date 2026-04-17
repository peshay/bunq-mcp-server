import type { BunqApiClient } from "../bunq/client.js";
import type { NormalizedTransaction } from "../bunq/types.js";
import type { AppConfig } from "../config.js";
import type { SqliteStore, StoredTransaction } from "../db/database.js";
import type { AppLogger } from "../utils/logger.js";

export interface TransactionQuery {
  monetaryAccountIds?: number[];
  fromDate?: string;
  toDate?: string;
  query?: string;
  limit?: number;
}

export class TransactionService {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly bunqClient: BunqApiClient,
    private readonly store: SqliteStore
  ) {}

  async syncTransactions(options: { accountIds?: number[]; count?: number; maxPagesPerAccount?: number }) {
    const result = await this.bunqClient.syncTransactions(options);
    this.logger.info({ result }, "Transactions synced from bunq");
    return result;
  }

  async listAccounts() {
    return this.bunqClient.listAccounts();
  }

  async getAccountBalances() {
    return this.bunqClient.getAccountBalances();
  }

  listCachedTransactions(query: TransactionQuery, userId?: number): StoredTransaction[] {
    return this.store.listTransactionsFromCache({
      userId,
      monetaryAccountIds: query.monetaryAccountIds,
      fromDate: query.fromDate,
      toDate: query.toDate,
      query: query.query,
      limit: query.limit
    });
  }

  async getTransactionDetails(accountId: number, paymentId: number, userId?: number): Promise<StoredTransaction | null> {
    const cached = this.store.getTransactionFromCache(accountId, paymentId);
    if (cached) {
      return cached;
    }

    const fromApi = await this.bunqClient.getTransactionDetails(accountId, paymentId);
    if (!fromApi) {
      return null;
    }

    this.store.upsertTransactions([this.mapNormalizedToStored(fromApi)]);
    const postInsert = this.store.getTransactionFromCache(accountId, paymentId);

    if (userId && postInsert && postInsert.userId !== userId) {
      return null;
    }

    return postInsert;
  }

  listCounterparties(userId?: number): Array<{ name: string | null; iban: string | null }> {
    return this.store
      .listDistinctCounterparties(userId)
      .filter((entry) => Boolean(entry.name || entry.iban))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }

  listIncomingTransactions(userId?: number): StoredTransaction[] {
    return this.store.listIncomingTransactions(userId);
  }

  private mapNormalizedToStored(tx: NormalizedTransaction): StoredTransaction {
    return {
      userId: tx.userId,
      monetaryAccountId: tx.monetaryAccountId,
      paymentId: tx.paymentId,
      amountValue: tx.amountValue,
      amountCurrency: tx.amountCurrency,
      direction: tx.direction,
      description: tx.description,
      counterpartyName: tx.counterpartyName,
      counterpartyIban: tx.counterpartyIban,
      reference: tx.reference,
      createdAt: tx.createdAt,
      updatedAt: tx.updatedAt,
      rawJson: JSON.stringify(tx.raw)
    };
  }
}
