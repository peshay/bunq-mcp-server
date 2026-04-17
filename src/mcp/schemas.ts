import { z } from "zod";

export const InvoiceSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("json"),
    path: z.string().min(1)
  }),
  z.object({
    type: z.literal("csv"),
    path: z.string().min(1),
    delimiter: z.string().min(1).optional()
  }),
  z.object({
    type: z.literal("sqlite"),
    path: z.string().min(1),
    query: z.string().min(1)
  })
]);

export const CategoryRuleSchema = z.object({
  category: z.string().min(1),
  descriptionContains: z.array(z.string().min(1)).optional(),
  counterpartyContains: z.array(z.string().min(1)).optional(),
  ibans: z.array(z.string().min(1)).optional(),
  direction: z.enum(["incoming", "outgoing"]).optional()
});

export const BudgetPlanLineSchema = z.object({
  category: z.string().min(1),
  plannedAmount: z.number()
});

export const ListAccountsInputSchema = z.object({
  includeInactive: z.boolean().default(true)
});

export const ListAccountsOutputSchema = z.object({
  accounts: z.array(
    z.object({
      id: z.number(),
      type: z.string(),
      description: z.string(),
      status: z.string(),
      iban: z.string().nullable(),
      displayName: z.string().nullable(),
      balanceValue: z.number().nullable(),
      balanceCurrency: z.string().nullable()
    })
  )
});

export const GetAccountBalancesInputSchema = z.object({
  accountIds: z.array(z.number()).optional()
});

export const GetAccountBalancesOutputSchema = z.object({
  balances: z.array(
    z.object({
      accountId: z.number(),
      accountName: z.string().nullable(),
      iban: z.string().nullable(),
      balance: z.number().nullable(),
      currency: z.string().nullable()
    })
  )
});

export const SyncTransactionsInputSchema = z.object({
  accountIds: z.array(z.number()).optional(),
  count: z.number().int().positive().max(200).optional(),
  maxPagesPerAccount: z.number().int().positive().max(100).optional()
});

export const SyncTransactionsOutputSchema = z.object({
  totalSynced: z.number().int(),
  syncedByAccount: z.array(
    z.object({
      accountId: z.number().int(),
      synced: z.number().int()
    })
  )
});

export const ListTransactionsInputSchema = z.object({
  accountIds: z.array(z.number().int()).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  query: z.string().optional(),
  limit: z.number().int().positive().max(10_000).default(200),
  syncBeforeRead: z.boolean().default(false)
});

export const TransactionRecordSchema = z.object({
  userId: z.number(),
  monetaryAccountId: z.number(),
  paymentId: z.number(),
  amountValue: z.number(),
  amountCurrency: z.string(),
  direction: z.enum(["incoming", "outgoing"]),
  description: z.string(),
  counterpartyName: z.string().nullable(),
  counterpartyIban: z.string().nullable(),
  reference: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const ListTransactionsOutputSchema = z.object({
  transactions: z.array(TransactionRecordSchema)
});

export const GetTransactionDetailsInputSchema = z.object({
  monetaryAccountId: z.number().int(),
  paymentId: z.number().int()
});

export const GetTransactionDetailsOutputSchema = z.object({
  transaction: TransactionRecordSchema.nullable()
});

export const SearchTransactionsInputSchema = z.object({
  query: z.string().min(1),
  accountIds: z.array(z.number().int()).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  limit: z.number().int().positive().max(10_000).default(200)
});

export const SearchTransactionsOutputSchema = z.object({
  transactions: z.array(TransactionRecordSchema)
});

export const ListCounterpartiesInputSchema = z.object({
  limit: z.number().int().positive().max(10_000).default(1000)
});

export const ListCounterpartiesOutputSchema = z.object({
  counterparties: z.array(
    z.object({
      name: z.string().nullable(),
      iban: z.string().nullable()
    })
  )
});

export const MonthlyCashflowSummaryInputSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  currency: z.string().default("EUR"),
  accountIds: z.array(z.number().int()).optional()
});

export const MonthlyCashflowSummaryOutputSchema = z.object({
  month: z.string(),
  currency: z.string(),
  income: z.number(),
  expenses: z.number(),
  net: z.number(),
  accountBreakdown: z.array(
    z.object({
      monetaryAccountId: z.number(),
      income: z.number(),
      expenses: z.number(),
      net: z.number()
    })
  )
});

export const MonthlyBudgetReportInputSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  plan: z.array(BudgetPlanLineSchema),
  rules: z.array(CategoryRuleSchema).optional(),
  accountIds: z.array(z.number().int()).optional()
});

