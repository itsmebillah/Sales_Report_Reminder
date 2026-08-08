/**
 * @fileoverview CleanupService.js
 * @responsibility Handles automated data retention cleanup for 'Reminder_System' and 'Logs' sheets
 * based on configurable retention limits in the 'Settings' sheet.
 */

const CleanupService = (() => {

    /**
     * Executes retention cleanup safely without interrupting primary reminder workflows.
     * @returns {Object} Cleanup summary details.
     */
    const runCleanup = () => {
        try {
            const config = ConfigLoader.load();
            const reminderRetentionDays = parseInt(config['REMINDER_RETENTION_DAYS'], 10) || 30;
            const logRetentionDays = parseInt(config['LOG_RETENTION_DAYS'], 10) || 10;

            const now = new Date();
            const reminderCutoff = new Date(now.getTime() - (reminderRetentionDays * 24 * 60 * 60 * 1000));
            const logCutoff = new Date(now.getTime() - (logRetentionDays * 24 * 60 * 60 * 1000));

            // Reminder_System timestamp is in Column D (Index 3)
            const reminderPurged = purgeOldRecords('Reminder_System', 3, reminderCutoff);
            
            // Logs timestamp is in Column A (Index 0)
            const logPurged = purgeOldRecords('Logs', 0, logCutoff);

            return {
                success: true,
                timestamp: now,
                reminderPurged: reminderPurged,
                logPurged: logPurged,
                reminderRetentionDays: reminderRetentionDays,
                logRetentionDays: logRetentionDays
            };
        } catch (err) {
            console.log("CleanupService encountered an error: " + err);
            return {
                success: false,
                error: String(err),
                reminderPurged: 0,
                logPurged: 0
            };
        }
    };

    /**
     * Helper to purge rows older than the specified cutoff date while preserving headers.
     */
    const purgeOldRecords = (sheetName, timestampColIdx, cutoffDate) => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        if (!ss) return 0;
        const sheet = ss.getSheetByName(sheetName);
        if (!sheet) return 0;

        const data = sheet.getDataRange().getValues();
        if (data.length <= 1) return 0;

        const rowsToKeep = [data[0]]; // Preserve header row
        let purgedCount = 0;

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const rawVal = row[timestampColIdx];
            let rowDate = null;

            if (rawVal instanceof Date) {
                rowDate = rawVal;
            } else if (rawVal) {
                rowDate = new Date(rawVal);
            }

            if (rowDate && !isNaN(rowDate.getTime()) && rowDate < cutoffDate) {
                purgedCount++;
            } else {
                rowsToKeep.push(row);
            }
        }

        if (purgedCount > 0) {
            sheet.clearContents();
            sheet.getRange(1, 1, rowsToKeep.length, rowsToKeep[0].length).setValues(rowsToKeep);
            sheet.getRange(1, 1, 1, rowsToKeep[0].length).setFontWeight('bold');
        }
        return purgedCount;
    };

    return { runCleanup };
})();
