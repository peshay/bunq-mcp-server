# Contributing

Thanks for contributing.

## Requirements
- Node.js 22+
- npm 10+

## Development Setup
```bash
npm ci
cp .env.example .env
npm run check
npm test
npm run build
```

## Branch and Commit Guidelines
- Create a feature branch from `main`.
- Use Conventional Commits, e.g.:
  - `feat: add new reporting tool`
  - `fix: handle empty webhook payload`
  - `docs: update setup notes`

## Pull Request Checklist
- Keep changes focused and minimal.
- Add or update tests for behavior changes.
- Update docs when behavior/config changes.
- Ensure CI is green.

## Security and Secrets
- Never commit real bunq credentials.
- Use `.env` locally, keep secrets out of logs/issues.
- For vulnerabilities, follow `SECURITY.md`.

## Review Policy
- All PRs require human review before merge.
- AI-assisted changes are welcome, but maintainers are responsible for final correctness.
