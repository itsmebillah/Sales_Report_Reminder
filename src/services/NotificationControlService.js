/**
 * @fileoverview NotificationControlService.js
 * @responsibility Google Apps Script control plane for the Node.js Notification Sender.
 *
 * ARCHITECTURE RULE:
 *   This service NEVER sends WhatsApp messages.
 *   It ONLY reads/writes Dashboard-backed configuration and Message_Queue.
 *   The Node.js worker monitors the same Dashboard configuration repository.
 */

const NotificationControlService = (() => {

    // Dashboard configuration schema is centralized in ConfigurationService.

    const DEFAULT_SETTINGS = [
        { key: 'AUTO_SHUTDOWN_ENABLED', value: 'FALSE', description: 'Enable/disable auto PC shutdown after reminders' },
        { key: 'AUTO_SHUTDOWN_DELAY_MINUTES', value: '12', description: 'Delay in minutes before shutdown after final message' },
        { key: 'AUTO_SHUTDOWN_RUN_ACTIVE', value: 'FALSE', description: 'TRUE only while a scheduled reminder run is generating or sending' },
        { key: 'AUTO_SHUTDOWN_RUN_ID', value: '', description: 'Unique ID of the shutdown-eligible scheduled reminder run' },
        { key: 'AUTO_SHUTDOWN_RUN_PHASE', value: 'IDLE', description: 'Persistent auto-shutdown controller phase' },
        { key: 'AUTO_SHUTDOWN_RUN_QUEUE_IDS', value: '[]', description: 'Exact queue IDs belonging to the scheduled reminder run' },
        { key: 'AUTO_SHUTDOWN_LAST_QUEUE_ID', value: '', description: 'Final queue ID of the scheduled reminder run' },
        { key: 'AUTO_SHUTDOWN_FINAL_CHECK_AT', value: '', description: 'Time the final queue message was resolved' },
        { key: 'AUTO_SHUTDOWN_PENDING_UNTIL', value: '', description: 'Cancellable shutdown countdown target timestamp' },
        { key: 'AUTO_SHUTDOWN_RETRY_USED', value: 'FALSE', description: 'Whether the final-message shutdown retry was used' },
        { key: 'AUTO_SHUTDOWN_CANCEL_REASON', value: '', description: 'Most recent auto-shutdown cancellation reason' },
        { key: 'SYSTEM_STATUS',         value: 'STOP',        description: 'Worker control gate: RUNNING or STOP' },
        { key: 'WHATSAPP_ENABLED',      value: 'TRUE',        description: 'Enable WhatsApp sending' },
        { key: 'POLL_INTERVAL',         value: '10',          description: 'Seconds between polling cycles' },
        { key: 'QUEUE_BATCH_SIZE',      value: '1',           description: 'Queue records processed per cycle' },
        { key: 'MAX_RETRY',             value: '3',           description: 'Max retry attempts before FAILED' },
        { key: 'SENDER_MODE',           value: 'PRODUCTION',  description: 'TEST or PRODUCTION' },
        // ── Runtime status fields (written by Node.js worker) ──
        { key: 'Sender_Status',         value: '',            description: 'Written by worker: Starting/Running/Waiting/Stopped/Error' },
        { key: 'Last_Run_Time',         value: '',            description: 'Written by worker: last polling cycle timestamp' },
        { key: 'Last_Message_Time',     value: '',            description: 'Written by worker: timestamp of last sent message' },
        { key: 'Messages_Sent_Today',   value: '0',           description: 'Written by worker: daily sent counter' },
        { key: 'Messages_Failed_Today', value: '0',           description: 'Written by worker: daily failure counter' },
    ];

    // ─── Private helpers ──────────────────────────────────────────────────────

    const _getQueueSheet = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getSheetByName('Message_Queue');
        if (!sheet) throw new Error('Message_Queue sheet not found. Run Setup first.');
        return sheet;
    };

    /**
     * Upserts one Dashboard-backed configuration value.
     * Inserts a new row if the key does not exist.
     * @param {string} key
     * @param {string|number} value
     * @param {string} [description]
     */
    const updateSetting = (key, value, description) => {
        ConfigurationService.updateSetting(key, value);
    };

    /**
     * Upserts multiple Dashboard-backed configuration values.
     * Existing descriptions are preserved; new keys receive a blank description.
     */
    const updateSettings = (settingsMap) => {
        ConfigurationService.updateSettings(settingsMap);
    };

    /**
     * Reads a single setting value by key.
     * @param {string} key
     * @returns {string}
     */
    const getSetting = (key) => {
        const value = ConfigurationService.getSetting(key);
        return value === undefined || value === null ? '' : String(value);
    };

    /**
     * Returns the queue IDs currently present in Message_Queue, in generation order.
     */
    const getQueueIds = () => {
        const sheet = _getQueueSheet();
        const data = sheet.getDataRange().getValues();
        if (data.length <= 1) return [];

        const queueIdCol = data[0].indexOf('Queue_ID');
        if (queueIdCol === -1) throw new Error('Message_Queue is missing the Queue_ID column.');

        return data.slice(1)
            .map(row => String(row[queueIdCol] || '').trim())
            .filter(Boolean);
    };

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Ensures all required Dashboard configuration keys exist with defaults.
     * Only writes rows that are completely missing — never overwrites existing values.
     * @returns {number} Number of new rows added.
     */
    const ensureDefaultSettings = () => {
        return ConfigurationService.ensureDefaults();
    };

    /**
     * Starts the Notification Sender.
     * Sets SYSTEM_STATUS = RUNNING. The Node.js worker detects this on its next poll.
     */
    const startSender = () => {
        ensureDefaultSettings();
        updateSetting('SYSTEM_STATUS', 'RUNNING', 'Worker control gate: RUNNING or STOP');
        Logger.log('[NotificationControlService] SYSTEM_STATUS → RUNNING');
    };

    /**
     * Stops the Notification Sender.
     * Sets SYSTEM_STATUS = STOP. The Node.js worker enters sleep mode on its next poll.
     */
    const stopSender = () => {
        updateSetting('SYSTEM_STATUS', 'STOP', 'Worker control gate: RUNNING or STOP');
        Logger.log('[NotificationControlService] SYSTEM_STATUS → STOP');
    };

    /**
     * Resets all FAILED rows in Message_Queue to RETRY.
     * @returns {number} Number of rows reset.
     */
    const retryFailed = () => {
        const sheet = _getQueueSheet();
        const data = sheet.getDataRange().getValues();
        if (data.length <= 1) return 0;

        const headers = data[0];
        const statusCol = headers.indexOf('Status');
        if (statusCol === -1) throw new Error('Message_Queue is missing the Status column.');

        let count = 0;
        for (let i = 1; i < data.length; i++) {
            const status = String(data[i][statusCol] || '').trim().toUpperCase();
            if (status === 'FAILED') {
                sheet.getRange(i + 1, statusCol + 1).setValue('RETRY');
                count++;
            }
        }
        Logger.log('[NotificationControlService] Reset ' + count + ' FAILED rows → RETRY.');
        return count;
    };

    /**
     * Deletes all SENT rows from Message_Queue (iterates bottom-up).
     * @returns {number} Number of rows deleted.
     */
    const clearSent = () => {
        const sheet = _getQueueSheet();
        const data = sheet.getDataRange().getValues();
        if (data.length <= 1) return 0;

        const headers = data[0];
        const statusCol = headers.indexOf('Status');
        if (statusCol === -1) throw new Error('Message_Queue is missing the Status column.');

        let count = 0;
        for (let i = data.length - 1; i >= 1; i--) {
            const status = String(data[i][statusCol] || '').trim().toUpperCase();
            if (status === 'SENT') {
                sheet.deleteRow(i + 1);
                count++;
            }
        }
        Logger.log('[NotificationControlService] Deleted ' + count + ' SENT rows.');
        return count;
    };

    /**
     * Counts Message_Queue rows grouped by Status.
     * @returns {{ pending, processing, sent, retry, failed, total }}
     */
    const getQueueCounts = () => {
        let sheet;
        try { sheet = _getQueueSheet(); } catch (e) {
            return { pending: 0, processing: 0, sent: 0, retry: 0, failed: 0, total: 0 };
        }
        const data = sheet.getDataRange().getValues();
        if (data.length <= 1) return { pending: 0, processing: 0, sent: 0, retry: 0, failed: 0, total: 0 };

        const headers = data[0];
        const statusCol = headers.indexOf('Status');
        if (statusCol === -1) return { pending: 0, processing: 0, sent: 0, retry: 0, failed: 0, total: 0 };

        const counts = { pending: 0, processing: 0, sent: 0, retry: 0, failed: 0 };
        for (let i = 1; i < data.length; i++) {
            const s = String(data[i][statusCol] || '').trim().toUpperCase();
            if      (s === 'PENDING')    counts.pending++;
            else if (s === 'PROCESSING') counts.processing++;
            else if (s === 'SENT')       counts.sent++;
            else if (s === 'RETRY')      counts.retry++;
            else if (s === 'FAILED')     counts.failed++;
        }
        counts.total = data.length - 1;
        return counts;
    };

    /**
     * Assembles all live status data for the Sender Status dialog.
     */
    const getStatusSummary = () => {
        const systemStatus    = getSetting('SYSTEM_STATUS') || 'STOP';
        const senderStatus    = getSetting('Sender_Status') || '—';
        const lastRunTime     = getSetting('Last_Run_Time') || '—';
        const lastMessageTime = getSetting('Last_Message_Time') || '—';
        const sentToday       = getSetting('Messages_Sent_Today') || '0';
        const failedToday     = getSetting('Messages_Failed_Today') || '0';
        const senderMode      = getSetting('SENDER_MODE') || 'PRODUCTION';
        const pollInterval    = getSetting('POLL_INTERVAL') || '10';
        const queueCounts     = getQueueCounts();

        return {
            systemStatus, senderStatus, lastRunTime, lastMessageTime,
            sentToday, failedToday, senderMode, pollInterval, queueCounts
        };
    };

    return {
        ensureDefaultSettings,
        updateSetting,
        updateSettings,
        getSetting,
        getQueueIds,
        startSender,
        stopSender,
        retryFailed,
        clearSent,
        getQueueCounts,
        getStatusSummary
    };

})();
