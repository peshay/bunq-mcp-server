import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import type { AppLogger } from "../utils/logger.js";
import type { InvoiceRecord, InvoiceSource } from "./types.js";

const InvoiceSchema = z.object({
  invoiceId: z.string().min(1).optional(),
  invoiceNumber: z.string().min(1),
  amount: z.coerce.number(),
  currency: z.string().default("EUR"),
  issuedDate: z.string().min(1),
  dueDate: z.string().optional(),
  counterpartyName: z.string().optional(),
  counterpartyIban: z.string().optional(),
  reference: z.string().optional(),
  status: z.enum(["paid", "unpaid", "partial", "unknown"]).optional(),
  direction: z.enum(["incoming", "outgoing"]).default("incoming")
});

function normalizeInvoice(input: unknown): InvoiceRecord {
  const parsed = InvoiceSchema.parse(input);
  return {
    invoiceId: parsed.invoiceId ?? parsed.invoiceNumber,
    invoiceNumber: parsed.invoiceNumber,
    amount: parsed.amount,
    currency: parsed.currency,
    issuedDate: parsed.issuedDate,
    dueDate: parsed.dueDate,
    counterpartyName: parsed.counterpartyName,
    counterpartyIban: parsed.counterpartyIban,
    reference: parsed.reference,
    status: parsed.status ?? "unknown",
    direction: parsed.direction
  };
}

export function loadInvoices(source: InvoiceSource, logger: AppLogger): InvoiceRecord[] {
  if (source.type === "json") {
    const raw = fs.readFileSync(source.path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const array = Array.isArray(parsed) ? parsed : [];
    return array.map(normalizeInvoice);
  }

  if (source.type === "csv") {
    const raw = fs.readFileSync(source.path, "utf8");
    const rows = parse(raw, {
      columns: true,
      skip_empty_lines: true,
      delimiter: source.delimiter ?? ",",
      trim: true
    }) as Array<Record<string, string>>;

    return rows.map((row) =>
      normalizeInvoice({
        invoiceId: row.invoiceId ?? row.invoice_id,
        invoiceNumber: row.invoiceNumber ?? row.invoice_number,
        amount: row.amount,
        currency: row.currency,
        issuedDate: row.issuedDate ?? row.issued_date,
        dueDate: row.dueDate ?? row.due_date,
        counterpartyName: row.counterpartyName ?? row.counterparty_name,
        counterpartyIban: row.counterpartyIban ?? row.counterparty_iban,
        reference: row.reference,
        status: row.status,
        direction: row.direction
      })
    );
  }

  const db = new DatabaseSync(source.path, { open: true, readOnly: true });
  try {
    const rows = db.prepare(source.query).all() as Array<Record<string, unknown>>;
    return rows.map((row) =>
      normalizeInvoice({
        invoiceId: row.invoiceId ?? row.invoice_id,
        invoiceNumber: row.invoiceNumber ?? row.invoice_number,
        amount: row.amount,
        currency: row.currency,
        issuedDate: row.issuedDate ?? row.issued_date,
        dueDate: row.dueDate ?? row.due_date,
        counterpartyName: row.counterpartyName ?? row.counterparty_name,
        counterpartyIban: row.counterpartyIban ?? row.counterparty_iban,
        reference: row.reference,
        status: row.status,
        direction: row.direction
      })
    );
  } catch (error) {
    logger.error({ err: error, source }, "Failed to load invoice records from sqlite source");
    throw error;
  } finally {
    db.close();
  }
}
