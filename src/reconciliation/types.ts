import type { InvoiceRecord } from "../invoices/types.js";

export interface TransactionForMatching {
  paymentId: number;
  monetaryAccountId: number;
  amountValue: number;
  currency: string;
  direction: "incoming" | "outgoing";
  description: string;
  counterpartyName?: string | null;
  counterpartyIban?: string | null;
  reference?: string | null;
  createdAt: string;
}

export interface MatchingWeights {
  amount: number;
  iban: number;
  name: number;
  date: number;
  reference: number;
}

export interface MatchResult {
  invoice: InvoiceRecord;
  matchedTransaction: TransactionForMatching | null;
  confidence: number;
  explanation: string;
  matched: boolean;
  scoreBreakdown: {
    amount: number;
    iban: number;
    name: number;
    date: number;
    reference: number;
    directionPenalty: number;
  };
}

export interface ReconciliationReport {
  generatedAt: string;
  totalInvoices: number;
  matchedInvoices: number;
  unmatchedInvoices: number;
  matches: MatchResult[];
  unmatchedIncomingPayments: TransactionForMatching[];
}
