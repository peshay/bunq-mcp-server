import { computeMonthlyBudgetReport, computeMonthlyCashflowSummary, type BudgetPlanLine, type CategoryRule } from "../budget/reporting.js";
import type { SqliteStore } from "../db/database.js";

export class ReportingService {
  constructor(private readonly store: SqliteStore) {}

  monthlyCashflowSummary(options: {
    month: string;
    currency?: string;
    monetaryAccountIds?: number[];
    userId?: number;
  }) {
    const transactions = this.store.listTransactionsFromCache({
      userId: options.userId,
      monetaryAccountIds: options.monetaryAccountIds,
      fromDate: `${options.month}-01 00:00:00`,
      toDate: `${options.month}-31 23:59:59`,
      limit: 20_000
    });

    return computeMonthlyCashflowSummary(transactions, options.month, options.currency ?? "EUR");
  }

  monthlyBudgetReport(options: {
    month: string;
    plan: BudgetPlanLine[];
    rules?: CategoryRule[];
    monetaryAccountIds?: number[];
    userId?: number;
  }) {
    const [yearStr, monthStr] = options.month.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      throw new Error(`Invalid month format: ${options.month}`);
    }
    const from = `${options.month}-01 00:00:00`;
    const start = new Date(Date.UTC(year, month - 1, 1));
    start.setUTCMonth(start.getUTCMonth() - 3);
    const prevYear = start.getUTCFullYear();
    const prevMonth = String(start.getUTCMonth() + 1).padStart(2, "0");
    const historicalFrom = `${prevYear}-${prevMonth}-01 00:00:00`;

    const transactions = this.store.listTransactionsFromCache({
      userId: options.userId,
      monetaryAccountIds: options.monetaryAccountIds,
      fromDate: historicalFrom,
      toDate: `${options.month}-31 23:59:59`,
      limit: 100_000
    });

    return computeMonthlyBudgetReport({
      transactions,
      month: options.month,
      plan: options.plan,
      rules: options.rules
    });
  }
}

export type { BudgetPlanLine, CategoryRule } from "../budget/reporting.js";
