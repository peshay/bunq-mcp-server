import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type ListToolsResult,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";
import type { z, ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { BunqApiClient } from "../bunq/client.js";
import type { AppConfig } from "../config.js";
import type { SqliteStore } from "../db/database.js";
import type { ReconciliationReport } from "../reconciliation/types.js";
import { ReconciliationService } from "../services/reconciliation-service.js";
import { ReportingService } from "../services/reporting-service.js";
import { TransactionService } from "../services/transaction-service.js";
import type { AppLogger } from "../utils/logger.js";
import { FeatureDisabledError } from "../utils/errors.js";
import {
  DraftPaymentInputSchema,
  DraftPaymentOutputSchema,
  ExportReconciliationReportInputSchema,
  ExportReconciliationReportOutputSchema,
  FindUnmatchedIncomingPaymentsInputSchema,
  FindUnmatchedIncomingPaymentsOutputSchema,
  FindUnpaidInvoicesInputSchema,
  FindUnpaidInvoicesOutputSchema,
  GetAccountBalancesInputSchema,
  GetAccountBalancesOutputSchema,
  GetTransactionDetailsInputSchema,
  GetTransactionDetailsOutputSchema,
  ListAccountsInputSchema,
  ListAccountsOutputSchema,
  ListCounterpartiesInputSchema,
  ListCounterpartiesOutputSchema,
  ListTransactionsInputSchema,
  ListTransactionsOutputSchema,
  MonthlyBudgetReportInputSchema,
  MonthlyBudgetReportOutputSchema,
  MonthlyCashflowSummaryInputSchema,
  MonthlyCashflowSummaryOutputSchema,
  ReconcileInvoicesInputSchema,
  ReconcileInvoicesOutputSchema,
  SearchTransactionsInputSchema,
  SearchTransactionsOutputSchema,
  SimulateWebhookEventInputSchema,
  SimulateWebhookEventOutputSchema,
  SyncTransactionsInputSchema,
  SyncTransactionsOutputSchema
} from "./schemas.js";
import type { BunqWebhookServer } from "../webhook/server.js";

type ToolHandler<I, O> = (input: I) => Promise<O>;

interface ToolDefinition<I extends ZodTypeAny, O extends ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  handler: ToolHandler<z.infer<I>, z.infer<O>>;
}

function serializeResult(result: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}

function toToolSchema(schema: ZodTypeAny, title: string): Tool["inputSchema"] {
  const raw = (zodToJsonSchema(schema, title) as Record<string, unknown>) ?? {};
  const maybeType = raw.type;

  if (maybeType === "object") {
    return raw as Tool["inputSchema"];
  }

  return { type: "object", properties: {}, additionalProperties: false };
}

