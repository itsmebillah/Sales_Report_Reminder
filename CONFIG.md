# Configuration Guide

⚡ **Architect:** Md. Masum Billah • [Website](https://itsmebillah.github.io/)

All runtime settings are managed centrally in Google Sheets on the **`Dashboard`** tab (Columns `C:E`), eliminating hardcoded values.

---

## 1. Dashboard Configuration Parameters (Columns C:E)

| Setting Key | Default | Description |
|---|---|---|
| **`SYSTEM_STATUS`** | `WAITING` | Master switch for the Node.js background worker (`RUNNING`, `WAITING`, `STOP`). |
| **`WHATSAPP_ENABLED`** | `TRUE` | Global toggle enabling/disabling live WhatsApp message dispatch. |
| **`Scheduler_Time`** | `09:00` | Daily scheduled time (HH:mm in `Asia/Dhaka`) for daily workflow execution. |
| **`AUTO_SHUTDOWN_ENABLED`** | `TRUE` | If `TRUE`, starts 12-minute countdown to shut down PC after queue completion. |
| **`AUTO_SHUTDOWN_MINUTES`** | `12` | Duration in minutes for the post-queue auto-shutdown safety timer. |
| **`TEST_MODE`** | `FALSE` | When `TRUE`, all outgoing messages are redirected to `OVERRIDE_PHONE`. |
| **`OVERRIDE_PHONE`** | `8801...` | Recipient phone number used when `TEST_MODE=TRUE`. |
| **`Dry_Run`** | `FALSE` | Simulates sending without actual WhatsApp Web API transmission. |
| **`REMINDER_RETENTION_DAYS`** | `30` | Number of days before completed `Message_Queue` rows are archived/purged. |
| **`SEND_DELAY_SECONDS`** | `5` | Throttle interval between consecutive message dispatches to prevent rate-limiting. |
| **`Timezone`** | `Asia/Dhaka` | Canonical timezone used for all dates and deadlines. |

---

## 2. Environment Variables (`.env`)

Used strictly by the local `notification-sender` Node.js daemon:

| Variable | Description |
|---|---|
| `SPREADSHEET_ID` | The Google Sheets Spreadsheet ID extracted from the URL. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Relative or absolute path to the Service Account JSON key. |
| `CHROMIUM_EXECUTABLE_PATH` | (Optional) Path to local Brave or Chrome executable for Puppeteer. |
| `NODE_ENV` | Environment mode (`production` / `development`). |
