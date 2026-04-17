import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { SqliteStore, StoredTransaction } from "../db/database.js";
import { loadInvoices } from "../invoices/loaders.js";
import type { InvoiceSource } from "../invoices/types.js";
import { findUnpaidInvoices, reconcileInvoices } from "../reconciliation/engine.js";
import type { ReconciliationReport, TransactionForMatching } from "../reconciliation/types.js";
import type { AppLogger } from "../utils/logger.js";

function toMatchingTransaction(tx: StoredTransaction): TransactionForMatching {
  return {
    paymentId: tx.paymentId,
    monetaryAccountId: tx.monetaryAccountId,
    amountValue: tx.amountValue,
    currency: tx.amountCurrency,
    direction: tx.direction,
    description: tx.description,
    counterpartyName: tx.counterpartyName,
    counterpartyIban: tx.counterpartyIban,
    reference: tx.reference,
    createdAt: tx.createdAt
  };
}

function toCsvRow(values: Array<string | number>): string {
  return values
    .map((value) => {
      const text = String(value ?? "");
      if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
        return `"${text.replace(/\"/g, "\"\"")}"`;
      }
      return text;
    })
    .join(",");
}

export class ReconciliationService {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly store: SqliteStore
  ) {}

  reconcile(options: {
    invoiceSource: InvoiceSource;
    monetaryAccountIds?: number[];
    fromDate?: string;
    toDate?: string;
    dateWindowDays?: number;
    amountTolerance?: number;
    matchThreshold?: number;
    userId?: number;
  }): ReconciliationReport {
    const invoices = loadInvoices(options.invoiceSource, this.logger);
    const transactions = this.store
      .listTransactionsFromCache({
        userId: options.userId,
        monetaryAccountIds: options.monetaryAccountIds,
        fromDate: options.fromDate,
        toDate: options.toDate,
        limit: 10_000
      })
      .map(toMatchingTransaction);

    const report = reconcileInvoices(invoices, transactions, {
      dateWindowDays: options.dateWindowDays ?? this.config.DEFAULT_RECONCILIATION_DATE_WINDOW_DAYS,
      amountTolerance: options.amountTolerance ?? this.config.DEFAULT_RECONCILIATION_AMOUNT_TOLERANCE,
      matchThreshold: options.matchThreshold ?? 0.55
    });

    this.store.storeReconciliationReport("invoice_vs_transactions", report);

    return report;
  }

  findUnmatchedIncomingPayments(report: ReconciliationReport): TransactionForMatching[] {
    return report.unmatchedIncomingPayments;
  }

  findUnpaidInvoices(report: ReconciliationReport) {
    return findUnpaidInvoices(report);
  }

  exportReport(report: ReconciliationReport, format: "json" | "csv", outputPath: string): { path: string; format: string } {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    if (format === "json") {
      fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      return { path: outputPath, format };
    }

    const header = [
      "invoice_id",
      "invoice_number",
      "invoice_amount",
      "invoice_currency",
      "matched",
      "confidence",
      "payment_id",
      "payment_account_id",
      "payment_amount",
      "payment_date",
      "counterparty_name",
      "counterparty_iban",
      "explanation"
    ];

    const rows = report.matches.map((match) =>
      toCsvRow([
        match.invoice.invoiceId,
        match.invoice.invoiceNumber,
        match.invoice.amount,
        match.invoice.currency,
        match.matched ? "true" : "false",
        match.confidence,
        match.matchedTransaction?.paymentId ?? "",
        match.matchedTransaction?.monetaryAccountId ?? "",
        match.matchedTransaction?.amountValue ?? "",
        match.matchedTransaction?.createdAt ?? "",
        match.matchedTransaction?.counterpartyName ?? "",
        match.matchedTransaction?.counterpartyIban ?? "",
        match.explanation
      ])
    );

    const content = `${toCsvRow(header)}\n${rows.join("\n")}\n`;
    fs.writeFileSync(outputPath, content, "utf8");

    return { path: outputPath, format };
  }
}
