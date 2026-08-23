const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { getWorkerCycleMode, initializeStartupIdle } = require('../src/app');

function loadMain(overrides = {}) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/main.js'), 'utf8');
    const context = {
        console: { log: () => {} },
        Utilities: { getUuid: () => 'workflow-1' },
        ...overrides
    };
    vm.runInNewContext(source, context);
    return context;
}

test('TEST 1/9: PC boot before Scheduler Time does not release workflow work', () => {
    assert.equal(getWorkerCycleMode({
        systemStatus: 'STOP',
        queueEnabled: true,
        whatsappEnabled: true
    }), 'IDLE');
});

test('TEST 10: startup makes WhatsApp ready but leaves worker idle', async () => {
    const updates = [];
    const calls = [];
    const result = await initializeStartupIdle({
        sheetService: { updateSettings: async values => {
            updates.push(values);
            return true;
        } },
        whatsappProvider: {
            isConnected: () => false,
            initialize: async () => calls.push('initialize'),
            connect: async () => calls.push('connect')
        },
        runtimeConfig: { whatsappEnabled: true },
        logger: { info: () => {} },
        configService: { getProviderConfig: () => ({}) }
    });

    assert.deepEqual(calls, ['initialize', 'connect']);
    assert.equal(updates[0].SYSTEM_STATUS, 'STOP');
    assert.equal(updates.at(-1).Sender_Status, 'Waiting');
    assert.equal(result.mode, 'IDLE');
});

test('startup aborts before connectivity when SYSTEM_STATUS=STOP cannot be persisted', async () => {
    const calls = [];
    await assert.rejects(
        initializeStartupIdle({
            sheetService: { updateSettings: async () => false },
            whatsappProvider: {
                isConnected: () => false,
                initialize: async () => calls.push('initialize'),
                connect: async () => calls.push('connect')
            },
            runtimeConfig: { whatsappEnabled: true },
            logger: { info: () => {} },
            configService: { getProviderConfig: () => ({}) }
        }),
        /worker startup aborted before connectivity or polling/
    );
    assert.deepEqual(calls, []);
});

test('TEST 2/3/5/6: legacy clock entry routes through copy, generation, tracking, and sender', () => {
    const calls = [];
    const context = loadMain({
        AutoShutdownRunService: {
            isScheduledTriggerEvent: event => Boolean(event && event.triggerUid),
            begin: () => ({ eligible: true, runId: 'run-1' }),
            completeGeneration: () => calls.push('track'),
            abort: () => calls.push('abort')
        },
        ReminderService: { processReminders: () => calls.push('reminders') },
        NotificationControlService: {
            stopSender: () => calls.push('stop'),
            startSender: () => calls.push('start'),
            getQueueIds: () => ['queue-1']
        }
    });
    context.copyData = () => calls.push('copy');

    context.processDailyReminders({ triggerUid: 'clock-1' });
    assert.deepEqual(calls, ['stop', 'copy', 'reminders', 'track', 'start']);
});

test('TEST 4: failed Sales Data Copy blocks reminders, sender, and shutdown tracking', () => {
    const calls = [];
    const context = loadMain({
        AutoShutdownRunService: {
            isScheduledTriggerEvent: event => Boolean(event && event.triggerUid),
            begin: () => calls.push('begin')
        },
        ReminderService: { processReminders: () => calls.push('reminders') },
        NotificationControlService: {
            stopSender: () => calls.push('stop'),
            startSender: () => calls.push('start')
        }
    });
    context.copyData = () => {
        calls.push('copy');
        throw new Error('copy failed');
    };

    assert.throws(() => context.runScheduledDailyWorkflow({ triggerUid: 'clock-1' }), /copy failed/);
    assert.deepEqual(calls, ['stop', 'copy']);
});

test('Daily Reminder failure keeps sender stopped and aborts shutdown tracking', () => {
    const calls = [];
    const context = loadMain({
        AutoShutdownRunService: {
            isScheduledTriggerEvent: event => Boolean(event && event.triggerUid),
            begin: () => ({ eligible: true, runId: 'run-1' }),
            completeGeneration: () => calls.push('track'),
            abort: () => calls.push('abort')
        },
        ReminderService: {
            processReminders: () => {
                calls.push('reminders');
                throw new Error('reminders failed');
            }
        },
        NotificationControlService: {
            stopSender: () => calls.push('stop'),
            startSender: () => calls.push('start')
        }
    });
    context.copyData = () => calls.push('copy');

    assert.throws(() => context.runScheduledDailyWorkflow({ triggerUid: 'clock-1' }), /reminders failed/);
    assert.deepEqual(calls, ['stop', 'copy', 'reminders', 'abort', 'stop']);
});

