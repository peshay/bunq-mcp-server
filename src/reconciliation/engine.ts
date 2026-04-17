import type { InvoiceRecord } from "../invoices/types.js";
import type {
  MatchResult,
  MatchingWeights,
  ReconciliationReport,
  TransactionForMatching
} from "./types.js";

export interface ReconciliationOptions {
  dateWindowDays: number;
  amountTolerance: number;
  matchThreshold: number;
  weights?: Partial<MatchingWeights>;
}

const DEFAULT_WEIGHTS: MatchingWeights = {
  amount: 0.35,
  iban: 0.25,
  name: 0.15,
  date: 0.15,
  reference: 0.1
};

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function amountScore(invoiceAmount: number, txAmount: number, tolerance: number): number {
  const delta = Math.abs(Math.abs(invoiceAmount) - Math.abs(txAmount));
  if (delta <= tolerance) {
    return 1;
  }
  if (delta <= tolerance * 10) {
    return Math.max(0, 1 - delta / (tolerance * 10));
  }
  return 0;
}

function stringSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalize(a);
  const nb = normalize(b);

  if (!na || !nb) {
    return 0;
  }

  if (na === nb) {
    return 1;
  }

  if (na.includes(nb) || nb.includes(na)) {
    return 0.75;
  }

  const aTokens = new Set(na.match(/[a-z0-9]{3,}/g) ?? []);
  const bTokens = new Set(nb.match(/[a-z0-9]{3,}/g) ?? []);
  if (!aTokens.size || !bTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(aTokens.size, bTokens.size);
}

function dateScore(invoiceDate: string, paymentDate: string, dateWindowDays: number): number {
  const invoiceMs = Date.parse(invoiceDate);
  const paymentMs = Date.parse(paymentDate);
  if (Number.isNaN(invoiceMs) || Number.isNaN(paymentMs)) {
    return 0;
  }

  const diffDays = Math.abs(invoiceMs - paymentMs) / (24 * 60 * 60 * 1000);
  if (diffDays <= dateWindowDays) {
    return Math.max(0, 1 - diffDays / Math.max(1, dateWindowDays));
  }

  return 0;
}

function buildExplanation(result: MatchResult): string {
  if (!result.matched || !result.matchedTransaction) {
    return "No transaction passed the confidence threshold for this invoice.";
  }

  const parts: string[] = [];
  if (result.scoreBreakdown.amount > 0.8) {
    parts.push("amount matched closely");
  }
  if (result.scoreBreakdown.iban > 0.8) {
    parts.push("IBAN matched");
  }
  if (result.scoreBreakdown.name > 0.5) {
    parts.push("counterparty name similarity is high");
  }
  if (result.scoreBreakdown.date > 0.5) {
    parts.push("payment date is within configured window");
  }
  if (result.scoreBreakdown.reference > 0.5) {
    parts.push("reference or invoice number appears in payment text");
  }

  if (!parts.length) {
    parts.push("match selected by weighted aggregate score");
  }

  return `Matched with confidence ${result.confidence.toFixed(2)}: ${parts.join(", ")}.`;
}

function computeScore(
  invoice: InvoiceRecord,
  tx: TransactionForMatching,
  options: ReconciliationOptions,
  weights: MatchingWeights
): MatchResult["scoreBreakdown"] & { total: number } {
  const amount = amountScore(invoice.amount, tx.amountValue, options.amountTolerance);
  const iban = stringSimilarity(invoice.counterpartyIban, tx.counterpartyIban);
  const name = stringSimilarity(invoice.counterpartyName, tx.counterpartyName ?? tx.description);

  const datePivot = invoice.dueDate ?? invoice.issuedDate;
  const date = dateScore(datePivot, tx.createdAt, options.dateWindowDays);

  const invoiceHints = [invoice.invoiceNumber, invoice.reference].filter(Boolean).join(" ");
  const reference = Math.max(
    stringSimilarity(invoiceHints, tx.reference),
    stringSimilarity(invoiceHints, tx.description)
  );

  const expectedDirection = invoice.direction;
  const directionPenalty = tx.direction !== expectedDirection ? 0.15 : 0;

  const total = Math.max(
    0,
    amount * weights.amount +
      iban * weights.iban +
      name * weights.name +
      date * weights.date +
      reference * weights.reference -
      directionPenalty
  );

  return { amount, iban, name, date, reference, directionPenalty, total };
}

export function reconcileInvoices(
  invoices: InvoiceRecord[],
  transactions: TransactionForMatching[],
  options: ReconciliationOptions
): ReconciliationReport {
  const weights: MatchingWeights = {
    ...DEFAULT_WEIGHTS,
    ...options.weights
  };

  const matches: MatchResult[] = [];
  const usedPaymentIds = new Set<number>();

  for (const invoice of invoices) {
    let bestTx: TransactionForMatching | null = null;
    let bestScore = 0;
    let bestBreakdown: MatchResult["scoreBreakdown"] = {
      amount: 0,
      iban: 0,
      name: 0,
      date: 0,
      reference: 0,
      directionPenalty: 0
    };

    for (const tx of transactions) {
      if (usedPaymentIds.has(tx.paymentId)) {
        continue;
      }

      const score = computeScore(invoice, tx, options, weights);
      if (score.total > bestScore) {
        bestScore = score.total;
        bestTx = tx;
        bestBreakdown = {
          amount: score.amount,
          iban: score.iban,
          name: score.name,
          date: score.date,
          reference: score.reference,
          directionPenalty: score.directionPenalty
        };
      }
    }

    const matched = bestTx !== null && bestScore >= options.matchThreshold;
    if (matched && bestTx) {
      usedPaymentIds.add(bestTx.paymentId);
    }

    const result: MatchResult = {
      invoice,
      matchedTransaction: matched ? bestTx : null,
      confidence: Number(bestScore.toFixed(4)),
      explanation: "",
      matched,
      scoreBreakdown: bestBreakdown
    };

    result.explanation = buildExplanation(result);
    matches.push(result);
  }

  const unmatchedIncomingPayments = transactions.filter(
    (tx) => tx.direction === "incoming" && !usedPaymentIds.has(tx.paymentId)
  );

  const matchedInvoices = matches.filter((item) => item.matched).length;

  return {
    generatedAt: new Date().toISOString(),
    totalInvoices: invoices.length,
    matchedInvoices,
    unmatchedInvoices: invoices.length - matchedInvoices,
    matches,
    unmatchedIncomingPayments
  };
}

export function findUnpaidInvoices(report: ReconciliationReport): InvoiceRecord[] {
  return report.matches
    .filter((item) => !item.matched || item.invoice.status === "partial")
    .map((item) => item.invoice);
}
