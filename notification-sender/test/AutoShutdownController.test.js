const test = require('node:test');
const assert = require('node:assert/strict');
const AutoShutdownController = require('../src/shutdown/AutoShutdownController');

class FakeSheetService {
    constructor(records = [], settings = {}) {
        this.records = records.map(record => ({ ...record }));
        this.settings = { ...settings };
        this.settingsUpdates = [];
        this.queueUpdates = [];
    }

    async updateSettings(values) {
        this.settingsUpdates.push({ ...values });
        Object.assign(this.settings, values);
        return true;
    }

    async readQueueRecords() {
        return this.records.map(record => ({ ...record }));
    }

    async updateQueueResult(sheetName, rowIndex, values) {
        this.queueUpdates.push({ sheetName, rowIndex, values: { ...values } });
        const record = this.records.find(item => item.rowIndex === rowIndex);
        if (!record) throw new Error('Queue row not found');
        record.status = values.status;
        record.retryCount = values.retryCount;
    }
}

function initialSettings(overrides = {}) {
    return {
        AUTO_SHUTDOWN_ENABLED: 'TRUE',
        AUTO_SHUTDOWN_DELAY_MINUTES: '12',
        AUTO_SHUTDOWN_RUN_ACTIVE: 'TRUE',
        AUTO_SHUTDOWN_RUN_ID: 'run-1',
        AUTO_SHUTDOWN_RUN_PHASE: 'QUEUED',
        AUTO_SHUTDOWN_RUN_QUEUE_IDS: JSON.stringify(['q1', 'q2']),
        AUTO_SHUTDOWN_LAST_QUEUE_ID: 'q2',
        AUTO_SHUTDOWN_FINAL_CHECK_AT: '',
        AUTO_SHUTDOWN_PENDING_UNTIL: '',
        AUTO_SHUTDOWN_RETRY_USED: 'FALSE',
        AUTO_SHUTDOWN_CANCEL_REASON: '',
        Sender_Status: 'Running',
        ...overrides
    };
}

function runtimeFrom(sheet) {
    const value = key => sheet.settings[key];
    return {
        queueSheet: 'Message_Queue',
        senderStatus: value('Sender_Status') || '',
        autoShutdownEnabled: String(value('AUTO_SHUTDOWN_ENABLED')).toUpperCase() === 'TRUE',
        autoShutdownDelayMinutes: parseInt(value('AUTO_SHUTDOWN_DELAY_MINUTES'), 10) || 12,
        autoShutdownRunActive: String(value('AUTO_SHUTDOWN_RUN_ACTIVE')).toUpperCase() === 'TRUE',
        autoShutdownRunId: value('AUTO_SHUTDOWN_RUN_ID') || '',
        autoShutdownRunPhase: value('AUTO_SHUTDOWN_RUN_PHASE') || 'IDLE',
        autoShutdownRunQueueIds: value('AUTO_SHUTDOWN_RUN_QUEUE_IDS') || '[]',
        autoShutdownLastQueueId: value('AUTO_SHUTDOWN_LAST_QUEUE_ID') || '',
        autoShutdownFinalCheckAt: value('AUTO_SHUTDOWN_FINAL_CHECK_AT') || '',
        autoShutdownPendingUntil: value('AUTO_SHUTDOWN_PENDING_UNTIL') || '',
        autoShutdownRetryUsed: String(value('AUTO_SHUTDOWN_RETRY_USED')).toUpperCase() === 'TRUE'
    };
}

function harness(records, settings = initialSettings()) {
    const sheet = new FakeSheetService(records, settings);
    const logs = [];
    const logger = {
        info: message => logs.push(message),
        warn: message => logs.push(message),
        error: message => logs.push(message)
    };
    const clock = { value: Date.parse('2026-08-22T08:00:00.000Z') };
    let shutdownCalls = 0;
    const controller = () => new AutoShutdownController({
        sheetService: sheet,
        logger,
        shutdownExecutor: async () => { shutdownCalls++; },
        now: () => clock.value
    });
    return {
        sheet,
        logs,
        clock,
        controller,
        shutdownCalls: () => shutdownCalls
    };
}

const sentRun = () => [
    { queueId: 'q1', status: 'SENT', retryCount: 0, rowIndex: 2 },
    { queueId: 'q2', status: 'SENT', retryCount: 0, rowIndex: 3 }
];

test('TEST 1: Auto Shutdown OFF never executes shutdown', async () => {
    const h = harness(sentRun(), initialSettings({ AUTO_SHUTDOWN_ENABLED: 'FALSE' }));
    const result = await h.controller().tick(runtimeFrom(h.sheet));
    assert.equal(result.action, 'cancelled');
    assert.equal(h.shutdownCalls(), 0);
    assert.equal(h.sheet.settings.AUTO_SHUTDOWN_RUN_PHASE, 'CANCELLED');
});

test('TEST 2: successful scheduled run starts an exact 12-minute countdown', async () => {
    const h = harness(sentRun());
    const result = await h.controller().tick(runtimeFrom(h.sheet));
    assert.equal(result.action, 'countdown-started');
    assert.equal(
        h.sheet.settings.AUTO_SHUTDOWN_PENDING_UNTIL,
        new Date(h.clock.value + 12 * 60 * 1000).toISOString()
    );
    assert.equal(h.shutdownCalls(), 0);
});

