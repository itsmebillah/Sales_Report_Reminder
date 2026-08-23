/**
 * @fileoverview setup.js
 * @responsibility Creates necessary environment sheets if they do not exist
 * to support the overarching Reminder infrastructure.
 */

const EnvironmentSetup = (() => {

    const DAILY_WORKFLOW_HANDLERS = new Set([
        'processDailyReminders',
        'runScheduledDailyWorkflow'
    ]);

    const isDailyWorkflowClockTrigger = trigger =>
        trigger.getEventType() === ScriptApp.EventType.CLOCK &&
        DAILY_WORKFLOW_HANDLERS.has(trigger.getHandlerFunction());

    const getDailyTriggerStatus = () => {
        const config = ConfigLoader.load();
        const triggers = ScriptApp.getProjectTriggers().filter(isDailyWorkflowClockTrigger);
        const handlers = triggers.map(trigger => trigger.getHandlerFunction());
        return {
            configuredSchedulerTime: String(config['Scheduler_Time'] || '09:00'),
            timezone: String(config['Timezone'] || Session.getScriptTimeZone() || 'Asia/Dhaka'),
            dailyTriggerCount: triggers.length,
            runScheduledDailyWorkflowCount: handlers.filter(name => name === 'runScheduledDailyWorkflow').length,
            processDailyRemindersCount: handlers.filter(name => name === 'processDailyReminders').length,
            handlers
        };
    };

    const createSheetIfMissing = (ss, sheetName, headers = [], defaultSettings = []) => {
        let sheet = ss.getSheetByName(sheetName);
        if (!sheet) {
            sheet = ss.insertSheet(sheetName);
            if (headers.length > 0) {
                sheet.appendRow(headers);
                sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
            }
            if (defaultSettings.length > 0) {
                sheet.getRange(2, 1, defaultSettings.length, defaultSettings[0].length).setValues(defaultSettings);
            }
            sheet.autoResizeColumns(1, headers.length || 5);
        }
        return sheet;
    };

    const createOrClearSheet = (ss, sheetName, headers) => {
        let sheet = ss.getSheetByName(sheetName);
        if (!sheet) {
            sheet = ss.insertSheet(sheetName);
            sheet.appendRow(headers);
            sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
            sheet.autoResizeColumns(1, headers.length);
        } else {
            const lastRow = sheet.getLastRow();
            if (lastRow > 1) {
                sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
            }
            sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
        }
        return sheet;
    };

    /**
     * Installs the daily time-driven trigger configured from Dashboard.
     */
    const installTrigger = () => {
        const triggers = ScriptApp.getProjectTriggers();
        const existingDailyTriggers = triggers.filter(isDailyWorkflowClockTrigger);
        existingDailyTriggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));

        const config = ConfigLoader.load();
        const timeStr = String(config['Scheduler_Time'] || '09:00');
        const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
        const parsedHour = timeMatch ? parseInt(timeMatch[1], 10) : 9;
        const parsedMinute = timeMatch ? parseInt(timeMatch[2], 10) : 0;
        const hour = parsedHour >= 0 && parsedHour <= 23 ? parsedHour : 9;
        const minute = parsedMinute >= 0 && parsedMinute <= 59 ? parsedMinute : 0;
        const timezone = String(config['Timezone'] || Session.getScriptTimeZone() || 'Asia/Dhaka');

        ScriptApp.newTrigger('runScheduledDailyWorkflow')
            .timeBased()
            .atHour(hour)
            .nearMinute(minute)
            .everyDays(1)
            .inTimezone(timezone)
            .create();

        installAttendanceSyncTrigger();
        console.log(`[SCHEDULER] Installed one daily workflow trigger near ${timeStr} (${timezone})`);
        return getDailyTriggerStatus();
    };

    /**
     * Installs dedicated time-driven trigger for syncAttendance running every X minutes.
     * Prevents duplicate executions by checking if a trigger already exists.
     */
    const installAttendanceSyncTrigger = () => {
        try {
            const config = ConfigLoader.load();
            const enableSync = String(config['ENABLE_AUTO_ATTENDANCE_SYNC']).toUpperCase() === 'TRUE';
            const intervalMinutes = parseInt(config['ATTENDANCE_SYNC_INTERVAL_MINUTES'], 10) || 10;

            const triggers = ScriptApp.getProjectTriggers();
            let existingTrigger = null;

            for (let i = 0; i < triggers.length; i++) {
                const handler = triggers[i].getHandlerFunction();
                if (handler === 'syncAttendance' || handler === 'syncAttendanceNow') {
                    existingTrigger = triggers[i];
                    break;
                }
            }

            if (!enableSync) {
                if (existingTrigger) {
                    ScriptApp.deleteTrigger(existingTrigger);
                }
                return;
            }

            // If an existing trigger targeting syncAttendance or syncAttendanceNow exists, skip creation
            if (existingTrigger) {
                console.log("Attendance sync trigger already exists. Skipped duplicate creation.");
                return;
            }

            // Map interval to closest valid GAS minute timer (1, 5, 10, 15, 30)
            let validInterval = 10;
            if (intervalMinutes <= 1) validInterval = 1;
            else if (intervalMinutes <= 5) validInterval = 5;
            else if (intervalMinutes <= 10) validInterval = 10;
            else if (intervalMinutes <= 15) validInterval = 15;
            else validInterval = 30;

            ScriptApp.newTrigger('syncAttendance')
                .timeBased()
                .everyMinutes(validInterval)
                .create();
        } catch (e) {
            console.log("installAttendanceSyncTrigger error: " + e);
        }
    };

    /**
     * Ensures every known configuration key exists in Dashboard columns C:H.
     * Existing Dashboard values are never overwritten.
     */
    const syncSettings = () => {
        return ConfigurationService.ensureDefaults();
    };

    /**
     * Initializes Dashboard configuration and required operational sheets.
     */
    const init = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        if (!ss) return;

        // Ensure Dashboard-backed configuration is complete.
        syncSettings();

        // Create Logs Sheet
        const logHeaders = [
            'Timestamp', 'Dealer_ID', 'Dealer_Name', 'SR_ID',
            'SR_Name', 'TSO_ID', 'TSO_Name', 'RSM_ID',
            'RSM_Name', 'Sales_Date', 'Reminder_Level',
            'Recipient_Phone', 'WhatsApp_Status', 'Error_Message'
        ];
        let logSheet = ss.getSheetByName('Logs');
        if (!logSheet) {
            logSheet = createSheetIfMissing(ss, 'Logs', logHeaders);
        } else {
            // Refresh Header Row to ensure Recipient_Phone column exists
            logSheet.getRange(1, 1, 1, logHeaders.length).setValues([logHeaders]).setFontWeight('bold');
        }

        // Create Reminder_System Sheet
        const reminderHeaders = [
            'Dealer_ID', 'WhatsApp_Number', 'Status',
            'Timestamp', 'Error_Message', 'Target_Date',
            'Target_Level', 'SR_ID'
        ];
        createSheetIfMissing(ss, 'Reminder_System', reminderHeaders);

        // Phase 1 Sheets
        const pendingSRHeaders = [
            'Timestamp', 'Sales_Date', 'Dealer_ID', 'Dealer_Name', 'SR_ID',
            'SR_Name', 'TSO_ID', 'TSO_Name', 'RSM_ID', 'RSM_Name', 'Reason', 'Sales_Status'
        ];
        createOrClearSheet(ss, 'Pending_SR', pendingSRHeaders);

        const pendingTSOHeaders = [
            'Timestamp', 'Sales_Date', 'TSO_ID', 'TSO_Name', 'TSO_Phone',
            'RSM_ID', 'RSM_Name', 'Pending_SR_Count', 'Pending_SR_List'
        ];
        createOrClearSheet(ss, 'Pending_TSO', pendingTSOHeaders);

        const msgQueueHeaders = [
            'Queue_ID', 'Timestamp', 'Provider', 'Recipient_Name', 'Recipient_Phone',
            'Recipient_Type', 'TSO_ID', 'TSO_Name', 'Sales_Date', 'Pending_SR_Count',
            'Pending_SR_List', 'Message_Body', 'Status', 'Retry_Count', 'Created_At',
            'Sent_At', 'Error_Message', 'Message_ID', 'ACK', 'Processing_Started_At',
            'Worker_ID', 'Recovery_Time', 'Recovery_Reason', 'RSM_ID', 'RSM_Name',
            'Idempotency_Key'
        ];
        createOrClearSheet(ss, 'Message_Queue', msgQueueHeaders);

        // Auto-install schedule
        installTrigger();
    };

    return { init, installTrigger, installAttendanceSyncTrigger, syncSettings, getDailyTriggerStatus };
})();

