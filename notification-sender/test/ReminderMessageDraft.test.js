const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadDateUtils() {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/utils/DateUtils.js'), 'utf8');
    const context = {
        Utilities: {
            formatDate: (d, tz, format) => {
                const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const day = String(d.getDate()).padStart(2, '0');
                const month = months[d.getMonth()];
                const year = d.getFullYear();
                return `${day}-${month}-${year}`;
            }
        }
    };
    vm.runInNewContext(source + '\nthis.__DateUtils = DateUtils;', context);
    return context.__DateUtils;
}

test('DateUtils.getNextDayDate computes next calendar day accurately across month boundaries', () => {
    const DateUtils = loadDateUtils();
    
    // Test normal day transition
    const baseDate1 = new Date(2026, 7, 27); // 27-Aug-2026
    const next1 = DateUtils.getNextDayDate(baseDate1, 'Asia/Dhaka');
    assert.equal(next1.getDate(), 28);
    assert.equal(next1.getMonth(), 7);

    // Test month-end transition: 31-Aug-2026 -> 01-Sep-2026
    const baseDate2 = new Date(2026, 7, 31); // 31-Aug-2026
    const next2 = DateUtils.getNextDayDate(baseDate2, 'Asia/Dhaka');
    assert.equal(next2.getDate(), 1);
    assert.equal(next2.getMonth(), 8); // Sep (0-indexed 8)
    assert.equal(DateUtils.formatDate(next2, 'Asia/Dhaka'), '01-Sep-2026');
});

test('Reminder message draft WITH_DEADLINE contains bold reporting date and fixed 10.00 AM next day deadline', () => {
    const DateUtils = loadDateUtils();
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/services/ReminderService.js'), 'utf8');
    
    let writtenQueue = [];
    const context = {
        console: { log: () => {} },
        DateUtils,
        ConfigLoader: {
            load: () => ({
                MESSAGE_DRAFT: 'WITH_DEADLINE',
                Dry_Run: 'FALSE',
                Reporting_Days: 3,
                Timezone: 'Asia/Dhaka',
                NOTIFICATION_PROVIDER: 'WhatsApp'
            })
        },
        SheetService: {
            ensureMessageQueueHeaders: () => {},
            clearDataKeepHeaders: () => {},
            readHierarchyMap: () => ({
                'SR01': { SR_ID: 'SR01', SR_Name: 'SR Name 1', TSO_ID: 'TSO01', TSO_Name: 'TSO One', TSO_Phone: '01700000000', RSM_ID: 'RSM01', RSM_Name: 'RSM One' }
            }),
            readContactMap: () => ({
                tsoMap: { 'TSO01': { TSO_ID: 'TSO01', TSO_Name: 'TSO One', TSO_Phone: '01700000000', RSM_ID: 'RSM01', RSM_Name: 'RSM One' } },
                srMap: {},
                rsmMap: {},
                rsmConflicts: {}
            }),
            readDailySalesForDayBySR: () => [
                { SR_ID: 'SR01', Sales_Volume: 0 }
            ],
            readReminderSystemCache: () => ({}),
            writePendingSRs: () => {},
            writePendingTSOs: () => {},
            writeMessageQueue: rows => { writtenQueue = rows; },
            writeLog: () => {},
            writeReminderSystemCache: () => {}
        },
        CleanupService: { runCleanup: () => ({}) },
        AttendanceService: { updateAttendance: () => ({}) },
        VisibilityService: { applyOfficeUserModeVisibility: () => {} },
        DashboardService: { refreshDashboard: () => {} },
        Utilities: {
            getUuid: () => 'uuid-1',
            formatDate: DateUtils.formatDate
        }
    };

    vm.runInNewContext(source + '\nthis.__ReminderService = ReminderService;', context);
    context.__ReminderService.processReminders();

    assert.equal(writtenQueue.length, 1);
    const messageBody = writtenQueue[0][11]; // Message_Body column

    // Verify bold reporting date: 📅 রিপোর্টিং তারিখ: *...*
    assert.match(messageBody, /📅 রিপোর্টিং তারিখ: \*\d{2}-[A-Za-z]{3}-\d{4}\*/);

    // Verify deadline line: ⏰ পোস্টিংয়ের শেষ সময়: *... 10.00 থেকে সকাল 11.00 টা*
    assert.match(messageBody, /⏰ পোস্টিংয়ের শেষ সময়: \*\d{2}-[A-Za-z]{3}-\d{4} 10\.00 থেকে সকাল 11\.00 টা\*/);
});

