const test = require('node:test');
const assert = require('node:assert/strict');
const GoogleSheetService = require('../src/services/GoogleSheetService');

test('existing RETRY records remain claimable by the normal retry flow', async () => {
    const service = new GoogleSheetService();
    service.isConnected = true;
    service.spreadsheetId = 'sheet-id';
    service.sheets = {
        spreadsheets: {
            values: {
                get: async () => ({
                    data: {
                        values: [
                            ['Queue_ID', 'Timestamp', 'Provider', 'Recipient_Name', 'Recipient_Phone', '', '', '', '', '', '', 'Message_Body', 'Status', 'Retry_Count'],
                            ['retry-q', '', 'WHATSAPP_WEB', 'Recipient', '8801000000000', '', '', '', '', '', '', 'Message', 'RETRY', '2']
                        ]
                    }
                })
            }
        }
    };

    const records = await service.readPendingQueue('Message_Queue');
    assert.equal(records.length, 1);
    assert.equal(records[0].queueId, 'retry-q');
    assert.equal(records[0].status, 'RETRY');
    assert.equal(records[0].retryCount, 2);
});

test('atomic claim accepts RETRY and still verifies PROCESSING', async () => {
    const service = new GoogleSheetService();
    service.isConnected = true;
    service.spreadsheetId = 'sheet-id';
    service.ensureQueueHeaders = async () => ({
        Queue_ID: 0,
        Status: 12,
        Retry_Count: 13,
        Processing_Started_At: 19,
        Worker_ID: 20
    });
    service.batchUpdate = async () => {};

    let readCount = 0;
    service.sheets = {
        spreadsheets: {
            values: {
                get: async () => {
                    readCount++;
                    return { data: { values: [[readCount === 1 ? 'RETRY' : 'PROCESSING']] } };
                }
            }
        }
    };

    const result = await service.claimQueueRecord('Message_Queue', 2, 'worker-1');
    assert.equal(result.success, true);
    assert.equal(result.workerId, 'worker-1');
});
