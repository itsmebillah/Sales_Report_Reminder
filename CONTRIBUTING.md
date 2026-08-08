# Contributing

## Development workflow

1. Read `PROJECT.md`, `CONFIG.md`, and `ROADMAP.md`.
2. Work with synthetic spreadsheet records and test recipients.
3. Keep Apps Script entry points small and place business behavior in `src/services/`.
4. Run JavaScript syntax checks for every changed source file.
5. Verify queue generation and provider behavior in a non-production environment.
6. Update documentation when configuration, sheet columns, or operational behavior changes.

Never commit `.env`, Google service-account credentials, WhatsApp session files, access tokens, recipient data, or spreadsheet exports.