test('TEST 7: manual reminders work and never become shutdown eligible', () => {
    const calls = [];
    const context = loadMain({
        AutoShutdownRunService: {
            isScheduledTriggerEvent: () => false,
            begin: eligible => {
                calls.push(['begin', eligible]);
                return { eligible: false, runId: '' };
            },
            completeGeneration: () => calls.push('track'),
            abort: () => calls.push('abort')
        },
        ReminderService: { processReminders: () => calls.push('reminders') },
        NotificationControlService: {
            getQueueIds: () => ['manual-queue'],
            startSender: () => calls.push('start')
        }
    });

    context.processDailyReminders();
    assert.deepEqual(calls, [['begin', false], 'reminders', 'track', 'start']);
});

test('no generated messages keeps sender stopped and cannot lead to shutdown', () => {
    const calls = [];
    const context = loadMain({
        AutoShutdownRunService: {
            isScheduledTriggerEvent: event => Boolean(event && event.triggerUid),
            begin: () => ({ eligible: true, runId: 'run-empty' }),
            completeGeneration: () => calls.push('track'),
            abort: () => calls.push('abort')
        },
        ReminderService: { processReminders: () => calls.push('reminders') },
        NotificationControlService: {
            stopSender: () => calls.push('stop'),
            startSender: () => calls.push('start'),
            getQueueIds: () => []
        }
    });
    context.copyData = () => calls.push('copy');

    context.runScheduledDailyWorkflow({ triggerUid: 'clock-1' });
    assert.deepEqual(calls, ['stop', 'copy', 'reminders', 'track', 'stop']);
});

test('TEST 8: Scheduler Time replaces duplicate daily triggers with exactly one', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/config/setup.js'), 'utf8');
    const deleted = [];
    const created = [];
    const clock = 'CLOCK';
    const onEdit = 'ON_EDIT';
    const makeTrigger = (handler, eventType) => ({
        getHandlerFunction: () => handler,
        getEventType: () => eventType
    });
    const triggers = [
        makeTrigger('processDailyReminders', clock),
        makeTrigger('runScheduledDailyWorkflow', clock),
        makeTrigger('syncAttendance', clock),
        makeTrigger('processDailyReminders', onEdit)
    ];
    const builder = {
        timeBased() { return this; },
        atHour(value) { this.hour = value; return this; },
        nearMinute(value) { this.minute = value; return this; },
        everyDays(value) { this.days = value; return this; },
        inTimezone(value) { this.timezone = value; return this; },
        create() {
            created.push({
                handler: this.handler,
                hour: this.hour,
                minute: this.minute,
                days: this.days,
                timezone: this.timezone
            });
            triggers.push(makeTrigger(this.handler, clock));
        }
    };
    const context = {
        console: { log: () => {} },
        ConfigLoader: {
            load: () => ({
                Scheduler_Time: '18:25',
                Timezone: 'Asia/Dhaka',
                ENABLE_AUTO_ATTENDANCE_SYNC: 'TRUE'
            })
        },
        Session: { getScriptTimeZone: () => 'UTC' },
        ScriptApp: {
            EventType: { CLOCK: clock },
            getProjectTriggers: () => triggers,
            deleteTrigger: trigger => {
                deleted.push(trigger.getHandlerFunction());
                triggers.splice(triggers.indexOf(trigger), 1);
            },
            newTrigger: handler => Object.assign(Object.create(builder), { handler })
        }
    };
    vm.runInNewContext(source + '\nthis.__setup = EnvironmentSetup;', context);

    const status = context.__setup.installTrigger();
    assert.deepEqual(deleted, ['processDailyReminders', 'runScheduledDailyWorkflow']);
    assert.equal(created.length, 1);
    assert.deepEqual(created[0], {
        handler: 'runScheduledDailyWorkflow',
        hour: 18,
        minute: 25,
        days: 1,
        timezone: 'Asia/Dhaka'
    });
    assert.equal(status.dailyTriggerCount, 1);
    assert.equal(status.runScheduledDailyWorkflowCount, 1);
    assert.equal(status.processDailyRemindersCount, 0);
});
