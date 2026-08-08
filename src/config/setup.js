/**
 * @fileoverview setup.js
 * @responsibility Creates necessary environment sheets if they do not exist
 * to support the overarching Reminder infrastructure.
 */

const EnvironmentSetup = (() => {

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
     * Installs daily time-driven trigger configured by the Settings sheet.
     */
    const installTrigger = () => {
        const triggers = ScriptApp.getProjectTriggers();
        triggers.forEach(t => ScriptApp.deleteTrigger(t));

        const config = ConfigLoader.load();
        const timeStr = String(config['Scheduler_Time'] || '09:00');
        let hour = parseInt(timeStr.split(':')[0], 10) || 9;

        ScriptApp.newTrigger('processDailyReminders')
            .timeBased()
            .atHour(hour)
            .everyDays(1)
            .create();

        installAttendanceSyncTrigger();
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
     * Safely migrates existing 'Settings' sheet by appending any missing configuration keys
     * without modifying or overwriting any existing key-value pairs.
     */
    const syncSettings = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        if (!ss) return 0;

        const defaultSettings = [
            ['Reporting_Days', 3],
            ['Reminder_Days_Before_Lock', 0],
            ['Timezone', 'Asia/Dhaka'],
            ['Scheduler_Time', '09:00'],
            ['WhatsApp_Enabled', true],
            ['Dry_Run', true],
            ['PHONE_NUMBER_ID', ''],
            ['ACCESS_TOKEN', ''],
            ['META_API_VERSION', 'v25.0'],
            ['TEMPLATE_NAME', ''],
            ['TEMPLATE_LANGUAGE', 'en_US'],
            ['TEST_MODE', false],
            ['OVERRIDE_PHONE', ''],
            ['REMINDER_RETENTION_DAYS', 30],
            ['LOG_RETENTION_DAYS', 10],
            ['AUTO_HIDE_SYSTEM_SHEETS', true],
            ['ATTENDANCE_ARCHIVE_DAY', 5],
            ['ENABLE_AUTO_ATTENDANCE_SYNC', true],
            ['ATTENDANCE_SYNC_INTERVAL_MINUTES', 10],
            ['LAST_ATTENDANCE_SYNC', ''],
            ['LAST_SALES_STATE', '']
        ];

        let sheet = ss.getSheetByName('Settings');
        if (!sheet) {
            sheet = createSheetIfMissing(ss, 'Settings', ['Key', 'Value'], defaultSettings);
            return defaultSettings.length;
        }

        const data = sheet.getDataRange().getValues();
        const existingKeys = new Set();

        // Read all existing keys from Column A
        for (let i = 0; i < data.length; i++) {
            const key = String(data[i][0] || '').trim();
            if (key) {
                existingKeys.add(key);
            }
        }

        // Append missing keys only
        let addedCount = 0;
        for (let i = 0; i < defaultSettings.length; i++) {
            const defaultPair = defaultSettings[i];
            const keyName = defaultPair[0];
            if (!existingKeys.has(keyName)) {
                sheet.appendRow(defaultPair);
                addedCount++;
            }
        }

        if (addedCount > 0) {
            sheet.autoResizeColumns(1, 2);
        }
        return addedCount;
    };

    /**
     * Initializes the workspace by creating 'Settings', 'Reminder_System', and 'Logs' sheets.
     * Safely migrates existing Settings sheet if present.
     */
    const init = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        if (!ss) return;

        // Sync or Create Settings Sheet
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
            'Sent_At', 'Error_Message'
        ];
        createOrClearSheet(ss, 'Message_Queue', msgQueueHeaders);

        // Auto-install schedule
        installTrigger();
    };

    return { init, installTrigger, installAttendanceSyncTrigger, syncSettings };
})();

/**
 * Entry point for users to manually trigger system setup from GAS bindings.
 */
function runEnvironmentSetup() {
    EnvironmentSetup.init();
}

/**
 * Entry point for users to safely migrate existing Settings sheets.
 */
function runSettingsMigration() {
    return EnvironmentSetup.syncSettings();
}
