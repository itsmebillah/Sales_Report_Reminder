const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadService() {
    const sourcePath = path.resolve(__dirname, '../../src/services/AutoShutdownRunService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const settings = {
        AUTO_SHUTDOWN_ENABLED: 'TRUE',
        AUTO_SHUTDOWN_RUN_ACTIVE: 'TRUE',
        AUTO_SHUTDOWN_RUN_ID: 'previous-run',
        AUTO_SHUTDOWN_PENDING_UNTIL: '2026-08-22T08:12:00.000Z'
    };
    const logs = [];
    const context = {
        console: { log: message => logs.push(message) },
        JSON,
        Utilities: { getUuid: () => 'scheduled-run-id' },
        NotificationControlService: {
            getSetting: key => settings[key] || '',
            updateSettings: values => Object.assign(settings, values),
            getQueueIds: () => ['q1', 'q2']
        }
    };
    vm.runInNewContext(
        source + '\nthis.__service = AutoShutdownRunService;',
        context,
        { filename: sourcePath }
    );
    return { service: context.__service, settings, logs };
}

test('TEST 9: manual Run Daily Reminders never arms shutdown', () => {
    const h = loadService();
    assert.equal(h.service.isScheduledTriggerEvent(undefined), false);
    assert.equal(h.service.isScheduledTriggerEvent({}), false);
    assert.equal(h.service.isScheduledTriggerEvent({ triggerUid: 'clock-trigger' }), true);

    const result = h.service.begin(false);
    assert.equal(result.eligible, false);
    assert.equal(h.settings.AUTO_SHUTDOWN_RUN_ACTIVE, 'FALSE');
    assert.equal(h.settings.AUTO_SHUTDOWN_RUN_PHASE, 'MANUAL_RUN');
    assert.equal(h.settings.AUTO_SHUTDOWN_PENDING_UNTIL, '');
});
