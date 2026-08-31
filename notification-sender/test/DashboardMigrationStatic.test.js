const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

test('runtime code has no range dependency on the legacy Settings tab', () => {
    const runtimeFiles = [
        'src/config/constants.js',
        'src/config/setup.js',
        'src/main.js',
        'src/services/AttendanceService.js',
        'src/services/DashboardService.js',
        'src/services/NotificationControlService.js',
        'notification-sender/src/services/GoogleSheetService.js',
        'notification-sender/src/config/ConfigService.js'
    ];

    runtimeFiles.forEach(file => {
        const source = read(file);
        assert.doesNotMatch(source, /Settings![A-Z]/, `${file} still contains a Settings range`);
    });

    assert.match(read('src/config/constants.js'), /ConfigurationService\.readMap\(\)/);
    assert.match(read('notification-sender/src/services/GoogleSheetService.js'), /Dashboard!C1:H/);
});

test('legacy Settings lookups are isolated to verified migration/bootstrap paths', () => {
    const source = read('src/services/ConfigurationService.js');
    const legacyLookups = source.match(/getSheetByName\('Settings'\)/g) || [];

    assert.equal(legacyLookups.length, 3);
    assert.match(source, /ensureDashboardConfigurationArea\(getSheet\(true\), snapshot\.values, true\)/);
    assert.match(source, /if \(missing\.length \|\| mismatched\.length\)/);
    assert.match(source, /if \(deleteLegacy && legacy\) ss\.deleteSheet\(legacy\)/);
    assert.match(read('src/config/setup.js'), /ConfigurationService\.removeLegacySettingsAfterMigration\(\)/);
});

function loadRemovalHarness({ dashboardRows, legacyRows }) {
    let dashboardWriteCount = 0;
    let deletedSheet = null;
    const dashboardSheet = {
        getLastRow: () => dashboardRows.length,
        getRange: () => ({
            getValues: () => dashboardRows,
            setValue: () => { dashboardWriteCount++; },
            setValues: () => { dashboardWriteCount++; },
            clearContent: () => { dashboardWriteCount++; }
        })
    };
    const legacySheet = { getDataRange: () => ({ getValues: () => legacyRows }) };
    const spreadsheet = {
        getSheetByName: name => name === 'Dashboard' ? dashboardSheet : (name === 'Settings' ? legacySheet : null),
        deleteSheet: sheet => { deletedSheet = sheet; }
    };
    const context = {
        SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
        ConfigLoader: { invalidate: () => {} },
        console: { log: () => {} }
    };
    vm.runInNewContext(
        `${read('src/services/ConfigurationService.js')}\n;globalThis.__configurationService = ConfigurationService;`,
        context
    );
    return {
        service: context.__configurationService,
        dashboardWriteCount: () => dashboardWriteCount,
        deletedSheet: () => deletedSheet,
        legacySheet
    };
}

test('safe legacy removal preserves authoritative Dashboard SYSTEM_STATUS', () => {
    const dashboardRows = [['Worker Gate', 'STOP', 'SYSTEM_STATUS', '', '', '']];
    const harness = loadRemovalHarness({
        dashboardRows,
        legacyRows: [['Key', 'Value'], ['SYSTEM_STATUS', 'RUNNING']]
    });

    const result = harness.service.removeLegacySettingsAfterMigration();

    assert.equal(dashboardRows[0][1], 'STOP');
    assert.equal(harness.dashboardWriteCount(), 0);
    assert.equal(harness.deletedSheet(), harness.legacySheet);
    assert.equal(result.legacyRemoved, true);
    assert.equal(result.verifiedKeys, 1);
});

test('legacy Sender_Status and Last_Run_Time differences do not block safe removal', () => {
    const dashboardRows = [
        ['Sender Runtime Status', 'Waiting', 'Sender_Status', '', '', ''],
        ['Last Worker Heartbeat', '2026-08-23T09:30:00.000Z', 'Last_Run_Time', '', '', '']
    ];
    const harness = loadRemovalHarness({
        dashboardRows,
        legacyRows: [
            ['Key', 'Value'],
            ['Sender_Status', 'Running'],
            ['Last_Run_Time', '2026-08-23T07:35:35.416Z']
        ]
    });

    const result = harness.service.removeLegacySettingsAfterMigration();

    assert.equal(dashboardRows[0][1], 'Waiting');
    assert.equal(dashboardRows[1][1], '2026-08-23T09:30:00.000Z');
    assert.equal(harness.dashboardWriteCount(), 0);
    assert.equal(harness.deletedSheet(), harness.legacySheet);
    assert.equal(result.legacyRemoved, true);
    assert.equal(result.verifiedKeys, 2);
});

test('safe legacy removal aborts without deletion when a legacy key is missing from Dashboard', () => {
    const harness = loadRemovalHarness({
        dashboardRows: [['Worker Gate', 'STOP', 'SYSTEM_STATUS', '', '', '']],
        legacyRows: [['Key', 'Value'], ['SYSTEM_STATUS', 'RUNNING'], ['Scheduler_Time', '17:30']]
    });

    assert.throws(
        () => harness.service.removeLegacySettingsAfterMigration(),
        /Missing Dashboard keys: Scheduler_Time/
    );
    assert.equal(harness.dashboardWriteCount(), 0);
    assert.equal(harness.deletedSheet(), null);
});

