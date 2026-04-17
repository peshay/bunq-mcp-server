import { describe, expect, it } from "vitest";
import { findUnpaidInvoices, reconcileInvoices } from "../../src/reconciliation/engine.js";
import type { InvoiceRecord } from "../../src/invoices/types.js";
import type { TransactionForMatching } from "../../src/reconciliation/types.js";

describe("reconcileInvoices", () => {
  const invoices: InvoiceRecord[] = [
    {
      invoiceId: "inv-1",
      invoiceNumber: "2026-001",
      amount: 1200,
      currency: "EUR",
      issuedDate: "2026-03-01",
      dueDate: "2026-03-15",
      counterpartyName: "Acme BV",
      counterpartyIban: "NL91ABNA0417164300",
      reference: "INV-2026-001",
      status: "unpaid",
      direction: "incoming"
    },
    {
      invoiceId: "inv-2",
      invoiceNumber: "2026-002",
      amount: 500,
      currency: "EUR",
      issuedDate: "2026-03-05",
      dueDate: "2026-03-20",
      counterpartyName: "Globex GmbH",
      counterpartyIban: "DE89370400440532013000",
      reference: "INV-2026-002",
      status: "unpaid",
      direction: "incoming"
    }
  ];

  const transactions: TransactionForMatching[] = [
    {
      paymentId: 9001,
      monetaryAccountId: 111,
      amountValue: 1200,
      currency: "EUR",
      direction: "incoming",
      description: "Payment INV-2026-001",
      counterpartyName: "Acme BV",
      counterpartyIban: "NL91ABNA0417164300",
      reference: "INV-2026-001",
      createdAt: "2026-03-12"
    },
    {
      paymentId: 9002,
      monetaryAccountId: 111,
      amountValue: 480,
      currency: "EUR",
      direction: "incoming",
      description: "Partial payment no ref",
      counterpartyName: "Unknown",
      counterpartyIban: "DE89370400440532013000",
      reference: null,
      createdAt: "2026-03-21"
    }
  ];

  it("matches invoice with confidence score and explanation", () => {
    const report = reconcileInvoices(invoices, transactions, {
      dateWindowDays: 14,
      amountTolerance: 0.01,
      matchThreshold: 0.55
    });

    expect(report.totalInvoices).toBe(2);
    expect(report.matchedInvoices).toBe(1);
    expect(report.matches[0]?.matched).toBe(true);
    expect(report.matches[0]?.confidence).toBeGreaterThan(0.8);
    expect(report.matches[0]?.explanation).toContain("confidence");
  });

  it("returns unmatched incoming payments and unpaid invoices", () => {
    const report = reconcileInvoices(invoices, transactions, {
      dateWindowDays: 14,
      amountTolerance: 0.01,
      matchThreshold: 0.55
    });

    expect(report.unmatchedIncomingPayments.length).toBe(1);
    expect(report.unmatchedIncomingPayments[0]?.paymentId).toBe(9002);

    const unpaid = findUnpaidInvoices(report);
    expect(unpaid).toHaveLength(1);
    expect(unpaid[0]?.invoiceNumber).toBe("2026-002");
  });
});
