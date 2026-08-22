/**
 * @fileoverview NotificationControlService.js
 * @responsibility Google Apps Script control plane for the Node.js Notification Sender.
 *
 * ARCHITECTURE RULE:
 *   This service NEVER sends WhatsApp messages.
 *   It ONLY reads/writes to the Settings tab and Message_Queue tab.
 *   The Node.js worker monitors Settings and acts accordingly.
 */

const NotificationControlService = (() => {

    // ─── Settings schema with defaults ───────────────────────────────────────

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

    const _getSettingsSheet = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let sheet = ss.getSheetByName('Settings');
        if (!sheet) {
            sheet = ss.insertSheet('Settings');
            sheet.getRange('A1:C1').setValues([['Key', 'Value', 'Description']]);
            sheet.getRange('A1:C1').setFontWeight('bold');
        }
        return sheet;
    };

    const _getQueueSheet = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getSheetByName('Message_Queue');
        if (!sheet) throw new Error('Message_Queue sheet not found. Run Setup first.');
        return sheet;
    };

    /**
     * Reads all Settings rows into a map of { key -> { value, row } }.
     */
    const _readSettingsMap = () => {
        const sheet = _getSettingsSheet();
        const data = sheet.getDataRange().getValues();
        const map = {};
        for (let i = 1; i < data.length; i++) {
            const key = String(data[i][0] || '').trim();
            if (key) {
                map[key] = { value: data[i][1], row: i + 1 };
            }
        }
        return { map, sheet };
    };

    /**
     * Upserts a single key-value pair in the Settings tab.
     * Inserts a new row if the key does not exist.
     * @param {string} key
     * @param {string|number} value
     * @param {string} [description]
     */
    const updateSetting = (key, value, description) => {
        const { map, sheet } = _readSettingsMap();
        if (map[key]) {
            sheet.getRange(map[key].row, 2).setValue(value);
        } else {
            const lastRow = sheet.getLastRow();
            sheet.getRange(lastRow + 1, 1, 1, 3).setValues([[key, value, description || '']]);
        }
    };

    /**
     * Upserts multiple Settings values after a single sheet read.
     * Existing descriptions are preserved; new keys receive a blank description.
     */
    const updateSettings = (settingsMap) => {
        const { map, sheet } = _readSettingsMap();
        const newRows = [];

        Object.keys(settingsMap).forEach(key => {
            const value = settingsMap[key];
            if (map[key]) {
                sheet.getRange(map[key].row, 2).setValue(value);
            } else {
                newRows.push([key, value, '']);
            }
        });

        if (newRows.length > 0) {
            sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 3).setValues(newRows);
        }
    };

    /**
     * Reads a single setting value by key.
     * @param {string} key
     * @returns {string}
     */
    const getSetting = (key) => {
        const { map } = _readSettingsMap();
        return map[key] ? String(map[key].value || '') : '';
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
     * Ensures all required Settings keys exist with defaults.
     * Only writes rows that are completely missing — never overwrites existing values.
     * @returns {number} Number of new rows added.
     */
    const ensureDefaultSettings = () => {
        const { map, sheet } = _readSettingsMap();
        let added = 0;
        for (const setting of DEFAULT_SETTINGS) {
            if (map[setting.key] === undefined) {
                const lastRow = sheet.getLastRow();
                sheet.getRange(lastRow + 1, 1, 1, 3)
                    .setValues([[setting.key, setting.value, setting.description]]);
                added++;
            }
        }
        return added;
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
