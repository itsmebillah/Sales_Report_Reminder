/**
 * @fileoverview Dashboard-backed configuration repository.
 *
 * Dashboard columns C:H are the single persistent configuration surface:
 *   C:E = essential Scheduler/Sender controls.
 *   F:H = Auto Shutdown and System/Runtime controls.
 * Runtime code must use this service instead of addressing a sheet/range directly.
 */
const ConfigurationService = (() => {
    const SHEET_NAME = 'Dashboard';
    const START_COLUMN = 3;
    const VALUE_COLUMN = 4;
    const KEY_COLUMN = 5;
    const RIGHT_START_COLUMN = 6;
    const RIGHT_VALUE_COLUMN = 7;
    const RIGHT_KEY_COLUMN = 8;
    const STORAGE_START_ROW = 100;

    const LEFT_VISIBLE_KEYS = new Set([
        'Scheduler_Time',
        'Timezone',
        'Reporting_Days',
        'Reminder_Days_Before_Lock',
        'ENABLE_AUTO_ATTENDANCE_SYNC',
        'ATTENDANCE_SYNC_INTERVAL_MINUTES',
        'SCHEDULER_TRIGGER_CONFIGURED_TIME',
        'SCHEDULER_TRIGGER_DAILY_COUNT',
        'SCHEDULER_TRIGGER_WORKFLOW_COUNT',
        'SCHEDULER_TRIGGER_LEGACY_COUNT',
        'SCHEDULER_TRIGGER_LAST_VERIFIED_AT',
        'WHATSAPP_ENABLED',
        'SENDER_MODE',
        'MESSAGE_DRAFT',
        'Dry_Run',
        'TEST_MODE',
        'TEST_RECIPIENT_PHONE',
        'OVERRIDE_PHONE',
        'POLL_INTERVAL',
        'QUEUE_BATCH_SIZE',
        'MAX_RETRY'
    ]);

    const NODE_WRITABLE_KEYS = new Set([
        'SYSTEM_STATUS',
        'Sender_Status',
        'Last_Run_Time',
        'Last_Message_Time',
        'Messages_Sent_Today',
        'Messages_Failed_Today',
        'REMINDER_SENDER_DRAINED_AT',
        'AUTO_SHUTDOWN_RUN_ACTIVE',
        'AUTO_SHUTDOWN_RUN_PHASE',
        'AUTO_SHUTDOWN_FINAL_CHECK_AT',
        'AUTO_SHUTDOWN_PENDING_UNTIL',
        'AUTO_SHUTDOWN_RETRY_USED',
        'AUTO_SHUTDOWN_CANCEL_REASON'
    ]);

    // Presentation priority only. This never changes where a key is stored or
    // how Apps Script/Node reads and writes its value.
    const PRIMARY_OPERATOR_KEYS = new Set([
        'Scheduler_Time',
        'SCHEDULER_TRIGGER_CONFIGURED_TIME',
        'SCHEDULER_TRIGGER_DAILY_COUNT',
        'SCHEDULER_TRIGGER_WORKFLOW_COUNT',
        'SCHEDULER_TRIGGER_LEGACY_COUNT',
        'WHATSAPP_ENABLED',
        'SENDER_MODE',
        'MESSAGE_DRAFT',
        'Dry_Run',
        'AUTO_SHUTDOWN_ENABLED',
        'AUTO_SHUTDOWN_DELAY_MINUTES',
        'AUTO_SHUTDOWN_RUN_PHASE',
        'AUTO_SHUTDOWN_RUN_ACTIVE',
        'AUTO_SHUTDOWN_PENDING_UNTIL',
        'AUTO_SHUTDOWN_RETRY_USED',
        'AUTO_SHUTDOWN_CANCEL_REASON',
        'SYSTEM_STATUS',
        'Sender_Status',
        'Last_Run_Time',
        'Last_Message_Time',
        'Messages_Sent_Today',
        'Messages_Failed_Today'
    ]);

    const SECTIONS = [
        {
            title: '1. SCHEDULER', color: '#2f6f8f', settings: [
                ['Scheduler_Time', 'Scheduler Time', '09:00', 'Use the Dashboard clock control to change this value.', 'time'],
                ['', 'Open Scheduler Time Picker', false, 'Select this checkbox to open the existing clock/time-picker UI.', 'actionScheduler'],
                ['Timezone', 'Scheduler Timezone', 'Asia/Dhaka', 'Timezone used by the daily Apps Script trigger.', 'text'],
                ['Reporting_Days', 'Reporting Days', 3, 'Number of sales-reporting days evaluated.', 'number'],
                ['Reminder_Days_Before_Lock', 'Reminder Days Before Lock', 0, 'Reminder lead time before lock.', 'number'],
                ['ENABLE_AUTO_ATTENDANCE_SYNC', 'Auto Attendance Sync', true, 'Enable periodic Attendance synchronization.', 'toggle'],
                ['ATTENDANCE_SYNC_INTERVAL_MINUTES', 'Attendance Sync Interval (minutes)', 10, 'Attendance synchronization interval.', 'number'],
                ['ATTENDANCE_ARCHIVE_DAY', 'Attendance Archive Day', 5, 'Day of month used for Attendance archiving.', 'number'],
                ['SCHEDULER_TRIGGER_CONFIGURED_TIME', 'Trigger Configured Time', '', 'Last verified trigger time.', 'verifiedTime'],
                ['SCHEDULER_TRIGGER_TIMEZONE', 'Trigger Timezone', '', 'Last verified trigger timezone.', 'status'],
                ['SCHEDULER_TRIGGER_DAILY_COUNT', 'Daily Trigger Count', '', 'All reminder-workflow daily triggers.', 'countStatus'],
                ['SCHEDULER_TRIGGER_WORKFLOW_COUNT', 'Workflow Trigger Count', '', 'runScheduledDailyWorkflow trigger count.', 'countStatus'],
                ['SCHEDULER_TRIGGER_LEGACY_COUNT', 'Legacy Reminder Trigger Count', '', 'processDailyReminders time-trigger count.', 'countStatus'],
                ['SCHEDULER_TRIGGER_LAST_VERIFIED_AT', 'Trigger Last Verified', '', 'Timestamp of the last live trigger verification.', 'status']
            ]
        },
        {
            title: '2. WHATSAPP / SENDER', color: '#1f7a5a', settings: [
                ['WHATSAPP_ENABLED', 'WhatsApp Sender Enabled', true, 'Enable WhatsApp Web queue sending.', 'toggle'],
                ['WhatsApp_Enabled', 'WhatsApp API Enabled', true, 'Enable legacy Meta WhatsApp API sending.', 'toggle'],
                ['SENDER_MODE', 'Sender Mode', 'PRODUCTION', 'TEST or PRODUCTION.', 'list', ['PRODUCTION', 'TEST']],
                ['MESSAGE_DRAFT', 'Reminder Message Draft', 'WITH_DEADLINE', 'Choose reminder message draft format: WITH_DEADLINE or STANDARD.', 'list', ['WITH_DEADLINE', 'STANDARD']],
                ['Dry_Run', 'Dry Run', true, 'Simulate legacy API transmission without sending.', 'toggle'],
                ['TEST_MODE', 'Test Mode', false, 'Redirect supported sends to the test recipient.', 'toggle'],
                ['TEST_RECIPIENT_PHONE', 'Test Recipient Phone', '', 'Recipient used by isolated/test sends.', 'text'],
                ['OVERRIDE_PHONE', 'Override Phone', '', 'Legacy API override recipient.', 'text'],
                ['TEST_MESSAGE', 'Test Message', '', 'Message used by isolated WhatsApp testing.', 'text'],
                ['POLL_INTERVAL', 'Poll Interval (seconds)', 10, 'Seconds between worker polling cycles.', 'number'],
                ['QUEUE_BATCH_SIZE', 'Queue Batch Size', 1, 'Queue records processed per cycle.', 'number'],
                ['MAX_RETRY', 'Maximum Retry Attempts', 3, 'Normal attempts before a message becomes FAILED.', 'number'],
                ['QUEUE_ENABLED', 'Message Queue Enabled', true, 'Enable queue processing.', 'toggle'],
                ['AUTO_RETRY', 'Automatic Retry', true, 'Enable normal queue retry behavior.', 'toggle'],
                ['AUTO_CLEAR_SENT', 'Auto-clear Sent Rows', false, 'Enable retention cleanup for SENT rows.', 'toggle'],
                ['CLEAR_AFTER_DAYS', 'Clear Sent After Days', 10, 'Age threshold for automatic SENT cleanup.', 'number'],
                ['DEFAULT_PROVIDER', 'Default Provider', 'WHATSAPP_WEB', 'Default notification provider.', 'text'],
                ['WHATSAPP_SESSION_NAME', 'WhatsApp Session Name', 'production', 'Persistent WhatsApp Web session name.', 'text'],
                ['WHATSAPP_BUSINESS_ACCOUNT_ID', 'WhatsApp Business Account ID', '', 'Meta WhatsApp business account identifier.', 'technical'],
                ['PHONE_NUMBER_ID', 'Meta Phone Number ID', '', 'Meta WhatsApp phone number identifier.', 'technical'],
                ['ACCESS_TOKEN', 'Meta Access Token', '', 'Meta API access token. Keep spreadsheet access restricted.', 'technical'],
                ['META_API_VERSION', 'Meta API Version', 'v25.0', 'Meta Graph API version.', 'technical'],
                ['TEMPLATE_NAME', 'Template Name', '', 'Meta template name.', 'technical'],
                ['TEMPLATE_LANGUAGE', 'Template Language', 'en_US', 'Meta template language.', 'technical'],
                ['BROWSER_PATH', 'Browser Executable Path', '', 'Optional WhatsApp Web browser executable.', 'technical']
            ]
        },
        {
            title: '3. AUTO SHUTDOWN', color: '#8a5a2b', settings: [
                ['AUTO_SHUTDOWN_ENABLED', 'Auto PC Shutdown', false, 'Enable safe shutdown after an eligible scheduled run.', 'toggle'],
                ['', 'Open Auto Shutdown Control', 'READY', 'Choose OPEN CONTROL to open the existing Auto Shutdown ON/OFF dialog.', 'actionButton', ['READY', 'OPEN CONTROL']],
                ['AUTO_SHUTDOWN_DELAY_MINUTES', 'Shutdown Delay (minutes)', 12, 'Cancellable delay after the final tracked message.', 'delay'],
                ['AUTO_SHUTDOWN_RUN_PHASE', 'Current Phase', 'IDLE', 'Persistent shutdown controller phase.', 'status'],
                ['AUTO_SHUTDOWN_RUN_ACTIVE', 'Scheduled Run Active', false, 'TRUE only while an eligible run is generating/sending.', 'statusToggle'],
                ['AUTO_SHUTDOWN_PENDING_UNTIL', 'Countdown Target', '', 'Persisted countdown target timestamp.', 'status'],
                ['AUTO_SHUTDOWN_FINAL_CHECK_AT', 'Final Message Resolved At', '', 'Time the final tracked message resolved.', 'status'],
                ['AUTO_SHUTDOWN_RETRY_USED', 'Final Retry Used', false, 'Whether the single final-message retry was consumed.', 'statusToggle'],
                ['AUTO_SHUTDOWN_CANCEL_REASON', 'Last Cancellation Reason', '', 'Most recent safety cancellation reason.', 'status'],
                ['AUTO_SHUTDOWN_RUN_ID', 'Scheduled Run ID', '', 'Unique shutdown-eligible scheduled run ID.', 'technicalStatus'],
                ['AUTO_SHUTDOWN_RUN_QUEUE_IDS', 'Tracked Queue IDs', '[]', 'Exact queue IDs belonging to the scheduled run.', 'technicalStatus'],
                ['AUTO_SHUTDOWN_LAST_QUEUE_ID', 'Final Queue ID', '', 'Final tracked queue ID.', 'technicalStatus']
            ]
        },
        {
            title: '4. SYSTEM / RUNTIME', color: '#59636e', settings: [
                ['SYSTEM_STATUS', 'Notification Worker Gate', 'STOP', 'RUNNING or STOP.', 'statusList', ['STOP', 'RUNNING']],
                ['Sender_Status', 'Sender Runtime Status', '', 'Written by the Node.js worker.', 'status'],
                ['Last_Run_Time', 'Last Worker Heartbeat', '', 'Written by the Node.js worker.', 'status'],
                ['Last_Message_Time', 'Last Message Time', '', 'Timestamp of the last sent message.', 'status'],
                ['Messages_Sent_Today', 'Messages Sent Today', 0, 'Daily worker success counter.', 'countStatus'],
                ['Messages_Failed_Today', 'Messages Failed Today', 0, 'Daily worker failure counter.', 'countStatus'],
                ['REMINDER_RETENTION_DAYS', 'Reminder Retention (days)', 30, 'Retention for Reminder_System records.', 'number'],
                ['LOG_RETENTION_DAYS', 'Log Retention (days)', 10, 'Retention for eligible log cleanup.', 'number'],
                ['AUTO_HIDE_SYSTEM_SHEETS', 'Auto-hide System Sheets', true, 'Hide operational sheets from normal navigation.', 'toggle'],
                ['LAST_ATTENDANCE_SYNC', 'Last Attendance Sync', '', 'Latest successful Attendance synchronization.', 'timestamp'],
                ['LAST_SALES_STATE', 'Last Sales State Fingerprint', '', 'Internal hash used by Attendance change detection.', 'technicalStatus'],
                ['REMINDER_SENDER_DRAINED_AT', 'Sender Drained At', '', 'Runtime queue-drain timestamp when available.', 'technicalStatus']
            ]
        }
    ];

    const getSheet = createIfMissing => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        if (!ss) throw new Error('No active spreadsheet found.');
        let sheet = ss.getSheetByName(SHEET_NAME);
        if (!sheet && createIfMissing !== false) sheet = ss.insertSheet(SHEET_NAME, 0);
        if (!sheet) throw new Error('Dashboard sheet is missing.');
        return sheet;
    };

    const readMap = () => {
        const sheet = getSheet(false);
        const lastRow = sheet.getLastRow();
        const map = {};
        if (lastRow < 1) return { map, sheet };
        const data = sheet.getRange(1, START_COLUMN, lastRow, 6).getValues();
        data.forEach((row, index) => {
            const leftKey = String(row[2] || '').trim();
            const rightKey = String(row[5] || '').trim();
            if (leftKey) map[leftKey] = { value: row[1], row: index + 1, label: row[0], valueColumn: VALUE_COLUMN };
            if (rightKey) map[rightKey] = { value: row[4], row: index + 1, label: row[3], valueColumn: RIGHT_VALUE_COLUMN };
        });
        return { map, sheet };
    };

    const getSetting = key => {
        let { map } = readMap();
        if (Object.keys(map).length === 0) {
            ensureDefaults();
            map = readMap().map;
        }
        return map[key] ? map[key].value : '';
    };

    const updateSettings = values => {
        let { map, sheet } = readMap();
        if (Object.keys(map).length === 0) {
            ensureDefaults();
            ({ map, sheet } = readMap());
        }
        const toggleKeys = new Set();
        SECTIONS.forEach(section => section.settings.forEach(setting => {
            if (setting[4] === 'toggle' || setting[4] === 'statusToggle') toggleKeys.add(setting[0]);
        }));
        const unknown = [];
        Object.keys(values).forEach(key => {
            const value = toggleKeys.has(key) ? normalizeToggle(values[key]) : values[key];
            if (map[key]) sheet.getRange(map[key].row, map[key].valueColumn).setValue(value);
            else unknown.push({ key, value });
        });
        if (unknown.length) {
            ensureDashboardConfigurationArea(sheet, values);
        }
        if (typeof ConfigLoader !== 'undefined' && ConfigLoader.invalidate) ConfigLoader.invalidate();
    };

    const updateSetting = (key, value) => updateSettings({ [key]: value });

    const schemaKeys = () => {
        const keys = new Set();
        SECTIONS.forEach(section => section.settings.forEach(setting => {
            if (setting[0]) keys.add(setting[0]);
        }));
        return keys;
    };

    const normalizeToggle = value => {
        if (typeof value === 'boolean') return value;
        const normalized = String(value || '').trim().toUpperCase();
        return normalized === 'TRUE' || normalized === 'YES' || normalized === '1' || normalized === 'ON';
    };

    const ensureDashboardConfigurationArea = (providedSheet, seedValues, seedWins) => {
        const sheet = providedSheet || getSheet(true);
        const current = readMap().map;
        const seed = seedValues || {};
        const knownKeys = schemaKeys();
        const leftRows = [];
        const rightRows = [];
        const metadata = [];

        const resolveValue = setting => {
            const [key, , defaultValue, , type] = setting;
            const hasSeed = key && Object.prototype.hasOwnProperty.call(seed, key);
            let value = seedWins && hasSeed
                ? seed[key]
                : (key && current[key] ? current[key].value : (hasSeed ? seed[key] : defaultValue));
            if (type === 'toggle' || type === 'statusToggle') value = normalizeToggle(value);
            return value;
        };

        const hiddenSettings = [];
        const appendSection = (section, settings, rows, startColumn) => {
            rows.push([section.title, '', '']);
            metadata.push({ row: rows.length + 1, kind: 'section', color: section.color, startColumn });
            settings.forEach(setting => {
                const [key, label, , description, type, options] = setting;
                rows.push([label, resolveValue(setting), key]);
                metadata.push({
                    row: rows.length + 1,
                    kind: 'setting',
                    key,
                    description,
                    type,
                    options: options || [],
                    startColumn,
                    valueColumn: startColumn + 1,
                    keyColumn: startColumn + 2
                });
            });
            // Preserve this existing spacer row. The left panel may use it for
            // a display-only summary, but it never receives a backend key.
            rows.push(['', '', '']);
            return rows.length + 1;
        };

        const leftSummaryRows = [];
        SECTIONS.slice(0, 2).forEach(section => {
            const visible = section.settings.filter(setting =>
                setting[4] === 'actionScheduler' || LEFT_VISIBLE_KEYS.has(setting[0])
            );
            const hidden = section.settings.filter(setting =>
                setting[0] && setting[4] !== 'actionScheduler' && !LEFT_VISIBLE_KEYS.has(setting[0])
            );
            leftSummaryRows.push(appendSection(section, visible, leftRows, START_COLUMN));
            hiddenSettings.push(...hidden);
        });
        SECTIONS.slice(2).forEach(section => appendSection(section, section.settings, rightRows, RIGHT_START_COLUMN));

        const extras = {};
        Object.keys(current).forEach(key => { if (!knownKeys.has(key)) extras[key] = current[key].value; });
        Object.keys(seed).forEach(key => {
            if (!knownKeys.has(key) && (seedWins || !Object.prototype.hasOwnProperty.call(extras, key))) extras[key] = seed[key];
        });
        const hiddenRows = [['INTERNAL CONFIGURATION STORAGE', '', '']];
        hiddenSettings.forEach(setting => hiddenRows.push([setting[1], resolveValue(setting), setting[0]]));
        Object.keys(extras).sort().forEach(key => hiddenRows.push([key.replace(/_/g, ' '), extras[key], key]));

        sheet.getRange(1, START_COLUMN, sheet.getMaxRows(), 6)
            .breakApart().clearContent().clearFormat().clearDataValidations().clearNote();
        sheet.getRange(1, START_COLUMN, 1, 6).merge()
            .setBackground('#17324d').setFontColor('#ffffff').setFontWeight('bold')
            .setFontSize(12).setHorizontalAlignment('center').setValue('SYSTEM CONFIGURATION & CONTROLS');
        if (leftRows.length) sheet.getRange(2, START_COLUMN, leftRows.length, 3).setValues(leftRows);
        if (rightRows.length) sheet.getRange(2, RIGHT_START_COLUMN, rightRows.length, 3).setValues(rightRows);
        sheet.getRange(STORAGE_START_ROW, START_COLUMN, hiddenRows.length, 3).setValues(hiddenRows);
        sheet.hideRows(STORAGE_START_ROW, hiddenRows.length);

        // These summaries occupy the same spacer rows used by the prior layout.
        // They are display-only: E/H stay blank, so neither configuration
        // repository treats them as storage records.
        const schedulerSummaryRow = leftSummaryRows[0];
        const queueSummaryRow = leftSummaryRows[1];
        const schedulerSummaryFormula =
            '=IF(AND(IFERROR(INDEX($D:$D,MATCH("SCHEDULER_TRIGGER_DAILY_COUNT",$E:$E,0)),0)=1,' +
            'IFERROR(INDEX($D:$D,MATCH("SCHEDULER_TRIGGER_WORKFLOW_COUNT",$E:$E,0)),0)=1,' +
            'IFERROR(INDEX($D:$D,MATCH("SCHEDULER_TRIGGER_LEGACY_COUNT",$E:$E,0)),0)=0),' +
            '"ACTIVE","CHECK REQUIRED")&" | Configured "&' +
            'IFERROR(TEXT(INDEX($D:$D,MATCH("Scheduler_Time",$E:$E,0)),"hh:mm AM/PM"),' +
            'INDEX($D:$D,MATCH("Scheduler_Time",$E:$E,0)))';
        const queueSummaryFormula =
            '="Queue: "&IFERROR(INDEX($G:$G,MATCH("Sender_Status",$H:$H,0)),"UNKNOWN")&' +
            '" | Sent: "&IFERROR(INDEX($G:$G,MATCH("Messages_Sent_Today",$H:$H,0)),0)&' +
            '" | Failed: "&IFERROR(INDEX($G:$G,MATCH("Messages_Failed_Today",$H:$H,0)),0)';
        sheet.getRange(schedulerSummaryRow, START_COLUMN).setValue('Scheduler Status / Configured Run');
        sheet.getRange(schedulerSummaryRow, VALUE_COLUMN).setFormula(schedulerSummaryFormula);
        sheet.getRange(queueSummaryRow, START_COLUMN).setValue('Queue Status / Today');
        sheet.getRange(queueSummaryRow, VALUE_COLUMN).setFormula(queueSummaryFormula);

        const editableRanges = [];
        const statusRows = [];
        const keyLocations = {};
        metadata.forEach(item => {
            if (item.kind === 'section') {
                sheet.getRange(item.row, item.startColumn, 1, 3).merge()
                    .setBackground(item.color).setFontColor('#ffffff').setFontWeight('bold')
                    .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
                sheet.setRowHeight(item.row, 31);
                return;
            }
            const labelCell = sheet.getRange(item.row, item.startColumn);
            const valueCell = sheet.getRange(item.row, item.valueColumn);
            const keyCell = sheet.getRange(item.row, item.keyColumn);
            if (item.key) keyLocations[item.key] = item;
            labelCell.setFontWeight('normal').setFontSize(8).setBackground('#f7f9fb').setFontColor('#4f5b66')
                .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
            valueCell.setFontSize(8).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
            keyCell.setFontColor('#c1c7cd').setFontSize(6).setBackground('#fafbfc')
                .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
            if (PRIMARY_OPERATOR_KEYS.has(item.key) || item.type === 'actionButton' || item.type === 'actionScheduler') {
                labelCell.setFontWeight('bold').setFontColor('#263746');
                valueCell.setFontWeight('bold');
            }
            valueCell.setNote(item.description || '');
            if (item.type === 'toggle' || item.type === 'statusToggle' || item.type === 'actionScheduler') valueCell.insertCheckboxes();
            if (item.type === 'list' || item.type === 'statusList') {
                const rule = SpreadsheetApp.newDataValidation().requireValueInList(item.options, true).setAllowInvalid(false).build();
                valueCell.setDataValidation(rule);
            }
            if (item.type === 'actionButton') {
                const rule = SpreadsheetApp.newDataValidation().requireValueInList(item.options, true).setAllowInvalid(false).build();
                valueCell.setDataValidation(rule).setValue('READY')
                    .setBackground('#fce8d5').setFontColor('#8a3b12').setFontWeight('bold');
            }
            if (item.type === 'number') {
                const rule = SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).build();
                valueCell.setDataValidation(rule).setNumberFormat('0');
            }
            if (item.type === 'delay') {
                const rule = SpreadsheetApp.newDataValidation().requireNumberBetween(1, 120).setAllowInvalid(false).build();
                valueCell.setDataValidation(rule).setNumberFormat('0');
            }
            if (item.type === 'time') valueCell.setNumberFormat('@').setNote(item.description + ' Select this row, then use Sales Automation → Set Scheduler Time.');
            if (item.type === 'verifiedTime') valueCell.setNumberFormat('HH:mm');
            if (item.type === 'timestamp') valueCell.setNumberFormat('dd-mmm-yyyy hh:mm:ss');
            if (item.type === 'countStatus') valueCell.setNumberFormat('0');
            if (item.type === 'time' || item.type === 'status' || item.type === 'statusToggle' ||
                item.type === 'technicalStatus' || item.type === 'verifiedTime' ||
                item.type === 'timestamp' || item.type === 'countStatus') {
                valueCell.setBackground('#f1f3f4').setFontColor('#59636e');
                statusRows.push({ row: item.row, valueColumn: item.valueColumn, key: item.key });
                if (NODE_WRITABLE_KEYS.has(item.key)) editableRanges.push(valueCell);
            } else {
                editableRanges.push(valueCell);
            }
            if (item.type === 'statusList') statusRows.push({ row: item.row, valueColumn: item.valueColumn, key: item.key });
            if (item.type === 'actionButton') statusRows.push({ row: item.row, valueColumn: item.valueColumn, key: item.key });
            if (item.type === 'technical' || item.type === 'technicalStatus') {
                labelCell.setFontColor('#aeb6bd').setFontWeight('normal').setFontSize(7);
                valueCell.setFontColor('#aeb6bd').setFontSize(7);
            }
        });

        const styleSummaryRow = row => {
            sheet.getRange(row, VALUE_COLUMN, 1, 2).merge();
            sheet.getRange(row, START_COLUMN, 1, 3)
                .setBackground('#eaf1f6').setFontColor('#24465b').setFontWeight('bold')
                .setBorder(true, true, true, true, false, false, '#c8d7e1', SpreadsheetApp.BorderStyle.SOLID);
            sheet.getRange(row, VALUE_COLUMN).setHorizontalAlignment('center').setFontSize(7)
                .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
            sheet.setRowHeight(row, 31);
        };
        styleSummaryRow(schedulerSummaryRow);
        styleSummaryRow(queueSummaryRow);

        sheet.setColumnWidth(START_COLUMN, 229);
        sheet.setColumnWidth(VALUE_COLUMN, 125);
        sheet.setColumnWidth(KEY_COLUMN, 28);
        sheet.setColumnWidth(RIGHT_START_COLUMN, 159);
        sheet.setColumnWidth(RIGHT_VALUE_COLUMN, 137);
        sheet.setColumnWidth(RIGHT_KEY_COLUMN, 28);
        sheet.showColumns(START_COLUMN, 6);
        sheet.hideColumns(KEY_COLUMN);
        sheet.hideColumns(RIGHT_KEY_COLUMN);
        const visibleRows = Math.max(leftRows.length, rightRows.length) + 1;
        sheet.setRowHeightsForced(1, visibleRows, 31);
        sheet.setRowHeight(1, 31);
        sheet.getRange(1, START_COLUMN, visibleRows, 6)
            .setFontFamily('Arial').setVerticalAlignment('middle')
            .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
        sheet.getRange(1, VALUE_COLUMN, visibleRows, 1).setHorizontalAlignment('center');
        sheet.getRange(1, RIGHT_VALUE_COLUMN, visibleRows, 1).setHorizontalAlignment('center');
        sheet.getRange(2, START_COLUMN, leftRows.length, 3)
            .setBorder(true, true, true, true, true, true, '#d9e2ea', SpreadsheetApp.BorderStyle.SOLID);
        sheet.getRange(2, RIGHT_START_COLUMN, rightRows.length, 3)
            .setBorder(true, true, true, true, true, true, '#d9e2ea', SpreadsheetApp.BorderStyle.SOLID);
        sheet.setFrozenRows(1);
        sheet.setHiddenGridlines(true);

        if (keyLocations.Scheduler_Time) {
            sheet.getRange(keyLocations.Scheduler_Time.row, keyLocations.Scheduler_Time.valueColumn)
                .setFontSize(10).setBackground('#e8f0fe').setFontColor('#174ea6');
        }

        const existingRules = sheet.getConditionalFormatRules().filter(rule =>
            !rule.getRanges().some(range => range.getColumn() <= RIGHT_KEY_COLUMN && range.getLastColumn() >= START_COLUMN)
        );
        if (statusRows.length) {
            const ranges = statusRows.map(item => sheet.getRange(item.row, item.valueColumn));
            existingRules.push(
                SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('RUNNING').setBackground('#d9ead3').setFontColor('#274e13').setRanges(ranges).build(),
                SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ACTIVE').setBackground('#d9ead3').setFontColor('#274e13').setRanges(ranges).build(),
                SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('OPERATIONAL').setBackground('#d9ead3').setFontColor('#274e13').setRanges(ranges).build(),
                SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('READY').setBackground('#d9ead3').setFontColor('#274e13').setRanges(ranges).build(),
                SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('PENDING').setBackground('#fff2cc').setFontColor('#7f6000').setRanges(ranges).build(),
                SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('WAITING').setBackground('#fff2cc').setFontColor('#7f6000').setRanges(ranges).build(),
                SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('PAUSED').setBackground('#fff2cc').setFontColor('#7f6000').setRanges(ranges).build(),
                SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('STOP').setBackground('#eef1f4').setFontColor('#59636e').setRanges(ranges).build(),
                SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('IDLE').setBackground('#eef1f4').setFontColor('#59636e').setRanges(ranges).build(),
                SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('FAILED').setBackground('#f4cccc').setFontColor('#990000').setRanges(ranges).build(),
                SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ERROR').setBackground('#f4cccc').setFontColor('#990000').setRanges(ranges).build(),
                SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('BLOCKED').setBackground('#f4cccc').setFontColor('#990000').setRanges(ranges).build(),
                SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('CHECK REQUIRED').setBackground('#f4cccc').setFontColor('#990000').setRanges(ranges).build()
            );
        }

        const failedLocation = keyLocations.Messages_Failed_Today;
        if (failedLocation) {
            existingRules.push(
                SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0)
                    .setBackground('#f4cccc').setFontColor('#990000').setBold(true)
                    .setRanges([sheet.getRange(failedLocation.row, failedLocation.valueColumn)]).build(),
                SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(
                    '=IFERROR(INDEX($G:$G,MATCH("Messages_Failed_Today",$H:$H,0)),0)>0'
                ).setBackground('#f4cccc').setFontColor('#990000')
                    .setRanges([sheet.getRange(queueSummaryRow, START_COLUMN, 1, 3)]).build()
            );
        }

        const phaseLocation = keyLocations.AUTO_SHUTDOWN_RUN_PHASE;
        const activeLocation = keyLocations.AUTO_SHUTDOWN_RUN_ACTIVE;
        const countdownLocation = keyLocations.AUTO_SHUTDOWN_PENDING_UNTIL;
        if (phaseLocation && activeLocation && countdownLocation) {
            const countdownFormula =
                `=AND(UPPER($G$${phaseLocation.row})="COUNTDOWN",$G$${activeLocation.row}=TRUE,$G$${countdownLocation.row}<>"")`;
            existingRules.push(
                SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(countdownFormula)
                    .setBackground('#f9cb9c').setFontColor('#783f04').setBold(true)
                    .setRanges([
                        sheet.getRange(phaseLocation.row, phaseLocation.valueColumn),
                        sheet.getRange(countdownLocation.row, countdownLocation.valueColumn)
                    ]).build()
            );
        }

        const enabledLocation = keyLocations.AUTO_SHUTDOWN_ENABLED;
        if (enabledLocation) {
            const enabledCell = sheet.getRange(enabledLocation.row, enabledLocation.valueColumn);
            existingRules.push(
                SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$G$${enabledLocation.row}=TRUE`)
                    .setBackground('#d9ead3').setFontColor('#274e13').setBold(true)
                    .setRanges([enabledCell]).build(),
                SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$G$${enabledLocation.row}=FALSE`)
                    .setBackground('#eef1f4').setFontColor('#59636e')
                    .setRanges([enabledCell]).build()
            );
        }

        existingRules.push(
            SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=LEFT($D$${schedulerSummaryRow},6)="ACTIVE"`)
                .setBackground('#d9ead3').setFontColor('#274e13')
                .setRanges([sheet.getRange(schedulerSummaryRow, START_COLUMN, 1, 3)]).build(),
            SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=LEFT($D$${schedulerSummaryRow},5)="CHECK"`)
                .setBackground('#f4cccc').setFontColor('#990000')
                .setRanges([sheet.getRange(schedulerSummaryRow, START_COLUMN, 1, 3)]).build()
        );
        sheet.setConditionalFormatRules(existingRules);

        renderDraftPreview(sheet);

        try {
            let protection = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0];
            if (!protection) protection = sheet.protect().setDescription('Dashboard Operational Protection');
            protection.setWarningOnly(false).setUnprotectedRanges(editableRanges);
            const me = Session.getEffectiveUser();
            if (me) protection.addEditor(me);
            if (protection.canDomainEdit()) protection.setDomainEdit(false);
        } catch (err) {
            console.log('Dashboard configuration protection note: ' + err);
        }
        return { sheet, rowCount: visibleRows, keyCount: Object.keys(readMap().map).length };
    };

    const DRAFT_1_PREVIEW = "আসসালামু আলাইকুম।\n\nপ্রিয় Md.Tanjil Islam,\n\n📢 সেলস পোস্টিং রিমাইন্ডার\n\n📅 রিপোর্টিং তারিখ: *27-Aug-2026*\n⏰ পোস্টিংয়ের শেষ সময়: *01-Sep-2026 10.00 থেকে সকাল 11.00 টা*\n\n📌 মোট বাকি এসআর: 1 জন\n\nবাকি থাকা এসআরদের তালিকা:\n\n• TR1942 - Mohammad Shahid Ullah\n\nঅনুগ্রহ করে নির্ধারিত সময়সীমার মধ্যে উপরের এসআরদের সেলস পোস্টিং সম্পন্ন করুন।\n\n⚠️ কোনো এসআর Close হয়ে থাকলে অনুগ্রহ করে সংশ্লিষ্ট গ্রুপে জানাবেন।\n\nℹ️ যদি ইতোমধ্যে সেলস পোস্টিং সম্পন্ন হয়ে থাকে, কোনো এসআর ছুটিতে থাকে কিংবা সেলস না থাকে তাহলে অনুগ্রহ করে এই বার্তাটি উপেক্ষা করুন।\n\nধন্যবাদ।";

    const DRAFT_2_PREVIEW = "আসসালামু আলাইকুম।\n\nপ্রিয় Md.Tanjil Islam,\n\n📢 সেলস পোস্টিং রিমাইন্ডার\n\n📅 রিপোর্টিং তারিখ: 27-Aug-2026\n⏰ পোস্টিংয়ের শেষ সময়: আজ (01-Sep-2026) সকাল 10.00 থেকে 11.00 টা\n\n📌 মোট বাকি এসআর: 1 জন\n\nবাকি থাকা এসআরদের তালিকা:\n\n• TR1942 - Mohammad Shahid Ullah\n\nঅনুগ্রহ করে নির্ধারিত সময়সীমার মধ্যে উপরের এসআরদের সেলস পোস্টিং সম্পন্ন করুন।\n\n⚠️ কোনো এসআর Close হয়ে থাকলে অনুগ্রহ করে সংশ্লিষ্ট গ্রুপে জানাবেন।\n\nℹ️ যদি ইতোমধ্যে সেলস পোস্টিং সম্পন্ন হয়ে থাকে, কোনো এসআর ছুটিতে থাকে কিংবা সেলস না থাকে তাহলে অনুগ্রহ করে এই বার্তাটি উপেক্ষা করুন।\n\nধন্যবাদ।";

    const renderDraftPreview = sheet => {
        try {
            if (!sheet) return;
            sheet.setColumnWidth(9, 16); // Column I spacer
            sheet.setColumnWidth(10, 210); // Column J
            sheet.setColumnWidth(11, 210); // Column K
            sheet.showColumns(9, 3);

            // J11:K11 Header (Merged)
            const headerRange = sheet.getRange('J11:K11');
            headerRange.breakApart();
            headerRange.merge();
            headerRange.setValue('MESSAGE DRAFT LIVE PREVIEW')
                .setBackground('#17324d')
                .setFontColor('#ffffff')
                .setFontWeight('bold')
                .setFontSize(9)
                .setHorizontalAlignment('center')
                .setVerticalAlignment('middle');
            sheet.setRowHeight(11, 24);

            // J12:K28 Preview Area (Merged across J12:K12 to J28:K28)
            const previewRange = sheet.getRange('J12:K28');
            previewRange.breakApart();
            previewRange.merge();

            const formula = '=IF(OR(INDEX($D:$D,MATCH("MESSAGE_DRAFT",$E:$E,0))="STANDARD",INDEX($D:$D,MATCH("MESSAGE_DRAFT",$E:$E,0))="DRAFT_2",INDEX($D:$D,MATCH("MESSAGE_DRAFT",$E:$E,0))="DRAFT 2"),"' +
                DRAFT_2_PREVIEW.replace(/"/g, '""') + '","' +
                DRAFT_1_PREVIEW.replace(/"/g, '""') + '")';

            previewRange.setFormula(formula)
                .setBackground('#ffffff')
                .setFontColor('#202124')
                .setFontFamily('Arial')
                .setFontSize(8.5)
                .setVerticalAlignment('top')
                .setHorizontalAlignment('left')
                .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);

            sheet.getRange('J11:K28').setBorder(true, true, true, true, true, true, '#c8d7e1', SpreadsheetApp.BorderStyle.SOLID);
        } catch (e) {
            console.log('Error rendering draft preview in J11:K28: ' + e);
        }
    };

    const readLegacySettings = legacySheet => {
        const values = {};
        const descriptions = {};
        if (!legacySheet) return { values, descriptions };
        const data = legacySheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
            const key = String(data[i][0] || '').trim();
            if (!key) continue;
            values[key] = data[i][1];
            descriptions[key] = data[i][2] || '';
        }
        return { values, descriptions };
    };

    const migrateFromLegacySettings = deleteLegacy => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const legacy = ss.getSheetByName('Settings');
        const snapshot = readLegacySettings(legacy);
        const result = ensureDashboardConfigurationArea(getSheet(true), snapshot.values, true);
        const dashboardMap = readMap().map;
        const missing = Object.keys(snapshot.values).filter(key => !dashboardMap[key]);
        const mismatched = Object.keys(snapshot.values).filter(key =>
            dashboardMap[key] && String(dashboardMap[key].value) !== String(snapshot.values[key])
        );
        if (missing.length || mismatched.length) {
            throw new Error('Configuration migration verification failed. Missing: ' + missing.join(', ') + '; mismatched: ' + mismatched.join(', '));
        }
        if (deleteLegacy && legacy) ss.deleteSheet(legacy);
        if (typeof ConfigLoader !== 'undefined' && ConfigLoader.invalidate) ConfigLoader.invalidate();
        return { migratedKeys: Object.keys(snapshot.values).length, missing, mismatched, legacyRemoved: Boolean(deleteLegacy && legacy), dashboardRows: result.rowCount };
    };

    /**
     * Removes the legacy Settings sheet after a read-only key-completeness check.
     * Dashboard values are authoritative and are never compared with or replaced
     * by legacy values during removal.
     */
    const removeLegacySettingsAfterMigration = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        if (!ss) throw new Error('No active spreadsheet found.');

        const legacy = ss.getSheetByName('Settings');
        if (!legacy) return { verifiedKeys: 0, missing: [], legacyRemoved: false };

        const snapshot = readLegacySettings(legacy);
        const dashboardMap = readMap().map;
        const requiredKeys = Object.keys(snapshot.values);
        const missing = requiredKeys.filter(key =>
            !Object.prototype.hasOwnProperty.call(dashboardMap, key)
        );

        if (missing.length) {
            throw new Error('Legacy Settings removal verification failed. Missing Dashboard keys: ' + missing.join(', '));
        }

        ss.deleteSheet(legacy);
        if (typeof ConfigLoader !== 'undefined' && ConfigLoader.invalidate) ConfigLoader.invalidate();
        return { verifiedKeys: requiredKeys.length, missing, legacyRemoved: true };
    };

    const ensureDefaults = () => {
        const before = Object.keys(readMap().map).length;
        if (before === 0) {
            const ss = SpreadsheetApp.getActiveSpreadsheet();
            const legacy = ss && ss.getSheetByName('Settings');
            if (legacy) return migrateFromLegacySettings(false).migratedKeys;
        }
        ensureDashboardConfigurationArea();
        const after = Object.keys(readMap().map).length;
        return Math.max(0, after - before);
    };

    return {
        SHEET_NAME,
        getSheet,
        readMap,
        getSetting,
        updateSetting,
        updateSettings,
        ensureDefaults,
        ensureDashboardConfigurationArea,
        renderDraftPreview,
        migrateFromLegacySettings,
        removeLegacySettingsAfterMigration
    };
})();
