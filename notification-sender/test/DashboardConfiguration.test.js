const test = require('node:test');
const assert = require('node:assert/strict');

const GoogleSheetService = require('../src/services/GoogleSheetService');
const ConfigService = require('../src/config/ConfigService');

test('Node worker reads configuration from the C:E and F:H Dashboard panels', async () => {
    const service = new GoogleSheetService();
    const reads = [];
    service.isConnected = true;
    service.spreadsheetId = 'sheet-id';
    service.sheets = {
        spreadsheets: {
            values: {
                get: async request => {
                    reads.push(request.range);
                    return {
                        data: {
                            values: [
                                ['SYSTEM CONFIGURATION & CONTROLS', '', '', '', '', ''],
                                ['Scheduler Time', '17:30', 'Scheduler_Time', 'Auto PC Shutdown', true, 'AUTO_SHUTDOWN_ENABLED'],
                                ['WhatsApp Sender Enabled', true, 'WHATSAPP_ENABLED', 'Shutdown Delay', 12, 'AUTO_SHUTDOWN_DELAY_MINUTES']
                            ]
                        }
                    };
                }
            }
        }
    };

    const config = await service.readConfiguration();

    assert.deepEqual(reads, ['Dashboard!C1:H']);
    assert.equal(config.Scheduler_Time, '17:30');
    assert.equal(config.WHATSAPP_ENABLED, true);
    assert.equal(config.AUTO_SHUTDOWN_ENABLED, true);
    assert.equal(config.AUTO_SHUTDOWN_DELAY_MINUTES, 12);
});

test('Node worker updates existing Dashboard values and preserves stable key column', async () => {
    const service = new GoogleSheetService();
    const batches = [];
    service.isConnected = true;
    service.spreadsheetId = 'sheet-id';
    service.sheets = {
        spreadsheets: {
            values: {
                get: async () => ({
                    data: {
                        values: [
                            ['SYSTEM CONFIGURATION & CONTROLS', '', '', '', '', ''],
                            ['', '', '', 'System Status', 'STOP', 'SYSTEM_STATUS'],
                            ['', '', '', 'Sender Status', 'Waiting', 'Sender_Status']
                        ]
                    }
                })
            }
        }
    };
    service.batchUpdate = async updates => batches.push(updates);

    const updated = await service.updateSettings({
        SYSTEM_STATUS: 'RUNNING',
        Sender_Status: 'Running'
    });

    assert.equal(updated, true);
    assert.deepEqual(batches, [[
        { range: 'Dashboard!G2', values: [['RUNNING']] },
        { range: 'Dashboard!G3', values: [['Running']] }
    ]]);
});

test('ConfigService consumes the Dashboard repository and preserves production controls', async () => {
    const runtime = await ConfigService.reload({
        readConfiguration: async () => ({
            Scheduler_Time: '17:30',
            WHATSAPP_ENABLED: true,
            SYSTEM_STATUS: 'STOP',
            AUTO_SHUTDOWN_ENABLED: true,
            AUTO_SHUTDOWN_DELAY_MINUTES: 12,
            MAX_RETRY: 2
        })
    });

    assert.equal(runtime.whatsappEnabled, true);
    assert.equal(runtime.systemStatus, 'STOP');
    assert.equal(runtime.autoShutdownEnabled, true);
    assert.equal(runtime.autoShutdownDelayMinutes, 12);
    assert.equal(runtime.maxRetry, 2);
});
