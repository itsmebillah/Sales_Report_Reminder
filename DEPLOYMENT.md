# Deployment & Setup Guide

⚡ **Architect:** Md. Masum Billah • [Website](https://itsmebillah.github.io/)

This guide provides end-to-end instructions for deploying, configuring, and maintaining the **Sales Report Reminder & Broadcast Automation System**.

---

## 1. Prerequisites

- **Node.js**: Version 18.x or 20.x LTS installed.
- **Google Account**: Access to the target Google Spreadsheet and Google Cloud Console.
- **Chromium / Brave Browser**: For headless/headful WhatsApp Web automation.
- **PM2 Process Manager**: For persistent 24/7 background worker execution on Windows/Linux.

---

## 2. Google Apps Script Deployment

### 2.1 Clone & Authenticate Clasp
```bash
npm install -g @google/clasp
clasp login
```

### 2.2 Configure `.clasp.json`
Verify `.clasp.json` in the root directory contains the active Script ID:
```json
{
  "scriptId": "YOUR_APPS_SCRIPT_ID",
  "rootDir": "."
}
```

### 2.3 Push Code to Apps Script
```bash
clasp push
```

---

## 3. Node.js Notification Sender Setup

Navigate to the `notification-sender` directory:
```bash
cd notification-sender
npm install
```

### 3.1 Google Service Account Configuration
1. Create a Service Account in **Google Cloud Console** with the **Google Sheets API** enabled.
2. Generate a JSON Key file and place it inside `notification-sender/` (e.g. `sales-reminder-credentials.json`).
3. Share your Google Spreadsheet with the Service Account email as an **Editor**.

### 3.2 Environment Variables (`.env`)
Create `notification-sender/.env`:
```ini
SPREADSHEET_ID=1Gi1pbNBUM-16oLylCaovl_IkO8qXzsMadO_Jxtm526g
GOOGLE_APPLICATION_CREDENTIALS=./sales-reminder-credentials.json
CHROMIUM_EXECUTABLE_PATH=C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe
NODE_ENV=production
```

---

## 4. WhatsApp Web Authentication

1. Start the sender once in interactive mode to generate the QR code:
   ```bash
   node src/app.js
   ```
2. Scan the terminal QR code using WhatsApp on your phone (**Linked Devices** -> **Link a Device**).
3. Once authenticated, the session is saved permanently in `notification-sender/.session/`.
4. Press `Ctrl + C` to stop the interactive run.

---

## 5. Running as a Persistent PM2 Daemon

Install PM2 globally if not already present:
```bash
npm install -g pm2
```

Start and register the continuous worker service:
```bash
cd notification-sender
npx pm2 start src/app.js --name "notification-sender"
npx pm2 save
```

### Useful PM2 Commands:
- **View Status:** `npx pm2 status`
- **View Live Logs:** `npx pm2 logs notification-sender`
- **Restart Service:** `npx pm2 restart notification-sender`
- **Stop Service:** `npx pm2 stop notification-sender`
