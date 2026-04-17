export type InvoiceDirection = "incoming" | "outgoing";

export interface InvoiceRecord {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  issuedDate: string;
  dueDate?: string;
  counterpartyName?: string;
  counterpartyIban?: string;
  reference?: string;
  status?: "paid" | "unpaid" | "partial" | "unknown";
  direction: InvoiceDirection;
  metadata?: Record<string, unknown>;
}

export type InvoiceSource =
  | { type: "json"; path: string }
  | { type: "csv"; path: string; delimiter?: string }
  | { type: "sqlite"; path: string; query: string };