test('TEST 3: a failed final message is retried exactly once', async () => {
    const records = sentRun();
    records[1].status = 'FAILED';
    records[1].retryCount = 3;
    const h = harness(records);
    const controller = h.controller();

    const first = await controller.tick(runtimeFrom(h.sheet));
    assert.equal(first.action, 'final-retry-armed');
    assert.equal(h.sheet.queueUpdates.length, 1);
    assert.equal(h.sheet.records[1].status, 'PENDING');
    assert.equal(h.sheet.settings.AUTO_SHUTDOWN_RETRY_USED, 'TRUE');

    h.sheet.records[1].status = 'FAILED';
    const second = await controller.tick(runtimeFrom(h.sheet));
    assert.equal(second.action, 'countdown-started');
    assert.equal(h.sheet.queueUpdates.length, 1);
});

test('TEST 4: a failed final retry still starts the countdown', async () => {
    const records = sentRun();
    records[1].status = 'FAILED';
    const h = harness(records, initialSettings({ AUTO_SHUTDOWN_RETRY_USED: 'TRUE' }));
    const result = await h.controller().tick(runtimeFrom(h.sheet));
    assert.equal(result.action, 'countdown-started');
    assert.equal(h.shutdownCalls(), 0);
});

test('TEST 5: a new pending message during countdown cancels shutdown', async () => {
    const pendingUntil = '2026-08-22T08:12:00.000Z';
    const records = sentRun().concat({
        queueId: 'new-message',
        status: 'PENDING',
        retryCount: 0,
        rowIndex: 4
    });
    const h = harness(records, initialSettings({
        AUTO_SHUTDOWN_RUN_ACTIVE: 'FALSE',
        AUTO_SHUTDOWN_RUN_PHASE: 'COUNTDOWN',
        AUTO_SHUTDOWN_PENDING_UNTIL: pendingUntil
    }));
    const result = await h.controller().tick(runtimeFrom(h.sheet));
    assert.equal(result.action, 'cancelled');
    assert.equal(h.shutdownCalls(), 0);
});

test('TEST 6: disabling Auto Shutdown during countdown cancels shutdown', async () => {
    const h = harness(sentRun(), initialSettings({
        AUTO_SHUTDOWN_ENABLED: 'FALSE',
        AUTO_SHUTDOWN_RUN_ACTIVE: 'FALSE',
        AUTO_SHUTDOWN_RUN_PHASE: 'COUNTDOWN',
        AUTO_SHUTDOWN_PENDING_UNTIL: '2026-08-22T08:12:00.000Z'
    }));
    const result = await h.controller().tick(runtimeFrom(h.sheet));
    assert.equal(result.action, 'cancelled');
    assert.equal(h.shutdownCalls(), 0);
});

test('TEST 7: countdown survives sender/controller restart', async () => {
    const h = harness(sentRun());
    const firstController = h.controller();
    await firstController.tick(runtimeFrom(h.sheet));

    const restartedController = h.controller();
    h.clock.value += 11 * 60 * 1000;
    const pending = await restartedController.tick(runtimeFrom(h.sheet));
    assert.equal(pending.action, 'countdown-pending');
    assert.equal(h.shutdownCalls(), 0);

    h.clock.value += 60 * 1000;
    const completed = await restartedController.tick(runtimeFrom(h.sheet));
    assert.equal(completed.action, 'shutdown-initiated');
    assert.equal(h.shutdownCalls(), 1);
});

test('TEST 8: an empty queue at worker startup never starts shutdown', async () => {
    const h = harness([], initialSettings({
        AUTO_SHUTDOWN_RUN_ACTIVE: 'FALSE',
        AUTO_SHUTDOWN_RUN_ID: '',
        AUTO_SHUTDOWN_RUN_PHASE: 'IDLE',
        AUTO_SHUTDOWN_RUN_QUEUE_IDS: '[]',
        AUTO_SHUTDOWN_LAST_QUEUE_ID: ''
    }));
    const result = await h.controller().tick(runtimeFrom(h.sheet));
    assert.equal(result.action, 'idle');
    assert.equal(h.shutdownCalls(), 0);
    assert.equal(h.sheet.settingsUpdates.length, 0);
});

test('TEST 10: final safety failure never executes shutdown', async () => {
    const records = sentRun();
    records.push({ queueId: 'other', status: 'PROCESSING', retryCount: 0, rowIndex: 4 });
    const h = harness(records, initialSettings({
        AUTO_SHUTDOWN_RUN_ACTIVE: 'FALSE',
        AUTO_SHUTDOWN_RUN_PHASE: 'COUNTDOWN',
        AUTO_SHUTDOWN_PENDING_UNTIL: '2026-08-22T08:00:00.000Z'
    }));
    const result = await h.controller().tick(runtimeFrom(h.sheet), { senderBusy: false });
    assert.equal(result.action, 'cancelled');
    assert.equal(h.shutdownCalls(), 0);
});
