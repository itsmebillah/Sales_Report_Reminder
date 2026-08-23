const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

    assert.equal(legacyLookups.length, 2);
    assert.match(source, /ensureDashboardConfigurationArea\(getSheet\(true\), snapshot\.values, true\)/);
    assert.match(source, /if \(missing\.length \|\| mismatched\.length\)/);
    assert.match(source, /if \(deleteLegacy && legacy\) ss\.deleteSheet\(legacy\)/);
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