export class BunqMcpServer {
  private readonly server: Server;
  private readonly transactionService: TransactionService;
  private readonly reconciliationService: ReconciliationService;
  private readonly reportingService: ReportingService;
  private readonly toolDefinitions: Array<ToolDefinition<ZodTypeAny, ZodTypeAny>>;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly bunqClient: BunqApiClient,
    private readonly store: SqliteStore,
    private readonly webhookServer: BunqWebhookServer
  ) {
    this.server = new Server(
      {
        name: config.MCP_SERVER_NAME,
        version: config.MCP_SERVER_VERSION
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.transactionService = new TransactionService(config, logger, bunqClient, store);
    this.reconciliationService = new ReconciliationService(config, logger, store);
    this.reportingService = new ReportingService(store);

    this.toolDefinitions = this.createToolDefinitions();
  }

  async start(): Promise<void> {
    this.server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
      const tools: Tool[] = this.toolDefinitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: toToolSchema(tool.inputSchema, `${tool.name}Input`)
      }));

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      const toolName = request.params.name;
      const definition = this.toolDefinitions.find((tool) => tool.name === toolName);

      if (!definition) {
        return {
          ...serializeResult({ error: `Unknown tool: ${toolName}` }),
          isError: true
        };
      }

      try {
        const parsedInput = definition.inputSchema.parse((request.params.arguments ?? {}) as unknown);
        const result = await definition.handler(parsedInput);
        const parsedOutput = definition.outputSchema.parse(result);
        return serializeResult(parsedOutput);
      } catch (error) {
        this.logger.error({ err: error, toolName }, "MCP tool execution failed");

        const errPayload =
          error instanceof Error
            ? {
                message: error.message,
                name: error.name
              }
            : {
                message: "Unknown error"
              };

        return {
          ...serializeResult({ error: errPayload }),
          isError: true
        };
      }
    });

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info("MCP stdio server started");
  }

  private createToolDefinitions(): Array<ToolDefinition<ZodTypeAny, ZodTypeAny>> {
    const tools: Array<ToolDefinition<ZodTypeAny, ZodTypeAny>> = [
      {
        name: "list_accounts",
        description: "List bunq monetary accounts available to the authenticated business user",
        inputSchema: ListAccountsInputSchema,
        outputSchema: ListAccountsOutputSchema,
        handler: async (input) => {
          const accounts = await this.transactionService.listAccounts();
          return {
            accounts: input.includeInactive ? accounts : accounts.filter((account) => account.status === "ACTIVE")
          };
        }
      },
      {
        name: "get_account_balances",
        description: "Get current balance snapshots for bunq accounts",
        inputSchema: GetAccountBalancesInputSchema,
        outputSchema: GetAccountBalancesOutputSchema,
        handler: async (input) => {
          const balances = await this.transactionService.getAccountBalances();
          return {
            balances: input.accountIds?.length
              ? balances.filter((row) => input.accountIds?.includes(row.accountId))
              : balances
          };
        }
      },
      {
        name: "sync_transactions",
        description: "Sync recent bunq transactions into local SQLite cache",
        inputSchema: SyncTransactionsInputSchema,
        outputSchema: SyncTransactionsOutputSchema,
        handler: async (input) => this.transactionService.syncTransactions(input)
      },
      {
        name: "list_transactions",
        description: "List cached transactions with optional filters; optionally sync first",
        inputSchema: ListTransactionsInputSchema,
        outputSchema: ListTransactionsOutputSchema,
        handler: async (input) => {
          if (input.syncBeforeRead) {
            await this.transactionService.syncTransactions({ accountIds: input.accountIds });
          }

          const userId = (await this.bunqClient.ensureContext()).userId;
          const transactions = this.transactionService.listCachedTransactions(
            {
              monetaryAccountIds: input.accountIds,
              fromDate: input.fromDate,
              toDate: input.toDate,
              query: input.query,
              limit: input.limit
            },
            userId
          );

          return { transactions };
        }
      },
      {
        name: "get_transaction_details",
        description: "Get transaction detail by account and payment id (cache-first, bunq fallback)",
        inputSchema: GetTransactionDetailsInputSchema,
        outputSchema: GetTransactionDetailsOutputSchema,
        handler: async (input) => {
          const userId = (await this.bunqClient.ensureContext()).userId;
          const transaction = await this.transactionService.getTransactionDetails(
            input.monetaryAccountId,
            input.paymentId,
            userId
          );

          return { transaction };
        }
      },
      {
        name: "search_transactions",
        description: "Search local transaction cache by text and optional date/account filters",
        inputSchema: SearchTransactionsInputSchema,
        outputSchema: SearchTransactionsOutputSchema,
        handler: async (input) => {
          const userId = (await this.bunqClient.ensureContext()).userId;
          const transactions = this.transactionService.listCachedTransactions(
            {
              monetaryAccountIds: input.accountIds,
              fromDate: input.fromDate,
              toDate: input.toDate,
              query: input.query,
              limit: input.limit
            },
            userId
          );

          return { transactions };
        }
      },
      {
        name: "list_counterparties",
        description: "List distinct counterparties inferred from cached bunq transactions",
        inputSchema: ListCounterpartiesInputSchema,
        outputSchema: ListCounterpartiesOutputSchema,
        handler: async (input) => {
          const userId = (await this.bunqClient.ensureContext()).userId;
          const counterparties = this.transactionService.listCounterparties(userId).slice(0, input.limit);
          return { counterparties };
        }
      },
      {
        name: "monthly_cashflow_summary",
        description: "Generate monthly income/expense/net cashflow summary",
        inputSchema: MonthlyCashflowSummaryInputSchema,
        outputSchema: MonthlyCashflowSummaryOutputSchema,
        handler: async (input) => {
          const userId = (await this.bunqClient.ensureContext()).userId;
          return this.reportingService.monthlyCashflowSummary({
            month: input.month,
            currency: input.currency,
            monetaryAccountIds: input.accountIds,
            userId
          });
        }
      },
      {
        name: "monthly_budget_report",
        description:
          "Generate month-to-date vs plan budget report with rolling 3-month baseline and anomaly flags",
        inputSchema: MonthlyBudgetReportInputSchema,
        outputSchema: MonthlyBudgetReportOutputSchema,
        handler: async (input) => {
          const userId = (await this.bunqClient.ensureContext()).userId;
          return this.reportingService.monthlyBudgetReport({
            month: input.month,
            plan: input.plan,
            rules: input.rules,
            monetaryAccountIds: input.accountIds,
            userId
          });
        }
      },
      {
        name: "reconcile_invoices_against_transactions",
        description:
          "Reconcile invoices from JSON/CSV/SQLite against cached bunq transactions with deterministic confidence scoring",
        inputSchema: ReconcileInvoicesInputSchema,
        outputSchema: ReconcileInvoicesOutputSchema,
        handler: async (input) => {
          const userId = (await this.bunqClient.ensureContext()).userId;
          return this.reconciliationService.reconcile({
            invoiceSource: input.invoiceSource,
            monetaryAccountIds: input.accountIds,
            fromDate: input.fromDate,
            toDate: input.toDate,
            dateWindowDays: input.dateWindowDays,
            amountTolerance: input.amountTolerance,
            matchThreshold: input.matchThreshold,
            userId
          });
        }
      },
      {
        name: "find_unmatched_incoming_payments",
        description: "Return incoming payments that remained unmatched in a reconciliation report",
        inputSchema: FindUnmatchedIncomingPaymentsInputSchema,
        outputSchema: FindUnmatchedIncomingPaymentsOutputSchema,
        handler: async (input) => ({
          unmatchedIncomingPayments: this.reconciliationService.findUnmatchedIncomingPayments(
            input.reconciliationReport as ReconciliationReport
          )
        })
      },
      {
        name: "find_unpaid_invoices",
        description: "Return unpaid invoices based on a reconciliation report",
        inputSchema: FindUnpaidInvoicesInputSchema,
        outputSchema: FindUnpaidInvoicesOutputSchema,
        handler: async (input) => ({
          unpaidInvoices: this.reconciliationService.findUnpaidInvoices(input.reconciliationReport as ReconciliationReport)
        })
      },
      {
        name: "export_reconciliation_report",
        description: "Export reconciliation results to JSON or CSV",
        inputSchema: ExportReconciliationReportInputSchema,
        outputSchema: ExportReconciliationReportOutputSchema,
        handler: async (input) =>
          this.reconciliationService.exportReport(input.reconciliationReport, input.format, input.outputPath)
      },
      {
        name: "simulate_webhook_event",
        description: "Process a simulated webhook payload for local testing",
        inputSchema: SimulateWebhookEventInputSchema,
        outputSchema: SimulateWebhookEventOutputSchema,
        handler: async (input) => {
          const status = await this.webhookServer.processWebhookPayload(input.payload);
          return { status };
        }
      }
    ];

    if (this.config.ENABLE_PAYMENTS) {
      tools.push({
        name: "create_draft_payment",
        description:
          "Feature-flagged placeholder draft payment tool. Requires explicit confirmation phrase and logs all intents.",
        inputSchema: DraftPaymentInputSchema,
        outputSchema: DraftPaymentOutputSchema,
        handler: async (input) => {
          if (!this.config.ENABLE_DRAFT_PAYMENTS) {
            throw new FeatureDisabledError("ENABLE_DRAFT_PAYMENTS");
          }

          if (input.confirmationPhrase !== "I CONFIRM DRAFT PAYMENT") {
            throw new Error("Invalid confirmationPhrase. Expected exact phrase: I CONFIRM DRAFT PAYMENT");
          }

          this.store.logPaymentIntent("draft_payment_requested", {
            at: new Date().toISOString(),
            reason: input.reason,
            monetaryAccountId: input.monetaryAccountId,
            amount: input.amount,
            currency: input.currency,
            counterpartyIban: input.counterpartyIban,
            counterpartyName: input.counterpartyName,
            description: input.description
          });

          return {
            status: "draft_payment_not_implemented",
            logged: true
          };
        }
      });
    }

    return tools;
  }
}
