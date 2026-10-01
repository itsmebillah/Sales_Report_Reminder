# System Architecture & Technical Specifications

⚡ **Architect:** Md. Masum Billah • [Website](https://itsmebillah.github.io/)

## 1. High-Level Architecture Overview

The system operates as a hybrid cloud-and-edge platform:
- **Cloud Layer:** Google Apps Script manages spreadsheet business logic, employee schedules, reminder drafting, attendance calculation, and idempotent queue insertion.
- **Edge Layer:** A decoupled Node.js continuous background worker running under PM2 on a local PC/server polls `Message_Queue`, connects to an authenticated WhatsApp Web session via Puppeteer, and dispatches messages with delivery ACK confirmations.

```mermaid
flowchart TD
    subgraph Google Cloud / Sheets
        A[Sales Sheet] --> D[Reminder Engine]
        B[Attendance Sheet] --> D
        C[RSM_Map] --> D
        D -->|Write Idempotent Records| E[(Message_Queue Tab)]
        F[Broadcast_Dashboard] -->|Queue Announcements & Files| E
        G[Dashboard C:E Config] -->|Controls Engine & Polling| E
    end

    subgraph Node.js Worker (PM2 Daemon)
        H[GoogleSheetService] -->|Atomic Claim: PENDING -> PROCESSING| E
        H --> I[NotificationDispatcher]
        I --> J[WhatsAppWebProvider]
        J -->|Puppeteer Headless| K[WhatsApp Web API]
        K -->|ACK >= 1 Confirmation| J
        J -->|Update Status: SENT / FAILED| H
        H -->|Queue Empty & Timer Reached| L[Auto-Shutdown Countdown: 12 min]
    end
```

---

## 2. Queue Lifecycle & State Machine

Every message in `Message_Queue` progresses through an auditable, atomic state lifecycle:

| Status | Description | Actionable By |
|---|---|---|
| **`PENDING`** | Message inserted by Reminder or Broadcast service, awaiting dispatch. | Node Worker |
| **`PROCESSING`** | Atomically claimed with unique worker lock (`Worker_ID` + timestamp). | Node Worker |
| **`SENT`** | WhatsApp server ACK >= 1 confirmed (`Message_ID` & timestamp recorded). | Terminal State |
| **`RETRY`** | Failed once; scheduled for automatic single retry. | Node Worker |
| **`FAILED`** | Exceeded maximum retry attempts or invalid recipient phone. | Terminal State |

---

## 3. Spreadsheet Schema Architecture

1. **`Dashboard`**: Operational KPI summary, execution cards, and runtime configuration in columns `C:E`.
2. **`Sales`**: Raw sales entries by date, TSO, distributor, and reporting metrics.
3. **`Attendance`**: Daily clock-in/clock-out records and leave tracking.
4. **`RSM_Map`**: Regional hierarchy mapping TSOs to RSMs.
5. **`Message_Queue`**: 26-column unified queue supporting reminders, summaries, and broadcasts.
6. **`Broadcast_Dashboard`**: UI for composing announcements, attaching files in `H19:P19`, and filtering recipients.