export const MonthlyBudgetReportOutputSchema = z.object({
  month: z.string(),
  generatedAt: z.string(),
  categoryTotals: z.array(
    z.object({
      category: z.string(),
      actual: z.number(),
      planned: z.number(),
      variance: z.number(),
      rolling3MonthBaseline: z.number()
    })
  ),
  unusualExpenses: z.array(
    z.object({
      category: z.string(),
      actual: z.number(),
      baseline: z.number(),
      planned: z.number()
    })
  ),
  revenueDrops: z.array(
    z.object({
      category: z.string(),
      actual: z.number(),
      baseline: z.number()
    })
  )
});

export const ReconcileInvoicesInputSchema = z.object({
  invoiceSource: InvoiceSourceSchema,
  accountIds: z.array(z.number().int()).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  dateWindowDays: z.number().int().positive().optional(),
  amountTolerance: z.number().nonnegative().optional(),
  matchThreshold: z.number().min(0).max(1).optional()
});

const MatchResultSchema = z.object({
  invoice: z.object({
    invoiceId: z.string(),
    invoiceNumber: z.string(),
    amount: z.number(),
    currency: z.string(),
    issuedDate: z.string(),
    dueDate: z.string().optional(),
    counterpartyName: z.string().optional(),
    counterpartyIban: z.string().optional(),
    reference: z.string().optional(),
    status: z.enum(["paid", "unpaid", "partial", "unknown"]).optional(),
    direction: z.enum(["incoming", "outgoing"])
  }),
  matchedTransaction: z
    .object({
      paymentId: z.number(),
      monetaryAccountId: z.number(),
      amountValue: z.number(),
      currency: z.string(),
      direction: z.enum(["incoming", "outgoing"]),
      description: z.string(),
      counterpartyName: z.string().nullable().optional(),
      counterpartyIban: z.string().nullable().optional(),
      reference: z.string().nullable().optional(),
      createdAt: z.string()
    })
    .nullable(),
  confidence: z.number(),
  explanation: z.string(),
  matched: z.boolean(),
  scoreBreakdown: z.object({
    amount: z.number(),
    iban: z.number(),
    name: z.number(),
    date: z.number(),
    reference: z.number(),
    directionPenalty: z.number()
  })
});

export const ReconcileInvoicesOutputSchema = z.object({
  generatedAt: z.string(),
  totalInvoices: z.number().int(),
  matchedInvoices: z.number().int(),
  unmatchedInvoices: z.number().int(),
  matches: z.array(MatchResultSchema),
  unmatchedIncomingPayments: z.array(
    z.object({
      paymentId: z.number(),
      monetaryAccountId: z.number(),
      amountValue: z.number(),
      currency: z.string(),
      direction: z.enum(["incoming", "outgoing"]),
      description: z.string(),
      counterpartyName: z.string().nullable().optional(),
      counterpartyIban: z.string().nullable().optional(),
      reference: z.string().nullable().optional(),
      createdAt: z.string()
    })
  )
});

export const FindUnmatchedIncomingPaymentsInputSchema = z.object({
  reconciliationReport: ReconcileInvoicesOutputSchema
});

export const FindUnmatchedIncomingPaymentsOutputSchema = z.object({
  unmatchedIncomingPayments: ReconcileInvoicesOutputSchema.shape.unmatchedIncomingPayments
});

export const FindUnpaidInvoicesInputSchema = z.object({
  reconciliationReport: ReconcileInvoicesOutputSchema
});

export const FindUnpaidInvoicesOutputSchema = z.object({
  unpaidInvoices: z.array(MatchResultSchema.shape.invoice)
});

export const ExportReconciliationReportInputSchema = z.object({
  reconciliationReport: ReconcileInvoicesOutputSchema,
  format: z.enum(["json", "csv"]),
  outputPath: z.string().min(1)
});

export const ExportReconciliationReportOutputSchema = z.object({
  path: z.string(),
  format: z.enum(["json", "csv"])
});

export const SimulateWebhookEventInputSchema = z.object({
  payload: z.record(z.string(), z.unknown())
});

export const SimulateWebhookEventOutputSchema = z.object({
  status: z.enum(["processed", "ignored", "failed"])
});

export const DraftPaymentInputSchema = z.object({
  confirmationPhrase: z.string(),
  reason: z.string().min(1),
  monetaryAccountId: z.number().int(),
  amount: z.number(),
  currency: z.string().default("EUR"),
  counterpartyIban: z.string().min(1),
  counterpartyName: z.string().min(1),
  description: z.string().min(1)
});

export const DraftPaymentOutputSchema = z.object({
  status: z.literal("draft_payment_not_implemented"),
  logged: z.boolean()
});
