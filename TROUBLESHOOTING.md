# Troubleshooting & Maintenance Guide

⚡ **Architect:** Md. Masum Billah • [Website](https://itsmebillah.github.io/)

This reference documents common operational issues, diagnostics, and steps to resolve them.

---

## 1. PM2 Background Daemon Diagnostics

### Check Worker Status
```bash
npx pm2 status
```
If the status is `errored` or `stopped`:
```bash
npx pm2 restart notification-sender
```

### View Live Error Logs
```bash
npx pm2 logs notification-sender --lines 50
```

---

## 2. Common Issues & Resolutions

### Issue A: `Data passed to getter must include an id property`
- **Root Cause:** Injected WhatsApp Web script spread `mediaOptions.toJSON()` after `id: newMsgKey`, clobbering `message.id`.
- **Solution:** Patched in `notification-sender/node_modules/whatsapp-web.js/src/util/Injected/Utils.js` by explicitly setting `message.id = newMsgKey;`.

### Issue B: `Exception: You must select all cells in a merged range to merge or unmerge them`
- **Root Cause:** Attempting to `merge()` or `breakApart()` a single cell or improper sub-range inside an already merged multi-cell block.
- **Solution:** All cell updates in `SheetService.js`, `DashboardService.js`, and `BroadcastService.js` use `safeMerge()` with pre-unmerge boundary checks.

### Issue C: `Media file not found on disk or invalid URL`
- **Root Cause:** File path enclosed in Windows quotation marks (e.g. `"C:\path\to\file.xlsx"`).
- **Solution:** Input sanitation strips leading/trailing standard and curly quotes (`"`, `'`, `“`, `”`) automatically across `WhatsAppWebProvider.js` and `BroadcastService.js`.

### Issue D: `Session Lock / SingletonLock Error` on Startup
- **Root Cause:** Stale Chromium/Brave headless process holding a Windows file lock on `.session/SingletonLock`.
- **Solution:** `cleanStaleSessionLocks()` automatically detects and terminates orphan browser instances holding locks on the session folder before startup.

### Issue E: Google Sheets API Rate Limiting / 429 Quota
- **Root Cause:** Rapid polling during network interruptions.
- **Solution:** Continuous worker implements exponential backoff (10s ➔ 15s ➔ 22.5s ➔ max 60s) on consecutive cycle failures to protect API quotas.

---

## 3. Automated Test Verification

To run the automated test suite and ensure all components are healthy:
```bash
cd notification-sender
npm test
```
*Current test suite: 44/44 tests passing.*