test('Reminder message draft STANDARD contains standard reporting date and no deadline line', () => {
    const DateUtils = loadDateUtils();
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/services/ReminderService.js'), 'utf8');
    
    let writtenQueue = [];
    const context = {
        console: { log: () => {} },
        DateUtils,
        ConfigLoader: {
            load: () => ({
                MESSAGE_DRAFT: 'STANDARD',
                Dry_Run: 'FALSE',
                Reporting_Days: 3,
                Timezone: 'Asia/Dhaka',
                NOTIFICATION_PROVIDER: 'WhatsApp'
            })
        },
        SheetService: {
            ensureMessageQueueHeaders: () => {},
            clearDataKeepHeaders: () => {},
            readHierarchyMap: () => ({
                'SR01': { SR_ID: 'SR01', SR_Name: 'SR Name 1', TSO_ID: 'TSO01', TSO_Name: 'TSO One', TSO_Phone: '01700000000', RSM_ID: 'RSM01', RSM_Name: 'RSM One' }
            }),
            readContactMap: () => ({
                tsoMap: { 'TSO01': { TSO_ID: 'TSO01', TSO_Name: 'TSO One', TSO_Phone: '01700000000', RSM_ID: 'RSM01', RSM_Name: 'RSM One' } },
                srMap: {},
                rsmMap: {},
                rsmConflicts: {}
            }),
            readDailySalesForDayBySR: () => [
                { SR_ID: 'SR01', Sales_Volume: 0 }
            ],
            readReminderSystemCache: () => ({}),
            writePendingSRs: () => {},
            writePendingTSOs: () => {},
            writeMessageQueue: rows => { writtenQueue = rows; },
            writeLog: () => {},
            writeReminderSystemCache: () => {}
        },
        CleanupService: { runCleanup: () => ({}) },
        AttendanceService: { updateAttendance: () => ({}) },
        VisibilityService: { applyOfficeUserModeVisibility: () => {} },
        DashboardService: { refreshDashboard: () => {} },
        Utilities: {
            getUuid: () => 'uuid-1',
            formatDate: DateUtils.formatDate
        }
    };

    vm.runInNewContext(source + '\nthis.__ReminderService = ReminderService;', context);
    context.__ReminderService.processReminders();

    assert.equal(writtenQueue.length, 1);
    const messageBody = writtenQueue[0][11];

    // Standard reporting date without bold asterisks: 📅 রিপোর্টিং তারিখ: 27-Aug-2026
    assert.match(messageBody, /📅 রিপোর্টিং তারিখ: \d{2}-[A-Za-z]{3}-\d{4}/);
    assert.doesNotMatch(messageBody, /📅 রিপোর্টিং তারিখ: \*/);

    // No deadline line
    assert.doesNotMatch(messageBody, /পোস্টিংয়ের শেষ সময়/);
});

test('Test Mode safely overrides recipient phone with TEST_RECIPIENT_PHONE', () => {
    const DateUtils = loadDateUtils();
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/services/ReminderService.js'), 'utf8');
    
    let writtenQueue = [];
    const context = {
        console: { log: () => {} },
        DateUtils,
        ConfigLoader: {
            load: () => ({
                SENDER_MODE: 'TEST',
                TEST_MODE: 'TRUE',
                TEST_RECIPIENT_PHONE: '01899999999',
                Dry_Run: 'FALSE',
                Reporting_Days: 3,
                Timezone: 'Asia/Dhaka',
                NOTIFICATION_PROVIDER: 'WhatsApp'
            })
        },
        SheetService: {
            ensureMessageQueueHeaders: () => {},
            clearDataKeepHeaders: () => {},
            readHierarchyMap: () => ({
                'SR01': { SR_ID: 'SR01', SR_Name: 'SR Name 1', TSO_ID: 'TSO01', TSO_Name: 'TSO One', TSO_Phone: '01700000000', RSM_ID: 'RSM01', RSM_Name: 'RSM One' }
            }),
            readContactMap: () => ({
                tsoMap: { 'TSO01': { TSO_ID: 'TSO01', TSO_Name: 'TSO One', TSO_Phone: '01700000000', RSM_ID: 'RSM01', RSM_Name: 'RSM One' } },
                srMap: {},
                rsmMap: {},
                rsmConflicts: {}
            }),
            readDailySalesForDayBySR: () => [
                { SR_ID: 'SR01', Sales_Volume: 0 }
            ],
            readReminderSystemCache: () => ({}),
            writePendingSRs: () => {},
            writePendingTSOs: () => {},
            writeMessageQueue: rows => { writtenQueue = rows; },
            writeLog: () => {},
            writeReminderSystemCache: () => {}
        },
        CleanupService: { runCleanup: () => ({}) },
        AttendanceService: { updateAttendance: () => ({}) },
        VisibilityService: { applyOfficeUserModeVisibility: () => {} },
        DashboardService: { refreshDashboard: () => {} },
        Utilities: {
            getUuid: () => 'uuid-1',
            formatDate: DateUtils.formatDate
        }
    };

    vm.runInNewContext(source + '\nthis.__ReminderService = ReminderService;', context);
    context.__ReminderService.processReminders();

    assert.equal(writtenQueue.length, 1);
    const recipientPhone = writtenQueue[0][4]; // Recipient_Phone column

    // Must be redirected to 8801899999999, NOT real TSO phone 01700000000
    assert.equal(recipientPhone, '8801899999999');
});
