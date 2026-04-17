import type { StoredTransaction } from "../db/database.js";

export interface CategoryRule {
  category: string;
  descriptionContains?: string[];
  counterpartyContains?: string[];
  ibans?: string[];
  direction?: "incoming" | "outgoing";
}

export interface BudgetPlanLine {
  category: string;
  plannedAmount: number;
}

export interface MonthlyCashflowSummary {
  month: string;
  currency: string;
  income: number;
  expenses: number;
  net: number;
  accountBreakdown: Array<{
    monetaryAccountId: number;
    income: number;
    expenses: number;
    net: number;
  }>;
}

export interface MonthlyBudgetReport {
  month: string;
  generatedAt: string;
  categoryTotals: Array<{
    category: string;
    actual: number;
    planned: number;
    variance: number;
    rolling3MonthBaseline: number;
  }>;
  unusualExpenses: Array<{ category: string; actual: number; baseline: number; planned: number }>;
  revenueDrops: Array<{ category: string; actual: number; baseline: number }>;
}

const DEFAULT_RULES: CategoryRule[] = [
  { category: "revenue", direction: "incoming" },
  { category: "tax", descriptionContains: ["tax", "vat", "belasting"], direction: "outgoing" },
  { category: "payroll", descriptionContains: ["salary", "payroll", "wage"], direction: "outgoing" },
  { category: "office", descriptionContains: ["office", "supplies", "software", "hosting"], direction: "outgoing" },
  { category: "travel", descriptionContains: ["flight", "hotel", "uber", "train"], direction: "outgoing" },
  { category: "subscriptions", descriptionContains: ["subscription", "monthly", "license"], direction: "outgoing" },
  { category: "uncategorized" }
];

function toMonthKey(date: string): string {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function matchesRule(tx: StoredTransaction, rule: CategoryRule): boolean {
  if (rule.direction && tx.direction !== rule.direction) {
    return false;
  }

  if (rule.ibans?.length) {
    const iban = normalize(tx.counterpartyIban);
    const ibanMatch = rule.ibans.some((candidate) => iban.includes(candidate.toLowerCase()));
    if (!ibanMatch) {
      return false;
    }
  }

  if (rule.descriptionContains?.length) {
    const text = normalize(tx.description);
    const found = rule.descriptionContains.some((needle) => text.includes(needle.toLowerCase()));
    if (!found) {
      return false;
    }
  }

  if (rule.counterpartyContains?.length) {
    const name = normalize(tx.counterpartyName);
    const found = rule.counterpartyContains.some((needle) => name.includes(needle.toLowerCase()));
    if (!found) {
      return false;
    }
  }

  return true;
}

function categorizeTransaction(tx: StoredTransaction, rules: CategoryRule[]): string {
  for (const rule of rules) {
    if (rule.category === "uncategorized") {
      continue;
    }

    if (matchesRule(tx, rule)) {
      return rule.category;
    }
  }

  return "uncategorized";
}

export function computeMonthlyCashflowSummary(
  transactions: StoredTransaction[],
  month: string,
  currency = "EUR"
): MonthlyCashflowSummary {
  const monthTx = transactions.filter((tx) => toMonthKey(tx.createdAt) === month);

  let income = 0;
  let expenses = 0;

  const byAccount = new Map<number, { income: number; expenses: number }>();

  for (const tx of monthTx) {
    const amount = tx.amountValue;
    const bucket = byAccount.get(tx.monetaryAccountId) ?? { income: 0, expenses: 0 };

    if (amount >= 0) {
      income += amount;
      bucket.income += amount;
    } else {
      expenses += Math.abs(amount);
      bucket.expenses += Math.abs(amount);
    }

    byAccount.set(tx.monetaryAccountId, bucket);
  }

  return {
    month,
    currency,
    income: Number(income.toFixed(2)),
    expenses: Number(expenses.toFixed(2)),
    net: Number((income - expenses).toFixed(2)),
    accountBreakdown: Array.from(byAccount.entries()).map(([monetaryAccountId, value]) => ({
      monetaryAccountId,
      income: Number(value.income.toFixed(2)),
      expenses: Number(value.expenses.toFixed(2)),
      net: Number((value.income - value.expenses).toFixed(2))
    }))
  };
}

function monthsBefore(month: string, steps: number): string {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const date = new Date(Date.UTC(year, monthNum - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - steps);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function computeMonthlyBudgetReport(options: {
  transactions: StoredTransaction[];
  month: string;
  plan: BudgetPlanLine[];
  rules?: CategoryRule[];
}): MonthlyBudgetReport {
  const rules = options.rules?.length ? options.rules : DEFAULT_RULES;
  const monthTransactions = options.transactions.filter((tx) => toMonthKey(tx.createdAt) === options.month);
  const planByCategory = new Map(options.plan.map((line) => [line.category, line.plannedAmount]));

  const categoryActual = new Map<string, number>();
  for (const tx of monthTransactions) {
    const category = categorizeTransaction(tx, rules);
    const current = categoryActual.get(category) ?? 0;
    categoryActual.set(category, current + tx.amountValue);
  }

  const categories = new Set<string>([...categoryActual.keys(), ...planByCategory.keys()]);

  const baselineMonths = [monthsBefore(options.month, 1), monthsBefore(options.month, 2), monthsBefore(options.month, 3)];
  const categoryTotals = Array.from(categories).map((category) => {
    const actual = categoryActual.get(category) ?? 0;
    const planned = planByCategory.get(category) ?? 0;

    const baselineValues = baselineMonths.map((monthKey) => {
      const txs = options.transactions.filter((tx) => toMonthKey(tx.createdAt) === monthKey);
      return txs
        .filter((tx) => categorizeTransaction(tx, rules) === category)
        .reduce((sum, tx) => sum + tx.amountValue, 0);
    });

    const baseline = baselineValues.length
      ? baselineValues.reduce((sum, value) => sum + value, 0) / baselineValues.length
      : 0;

    return {
      category,
      actual: Number(actual.toFixed(2)),
      planned: Number(planned.toFixed(2)),
      variance: Number((actual - planned).toFixed(2)),
      rolling3MonthBaseline: Number(baseline.toFixed(2))
    };
  });

  const unusualExpenses = categoryTotals
    .filter((line) => line.actual < 0)
    .filter((line) => {
      const actualAbs = Math.abs(line.actual);
      const baselineAbs = Math.abs(line.rolling3MonthBaseline);
      const plannedAbs = Math.abs(line.planned);
      return actualAbs > baselineAbs * 1.25 && actualAbs > plannedAbs * 1.15;
    })
    .map((line) => ({
      category: line.category,
      actual: Number(Math.abs(line.actual).toFixed(2)),
      baseline: Number(Math.abs(line.rolling3MonthBaseline).toFixed(2)),
      planned: Number(Math.abs(line.planned).toFixed(2))
    }));

  const revenueDrops = categoryTotals
    .filter((line) => line.actual > 0)
    .filter((line) => line.actual < line.rolling3MonthBaseline * 0.7)
    .map((line) => ({
      category: line.category,
      actual: line.actual,
      baseline: line.rolling3MonthBaseline
    }));

  return {
    month: options.month,
    generatedAt: new Date().toISOString(),
    categoryTotals: categoryTotals.sort((a, b) => a.category.localeCompare(b.category)),
    unusualExpenses,
    revenueDrops
  };
}
