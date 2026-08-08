# Configuration Guide

## Script Properties
To run this project, the following Script Properties must be defined in the Google Apps Script Project Settings:

| Key | Description | Example |
|---|---|---|
| `ENVIRONMENT` | Deployment environment (`DEV`, `STAGING`, `PROD`) | `STAGING` |
| `ADMIN_EMAIL` | Receives administrative alerts and error logs | `admin@example.com` |
| `REMINDER_TIME_LIMIT_DAYS` | Threshold in days before a reminder triggers | `3` |

## Spreadsheet Architecture
The target Google Sheet must contain the following named sheets (tabs) for standard operation (to be built):
1. **Leads**: Contains active opportunities.
2. **Reminders**: Event log and upcoming triggers.
3. **Config**: (Optional) For user-facing dynamic settings.