/**
 * Entry point for users to manually trigger system setup from GAS bindings.
 */
function runEnvironmentSetup() {
    EnvironmentSetup.init();
}

/**
 * Compatibility entry point: ensures Dashboard configuration defaults.
 */
function runSettingsMigration() {
    return EnvironmentSetup.syncSettings();
}

/**
 * Copies every legacy Settings key/value into Dashboard C:E and verifies it.
 * The legacy tab intentionally remains until the Dashboard-backed Node worker
 * and Apps Script readers/writers have been verified in production.
 */
function migrateSettingsToDashboard() {
    return ConfigurationService.migrateFromLegacySettings(false);
}

/**
 * Final cutover step. Verifies legacy keys exist in the authoritative Dashboard,
 * then removes only the old tab without copying legacy values back.
 * Run only after the Dashboard-backed Apps Script and Node worker are live.
 */
function removeLegacySettingsAfterMigration() {
    return ConfigurationService.removeLegacySettingsAfterMigration();
}

/**
 * Reinstalls only the Scheduler_Time daily workflow trigger and returns the
 * resulting trigger count. It does not initialize or clear any sheets.
 */
function reinstallDailyWorkflowTrigger() {
    return EnvironmentSetup.installTrigger();
}

/** Returns the live reminder-workflow clock trigger counts without changing them. */
function getDailyWorkflowTriggerStatus() {
    return EnvironmentSetup.getDailyTriggerStatus();
}
