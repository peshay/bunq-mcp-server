# bunq Business MCP Server

> Read-first MCP integration for bunq with conservative safety boundaries for business backoffice workflows.

[![CI](https://github.com/peshay/bunq-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/peshay/bunq-mcp-server/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/peshay/bunq-mcp-server)](LICENSE)

[![Support via bunq](https://img.shields.io/badge/Support-bunq-00A1E0?style=flat-square&logo=bunq&logoColor=white)](https://bunq.me/ahu)

Production-lean MCP server for a self-hosted bunq Business backoffice workflow.

It is focused on:
- account visibility
- transaction syncing/search
- invoice reconciliation
- budgeting and cashflow reporting
- webhook-driven cache updates

It uses the official bunq API directly and defaults to read-only behavior.

## Safety Defaults
- `ENABLE_PAYMENTS=false` by default
- no outgoing payment tool exposed unless explicitly enabled
- draft-payment path is feature-flagged and only logs intent
- no hidden write actions

## Stack
- TypeScript
- Node.js 22+ (uses `node:sqlite`)
- `@modelcontextprotocol/sdk` (stdio MCP server)
- Zod schemas for every tool input/output
- Dockerized runtime

## Project Layout
- [src/index.ts](src/index.ts)
- [src/mcp/server.ts](src/mcp/server.ts)
- [src/bunq/client.ts](src/bunq/client.ts)
- [src/db/database.ts](src/db/database.ts)
- [src/reconciliation/engine.ts](src/reconciliation/engine.ts)
- [src/webhook/server.ts](src/webhook/server.ts)
- [ARCHITECTURE.md](ARCHITECTURE.md)

## Setup (Local)
1. Install dependencies:
```bash
npm ci
```
2. Create env file:
```bash
cp .env.example .env
```
3. Set your bunq API key and webhook secret in `.env`.
4. Build:
```bash
npm run build
```
5. Start:
```bash
npm start
```

For development:
```bash
npm run dev
```

## Docker
Build and run:
```bash
docker build -t bunq-mcp-server .
docker run --rm -it \
  --env-file .env \
  -v "$(pwd)/data:/app/data" \
  -p 8787:8787 \
  bunq-mcp-server
```

Or use compose example:
```bash
cp docker-compose.example.yml docker-compose.yml
docker compose up --build
```

## OpenClaw MCP Client Config
Example config:
- [examples/openclaw.mcp.json](examples/openclaw.mcp.json)

## Implemented MCP Tools (Phase 1)
- `list_accounts`
- `get_account_balances`
- `sync_transactions`
- `list_transactions`
- `get_transaction_details`
- `search_transactions`
- `list_counterparties`
- `monthly_cashflow_summary`
- `monthly_budget_report`
- `reconcile_invoices_against_transactions`
- `find_unmatched_incoming_payments`
- `find_unpaid_invoices`
- `export_reconciliation_report`
- `simulate_webhook_event`

Conditional payment tool:
- `create_draft_payment` (only if `ENABLE_PAYMENTS=true` and `ENABLE_DRAFT_PAYMENTS=true`)

## bunq Auth and Session Bootstrap
The server uses API-key bootstrap directly against bunq:
1. `POST /installation`
2. `POST /device-server`
3. `POST /session-server`

State is persisted in:
- SQLite (`SQLITE_PATH`)
- context JSON (`BUNQ_CONTEXT_PATH`)

Code is structured so OAuth can be added later in the auth/client layer.

## Webhook Receiver
When `WEBHOOK_ENABLED=true`, server listens on:
- `WEBHOOK_HOST:WEBHOOK_PORT`
- `WEBHOOK_PATH`

Behavior:
- validates optional `X-Webhook-Secret`
- computes idempotency key and deduplicates events
- stores webhook payload history
- updates transaction cache incrementally

## Reconciliation Rules
Invoice inputs supported:
- JSON
- CSV
- SQLite query

Deterministic matching signals:
- amount
- IBAN
- counterparty name similarity
- date window
- reference / invoice number in payment text

Each match returns:
- confidence score
- score breakdown
- textual explanation

Deterministic logic is isolated from any optional future LLM summarization.

## Tests
Run all tests:
```bash
npm test
```

Type-check:
```bash
npm run check
```

Build:
```bash
npm run build
```

Fixtures:
- [tests/fixtures/invoices.sample.json](tests/fixtures/invoices.sample.json)
- [tests/fixtures/invoices.sample.csv](tests/fixtures/invoices.sample.csv)
- [tests/fixtures/invoices.sample.sqlite](tests/fixtures/invoices.sample.sqlite)
- [tests/fixtures/webhook.sample.json](tests/fixtures/webhook.sample.json)

## Acceptance Coverage
Automated tests cover:
- account listing
- transaction sync flow
- sample invoice reconciliation
- monthly budget report generation
- webhook simulation handling
- no payment-execution tool exposure by default

## Notes
- This implementation is intentionally narrow and backoffice-oriented.
- For production, run behind firewall/reverse-proxy controls and restrict inbound webhook origin + secrets.

## Project Policy
- Official distribution is source-first: users build images locally from this repository.
- This project currently does not publish official Docker images to Docker Hub.
- CI runs on GitHub Actions for type-check, tests, and build on pushes/PRs.

## Governance
- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Repository AI-agent guide: [AGENTS.md](AGENTS.md)
- License: [LICENSE](LICENSE)

## Support

Voluntary support helps fund ongoing freelance maintenance of this project. Support payments are appreciated but do not automatically create an entitlement to support, feature delivery, consulting, SLA, or invoice-based engagement.

## AI Assistance
- This repository may include AI-assisted code.
- Every change must still pass human review before merge.
