# Project Roadmap & Delivery Status

⚡ **Architect:** Md. Masum Billah • [Website](https://itsmebillah.github.io/)

---

## ✅ Completed & Delivered Milestones

- [x] **Phase 1: Core Foundation & Modular Architecture**
  - IIFE-based Google Apps Script service encapsulation.
  - Dynamic Sales Data copy and dynamic range calculation.
  - Attendance synchronization and regional hierarchy mapping (`RSM_Map`).

- [x] **Phase 2: Message Queue & Atomic Dispatch**
  - 26-column unified schema for `Message_Queue`.
  - Atomic row locking (`PENDING` -> `PROCESSING` -> `SENT` / `RETRY` / `FAILED`).
  - Idempotency key protection preventing duplicate reminder creation.

- [x] **Phase 3: Decoupled Node.js Notification Sender**
  - Puppeteer-driven WhatsApp Web engine running under PM2 daemon.
  - Multi-provider architecture with placeholder interfaces for Telegram, Meta API, Email, and SMS.
  - WhatsApp server-side number validation (`getNumberId`) and ACK monitoring (`ACK >= 1`).

- [x] **Phase 4: Operational Dashboard & UI Modals**
  - Dynamic Dashboard layout with C:E runtime configuration.
  - Interactive HTML dialogs: `SchedulerTimePicker.html` and `AutoShutdownSettings.html`.
  - 12-minute post-queue automatic computer shutdown safety timer.

- [x] **Phase 5: Broadcast Module & Media Attachments**
  - `Broadcast_Dashboard` with recipient filtering and dynamic templating (`{{name}}`, `{{designation}}`, `{{id}}`).
  - Local file attachment support (Excel `.xlsx`, PDF, Images, Videos) via cell **`H19:P19`**.
  - Google Drive sharing link streaming and direct web URL download.
  - Injected script patch for WhatsApp Web memoization getter bug.

- [x] **Phase 6: Quality Assurance & Test Automation**
  - 44/44 automated unit and integration tests passing.
  - Google Sheets merged range error prevention (`safeMerge`).
  - Stale session lock cleaner on Windows (`cleanStaleSessionLocks`).

---

## 🔮 Future Enhancements

- [ ] Complete live Meta WhatsApp Cloud API provider integration as an alternative to WhatsApp Web.
- [ ] Add real-time WebSocket dashboard for live queue monitoring on mobile devices.
- [ ] Implement AI-assisted sales trend insights in daily RSM reminder summaries.