test('Dashboard refresh preserves A:B and required production keys remain represented', () => {
    const dashboard = read('src/services/DashboardService.js');
    const repository = read('src/services/ConfigurationService.js');

    assert.doesNotMatch(dashboard, /sheet\.clear\(\)/);
    assert.match(dashboard, /getRange\(1, 1, sheet\.getMaxRows\(\), 2\)/);
    assert.match(dashboard, /ensureDashboardConfigurationArea\(sheet\)/);

    [
        'Scheduler_Time',
        'Timezone',
        'WHATSAPP_ENABLED',
        'SYSTEM_STATUS',
        'AUTO_SHUTDOWN_ENABLED',
        'AUTO_SHUTDOWN_DELAY_MINUTES',
        'AUTO_SHUTDOWN_RUN_PHASE',
        'AUTO_SHUTDOWN_RUN_QUEUE_IDS',
        'LAST_ATTENDANCE_SYNC',
        'LAST_SALES_STATE'
    ].forEach(key => assert.match(repository, new RegExp(`\\['${key}'`), `${key} missing from Dashboard schema`));
});

test('Dashboard configuration renders compact left/right panels and fixes date displays', () => {
    const repository = read('src/services/ConfigurationService.js');
    const main = read('src/main.js');

    assert.match(repository, /RIGHT_START_COLUMN = 6/);
    assert.match(repository, /RIGHT_VALUE_COLUMN = 7/);
    assert.match(repository, /RIGHT_KEY_COLUMN = 8/);
    assert.match(repository, /STORAGE_START_ROW = 100/);
    assert.match(repository, /setNumberFormat\('HH:mm'\)/);
    assert.match(repository, /setNumberFormat\('dd-mmm-yyyy hh:mm:ss'\)/);
    assert.match(repository, /item.type === 'countStatus'/);
    assert.match(repository, /'actionButton'/);
    assert.match(main, /editedColumn !== 4 && editedColumn !== 7/);
    assert.match(main, /action === 'OPEN CONTROL'/);
});

test('Dashboard UI summaries and dynamic status formatting remain presentation-only', () => {
    const repository = read('src/services/ConfigurationService.js');
    const dashboard = read('src/services/DashboardService.js');

    assert.match(repository, /Scheduler Status \/ Configured Run/);
    assert.match(repository, /Queue Status \/ Today/);
    assert.match(repository, /schedulerSummaryFormula/);
    assert.match(repository, /queueSummaryFormula/);
    assert.match(repository, /E\/H stay blank/);
    assert.match(repository, /whenNumberGreaterThan\(0\)/);
    assert.match(repository, /AUTO_SHUTDOWN_RUN_PHASE/);
    assert.match(repository, /countdownFormula/);
    assert.match(repository, /setHiddenGridlines\(true\)/);
    assert.match(repository, /setColumnWidth\(KEY_COLUMN, 28\)/);
    assert.match(repository, /setColumnWidth\(RIGHT_KEY_COLUMN, 28\)/);
    assert.match(dashboard, /const sectionRows = \[4, 10, 18, 27, 31\]/);
    assert.match(dashboard, /getRange\(1, 1, rows\.length, 2\)\s*\.setFontFamily/);
});

test('Dashboard compactness uses fixed row heights and wraps technical columns', () => {
    const repository = read('src/services/ConfigurationService.js');
    const dashboard = read('src/services/DashboardService.js');

    assert.match(repository, /setRowHeightsForced\(1, visibleRows, 31\)/);
    assert.match(dashboard, /setRowHeightsForced\(1, rows\.length, 31\)/);
    assert.match(repository, /setWrapStrategy\(SpreadsheetApp\.WrapStrategy\.WRAP\)/);
    assert.match(dashboard, /setWrapStrategy\(SpreadsheetApp\.WrapStrategy\.WRAP\)/);
    assert.doesNotMatch(repository, /setVerticalAlignment\('middle'\)\.setWrap\(true\)/);
    assert.match(repository, /hideColumns\(KEY_COLUMN\)/);
    assert.match(repository, /hideColumns\(RIGHT_KEY_COLUMN\)/);
    assert.match(dashboard, /const screenFitLastRow = 36/);
    assert.match(dashboard, /hideRows\(screenFitLastRow \+ 1, rows\.length - screenFitLastRow\)/);
});

test('only required Node runtime values are added to Dashboard unprotected ranges', () => {
    const repository = read('src/services/ConfigurationService.js');
    [
        'SYSTEM_STATUS',
        'Sender_Status',
        'Last_Run_Time',
        'Last_Message_Time',
        'Messages_Sent_Today',
        'Messages_Failed_Today',
        'REMINDER_SENDER_DRAINED_AT'
    ].forEach(key => assert.match(repository, new RegExp(`'${key}'`)));
    assert.match(repository, /NODE_WRITABLE_KEYS\.has\(item\.key\)/);
    assert.match(repository, /setUnprotectedRanges\(editableRanges\)/);
});

test('Scheduler picker and Auto Shutdown controls still use their existing handlers', () => {
    const main = read('src/main.js');
    assert.match(main, /createHtmlOutputFromFile\('SchedulerTimePicker'\)/);
    assert.match(main, /ConfigurationService\.updateSetting\('Scheduler_Time', normalizedTime\)/);
    assert.match(main, /createHtmlOutputFromFile\('AutoShutdownSettings'\)/);
    assert.match(main, /saveAutoShutdownEnabled/);
    assert.match(main, /saveAutoShutdownDelay/);
});
