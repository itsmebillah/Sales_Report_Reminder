# Project Architecture & Conventions

## Architecture
The system uses an IIFE-based Modular Architecture to provide encapsulation within the Google Apps Script global namespace constraints.

- **`src/main.js`**: Contains native GAS trigger functions (`onOpen`, `doGet`, `timeDriven`).
- **`src/services/`**: Encapsulates external integrations and core business orchestration (e.g., `SheetService`, `EmailService`).
- **`src/utils/`**: Shared stateless helpers (e.g., `DateUtils`, `Logger`).
- **`src/config/`**: System-wide constants and environment management.

## Coding Conventions
1. **Namespacing**: Services should be encapsulated as constants using the IIFE pattern to prevent global scope pollution where possible.
2. **JSDoc Arguments**: All functions and exposed methods must be documented via JSDoc for team readability.
3. **Separation of Concerns**: Business logic (`ReminderService`) should rely on `SheetService` to read/write data, rather than directly invoking `SpreadsheetApp`.
