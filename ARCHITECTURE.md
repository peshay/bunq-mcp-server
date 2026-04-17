# Architecture Notes

## Scope
This server is intentionally narrow and defaults to read-only operations for bunq Business backoffice workflows:
- account visibility
- transaction syncing and search
- reconciliation against local invoice data
- budgeting and cashflow summaries
- webhook-driven cache refresh

Outgoing payment execution is disabled by default and no write/payment tool is exposed unless explicitly feature-flagged.

## Components
- `src/bunq/client.ts`
  - direct bunq API integration (no third-party bunq SDK)
  - installation/device/session bootstrap via API key
  - request signing for signed endpoints
  - normalized account/payment mapping
- `src/db/database.ts`
  - SQLite persistence (`node:sqlite`)
  - bunq context, transaction cache, webhook idempotency log, reconciliation report history, payment-intent audit log
- `src/services/transaction-service.ts`
  - account retrieval, transaction sync, cache queries, transaction details
- `src/services/reconciliation-service.ts`
  - invoice loading (JSON/CSV/SQLite)
  - deterministic matching engine execution
  - report export (JSON/CSV)
- `src/reconciliation/engine.ts`
  - deterministic scoring by amount, IBAN, name, date window, reference/invoice number
  - confidence breakdown and explanations
  - optional unpaid/unmatched extraction
- `src/budget/reporting.ts`
  - configurable category rules
  - month-to-date vs plan
  - rolling 3-month baseline
  - unusual expense and revenue-drop flags
- `src/webhook/server.ts`
  - minimal HTTP callback receiver
  - idempotent replay-safe processing (`event_key` uniqueness)
  - incremental transaction cache updates
- `src/mcp/server.ts`
  - stdio MCP server
  - strict Zod validation for each tool input and output
  - payment tool visibility controlled by flags

## Data Flow
1. MCP tool call arrives over stdio.
2. Input is validated with Zod.
3. Service layer either:
   - reads from cache,
   - syncs from bunq API, or
   - runs reconciliation/report logic.
4. Output is validated with Zod before being returned.
5. For webhook events, incoming payload is deduplicated, processed, and local cache is updated incrementally.

## Safety Model
- `ENABLE_PAYMENTS=false` by default.
- No hidden write actions: write operations are explicit (`sync_transactions`, report export, webhook cache updates).
- Draft payment path is behind `ENABLE_PAYMENTS=true` and `ENABLE_DRAFT_PAYMENTS=true` and still only logs intent.
- Draft path requires exact confirmation phrase: `I CONFIRM DRAFT PAYMENT`.
- Payment intent actions are audit-logged.

## Auth Model
Current primary mode:
- API key bootstrap flow (`installation -> device-server -> session-server`)
- local persisted context (SQLite + context JSON file)

Prepared for future OAuth:
- auth/session logic isolated in `src/bunq/client.ts`
- service/tool layers depend on normalized client methods rather than auth specifics

## Deterministic vs LLM
Matching is deterministic and isolated from any LLM use.
LLM summarization can be layered on top later without changing matching outcomes.
