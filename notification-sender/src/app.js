/**
 * app.js
 * @responsibility Phase 5.2 — Google Sheets Controlled Notification Worker.
 *
 * WORKFLOW:
 * 1. Startup: Connect Google Sheets, run Queue Recovery for stalled PROCESSING records,
 *    initialize WhatsApp Web client (kept alive continuously).
 * 2. Main Loop:
 *    - Reload Settings from Google Sheets tab.
 *    - If SYSTEM_STATUS == 'STOP': Set Sender_Status = 'Waiting', sleep POLL_INTERVAL seconds.
 *    - If SYSTEM_STATUS == 'RUNNING':
 *        - Update Sender_Status = 'Running', Last_Run_Time = now.
 *        - Scan Message_Queue for PENDING records.
 *        - Claim ONE record atomically (PENDING -> PROCESSING).
 *        - Dispatch via WhatsApp Web.
 *        - Update row status (PROCESSING -> SENT / RETRY / FAILED).
 *        - Update Last_Message_Time and daily counters in Settings tab.
 * 3. Graceful Shutdown: On SIGINT/SIGTERM, write Sender_Status = 'Stopped', disconnect cleanly.
 */

const os = require('os');
const ConfigService = require('./config/ConfigService');
const GoogleSheetService = require('./services/GoogleSheetService');
const WhatsAppWebProvider = require('./providers/WhatsAppWebProvider');
const Logger = require('./utils/Logger');
const AutoShutdownController = require('./shutdown/AutoShutdownController');
const executeWindowsShutdown = require('./shutdown/WindowsShutdownExecutor');

let isKeepAliveActive = true;
let todayDateStr = new Date().toISOString().split('T')[0];
let messagesSentToday = 0;
let messagesFailedToday = 0;
let isSendingMessage = false;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    const workerId = `${os.hostname()}-${process.pid}`;

    Logger.info('================================================================');
    Logger.info('PHASE 5.2: CONTINUOUS NOTIFICATION WORKER STARTED');
    Logger.info(`Worker ID: ${workerId}`);
    Logger.info('================================================================');

    const infraConfig = ConfigService.loadInfraConfig();
    const sheetService = new GoogleSheetService();
    const whatsappProvider = new WhatsAppWebProvider();
    const autoShutdownController = new AutoShutdownController({
        sheetService,
        logger: Logger,
        shutdownExecutor: executeWindowsShutdown
    });

    // Setup graceful shutdown handlers
    const shutdown = async (signal) => {
        Logger.info(`\n[SHUTDOWN] Received ${signal}. Shutting down continuous worker...`);
        isKeepAliveActive = false;
        try {
            if (sheetService.isConnected) {
                await sheetService.updateSettings({
                    'Sender_Status': 'Stopped',
                    'Last_Run_Time': new Date().toISOString()
                });
                await sheetService.disconnect();
            }
            if (whatsappProvider.isConnected()) {
                await whatsappProvider.disconnect();
            }
        } catch (e) {
            Logger.error('[SHUTDOWN ERROR]', e.message);
        }
        Logger.info('[SHUTDOWN] Worker stopped gracefully.');
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    let isolatedTestInProgress = false;

    /**
     * Runs only when the existing PM2 process receives the explicit IPC command
     * RUN_ISOLATED_WHATSAPP_TEST. It never reads or writes Message_Queue and
     * does not enter the normal queue-processing path.
     */
    const runIsolatedWhatsAppTest = async () => {
        if (isolatedTestInProgress) {
            return { finalState: 'FAILED', error: 'An isolated WhatsApp test is already in progress.' };
        }

        isolatedTestInProgress = true;
        let ownsProviderLifecycle = false;
        let result;

        try {
            // This reads only Settings so the test always uses the configured
            // TEST_RECIPIENT_PHONE and TEST_MESSAGE, never a queue recipient.
            const testConfig = await ConfigService.reload(sheetService);
            const recipientPhone = testConfig.testRecipientPhone;
            const testMessage = testConfig.testMessage;

            if (!recipientPhone) {
                throw new Error('TEST_RECIPIENT_PHONE is not configured.');
            }
            if (!testMessage) {
                throw new Error('TEST_MESSAGE is not configured.');
            }

            if (!whatsappProvider.isConnected()) {
                ownsProviderLifecycle = true;
                const providerConfig = ConfigService.getProviderConfig('WHATSAPP_WEB');
                await whatsappProvider.initialize(providerConfig);
                await whatsappProvider.connect(120000);
            }

            Logger.info('[ISOLATED_TEST] TEST_SEND_STARTED');
            result = await whatsappProvider.send({
                recipientPhone: recipientPhone,
                message: testMessage
            });

            const finalState = result.success && result.ack >= 1
                ? 'SENT'
                : result.outcome === 'CONFIRMATION_PENDING'
                    ? 'CONFIRMATION_PENDING'
                    : 'FAILED';

            const diagnostic = {
                messageCreateCaptured: Boolean(result.messageCreateCaptured),
                messageId: result.messageId || '',
                ackReceived: Boolean(result.ackReceived),
                ackValue: result.ack !== undefined ? result.ack : '',
                providerSuccess: Boolean(result.success),
                finalState: finalState,
                error: result.error || ''
            };

            Logger.info(`[ISOLATED_TEST] MESSAGE_CREATE_CAPTURED=${diagnostic.messageCreateCaptured}`);
            Logger.info(`[ISOLATED_TEST] MESSAGE_ID=${diagnostic.messageId}`);
            Logger.info(`[ISOLATED_TEST] ACK_RECEIVED=${diagnostic.ackReceived}`);
            Logger.info(`[ISOLATED_TEST] ACK_VALUE=${diagnostic.ackValue}`);
            Logger.info(`[ISOLATED_TEST] PROVIDER_SUCCESS=${diagnostic.providerSuccess}`);
            Logger.info(`[ISOLATED_TEST] FINAL_STATE=${diagnostic.finalState}`);
            return diagnostic;
        } catch (err) {
            const diagnostic = {
                messageCreateCaptured: false,
                messageId: '',
                ackReceived: false,
                ackValue: '',
                providerSuccess: false,
                finalState: 'FAILED',
                error: err.message
            };
            Logger.error(`[ISOLATED_TEST] FINAL_STATE=FAILED (${err.message})`);
            return diagnostic;
        } finally {
            if (ownsProviderLifecycle && whatsappProvider.isConnected()) {
                await whatsappProvider.disconnect();
            }
            isolatedTestInProgress = false;
        }
    };

    // PM2 delivers custom IPC payloads either directly or in data. This handler
    // is deliberately inert unless the exact explicit command is received.
    process.on('message', async (ipcMessage) => {
        const command = typeof ipcMessage === 'string'
            ? ipcMessage
            : ipcMessage && (ipcMessage.command || (ipcMessage.data && (ipcMessage.data.command || ipcMessage.data)));
        if (command !== 'RUN_ISOLATED_WHATSAPP_TEST') return;

        const diagnostic = await runIsolatedWhatsAppTest();
        if (typeof process.send === 'function') {
            process.send({ type: 'ISOLATED_WHATSAPP_TEST_RESULT', data: diagnostic });
        }
    });

    try {
        // Step 1: Connect to Google Sheets API
        Logger.info('Step 1: Connecting to Google Sheets API...');
        await sheetService.connect(infraConfig);
        let runtimeConfig = await ConfigService.reload(sheetService);

        // Step 2: Queue Recovery on Startup (scans for stalled PROCESSING records > 10 mins old)
        Logger.info('Step 2: Running Queue Recovery scan for stalled PROCESSING records...');
        const recoveryResult = await sheetService.recoverStalledQueue(runtimeConfig.queueSheet || 'Message_Queue', 10);
        if (recoveryResult.recovered > 0) {
            Logger.warn(`⚠️ [QUEUE RECOVERY] Recovered ${recoveryResult.recovered} stalled PROCESSING record(s) -> RETRY:`);
            recoveryResult.details.forEach(d => {
                Logger.warn(`   • Queue ID: ${d.queueId} (Row ${d.rowNumber}) - Stale since: ${d.staleSince}`);
            });
        } else {
            Logger.info('✓ Queue Recovery check complete: No stalled records found.');
        }

        // Initialize Settings status fields
        await sheetService.updateSettings({
            'Sender_Status': 'Starting',
            'Last_Run_Time': new Date().toISOString()
        });

        Logger.info('✓ Initialization complete. Entering main polling loop...');

        // Step 3: Main Continuous Polling Loop
        while (isKeepAliveActive) {
            try {
                // Reload dynamic runtime settings on every iteration
                runtimeConfig = await ConfigService.reload(sheetService);
                const systemStatus = String(runtimeConfig.systemStatus || 'STOP').toUpperCase();
                const pollIntervalMs = (runtimeConfig.pollInterval || 10) * 1000;
                const queueSheetName = runtimeConfig.queueSheet || 'Message_Queue';

                // Check calendar day shift to reset daily counters
                const currentDateStr = new Date().toISOString().split('T')[0];
                if (currentDateStr !== todayDateStr) {
                    todayDateStr = currentDateStr;
                    messagesSentToday = 0;
                    messagesFailedToday = 0;
                }

                // Persistent auto-shutdown state is checked independently of
                // whether the queue happens to be empty in this polling cycle.
                const shutdownResult = await autoShutdownController.tick(runtimeConfig, {
                    queueSheetName,
                    senderBusy: isSendingMessage
                });
                if (shutdownResult.action === 'shutdown-initiated') {
                    await sleep(pollIntervalMs);
                    continue;
                }

                // ── GATE 1: SYSTEM_STATUS == STOP ──
                if (systemStatus === 'STOP') {
                    Logger.info(`[SYSTEM_STATUS: STOP] Worker sleeping for ${runtimeConfig.pollInterval}s...`);
                    await sheetService.updateSettings({
                        'Sender_Status': 'Waiting',
                        'Last_Run_Time': new Date().toISOString()
                    });
                    await sleep(pollIntervalMs);
                    continue;
                }

                // ── GATE 2: Toggles Disabled ──
                if (!runtimeConfig.queueEnabled || !runtimeConfig.whatsappEnabled) {
                    Logger.info(`[WORKER PAUSED] Queue or WhatsApp disabled in Settings. Sleeping for ${runtimeConfig.pollInterval}s...`);
                    await sheetService.updateSettings({
                        'Sender_Status': 'Paused',
                        'Last_Run_Time': new Date().toISOString()
                    });
                    await sleep(pollIntervalMs);
                    continue;
                }

                // ── SYSTEM_STATUS == RUNNING ──
                await sheetService.updateSettings({
                    'Sender_Status': 'Running',
                    'Last_Run_Time': new Date().toISOString()
                });

                // Ensure WhatsApp Client is connected
                if (!whatsappProvider.isConnected()) {
                    Logger.info('[WHATSAPP INITIALIZING] Connecting WhatsApp Web browser...');
                    await sheetService.updateSettings({ 'Sender_Status': 'Starting' });
                    const providerConfig = ConfigService.getProviderConfig('WHATSAPP_WEB');
                    await whatsappProvider.initialize(providerConfig);
                    await whatsappProvider.connect(120000);
                    Logger.info('✓ WhatsApp Web Client connected and ready!');
                    await sheetService.updateSettings({ 'Sender_Status': 'Running' });
                }

                // Read PENDING records from queue sheet
                const pendingRecords = await sheetService.readPendingQueue(queueSheetName);

                if (!pendingRecords || pendingRecords.length === 0) {
                    Logger.info(`[QUEUE IDLE] No PENDING records in "${queueSheetName}". Sleeping for ${runtimeConfig.pollInterval}s...`);
                    await sheetService.updateSettings({
                        'Sender_Status': 'Waiting',
                        'Last_Run_Time': new Date().toISOString()
                    });
                    await sleep(pollIntervalMs);
                    continue;
                }

                // Process exactly ONE queue item per cycle sequentially
                const queueRecord = pendingRecords[0];

                if (queueRecord && isKeepAliveActive) {
                    Logger.info(`Attempting atomic claim for Queue ID: ${queueRecord.queueId} (Row ${queueRecord.rowIndex})...`);
                    const claimResult = await sheetService.claimQueueRecord(queueSheetName, queueRecord.rowIndex, workerId);

                    if (claimResult.success) {
                        Logger.info(`✓ [CLAIM SUCCESS] Row ${queueRecord.rowIndex} locked. Sending message...`);
                        await sheetService.updateSettings({
                            'Sender_Status': 'Sending',
                            'Last_Run_Time': new Date().toISOString()
                        });

                        // Send WhatsApp message (blocks for up to 30s while ACK == 0)
                        let sendResult;
                        isSendingMessage = true;
                        try {
                            sendResult = await whatsappProvider.send({
                                recipientPhone: queueRecord.recipientPhone,
                                message: queueRecord.message
                            });
                        } finally {
                            isSendingMessage = false;
                        }

                        const nowIso = new Date().toISOString();

                        if (sendResult.success && sendResult.ack >= 1) {
                            await sheetService.updateQueueResult(queueSheetName, queueRecord.rowIndex, {
                                status: 'SENT',
                                sentAt: sendResult.timestamp || nowIso,
                                messageId: sendResult.messageId || '',
                                ack: sendResult.ack,
                                errorMessage: '',
                                retryCount: queueRecord.retryCount || 0
                            });
                            messagesSentToday++;
                            Logger.info(`✓ [SENT] Queue ID: ${queueRecord.queueId} | Row ${queueRecord.rowIndex} | ACK: ${sendResult.ack}`);
                            await sheetService.updateSettings({
                                'Sender_Status': 'Running',
                                'Last_Run_Time': nowIso,
                                'Last_Message_Time': nowIso,
                                'Messages_Sent_Today': String(messagesSentToday)
                            });

                        } else if (sendResult.outcome === 'CONFIRMATION_PENDING') {
                            // Dispatch was completed, but no ACK was received in 30s.
                            // Mark as SENT to prevent duplicate retries, preserving the warning log.
                            const diagnostic = sendResult.error || 'Dispatch was attempted, but delivery confirmation could not be correlated safely. Automatic retry is blocked to prevent a duplicate message.';
                            await sheetService.updateQueueResult(queueSheetName, queueRecord.rowIndex, {
                                status: 'SENT',
                                sentAt: sendResult.timestamp || nowIso,
                                messageId: sendResult.messageId || '',
                                ack: sendResult.ack !== undefined ? sendResult.ack : 0,
                                errorMessage: diagnostic,
                                retryCount: queueRecord.retryCount || 0
                            });
                            messagesSentToday++;
                            Logger.warn(`⚠️ [SENT (CONFIRMATION_PENDING)] Queue ID: ${queueRecord.queueId} | Row ${queueRecord.rowIndex} | ACK: ${sendResult.ack !== undefined ? sendResult.ack : 0} -> ${diagnostic}`);
                            await sheetService.updateSettings({
                                'Sender_Status': 'Running',
                                'Last_Run_Time': nowIso,
                                'Last_Message_Time': nowIso,
                                'Messages_Sent_Today': String(messagesSentToday)
                            });

                        } else {
                            const nextRetry = (queueRecord.retryCount || 0) + 1;
                            const newStatus = nextRetry >= (runtimeConfig.maxRetry || 3) ? 'FAILED' : 'RETRY';
                            const errorReason = sendResult.error || `Delivery timeout: ACK remained at ${sendResult.ack || 0} (0 = PENDING/CLOCK) after 30 seconds.`;
                            await sheetService.updateQueueResult(queueSheetName, queueRecord.rowIndex, {
                                status: newStatus,
                                sentAt: '', // Do NOT save Sent_At for unacknowledged/failed delivery
                                messageId: sendResult.messageId || '',
                                ack: sendResult.ack !== undefined ? sendResult.ack : 0,
                                errorMessage: errorReason,
                                retryCount: nextRetry
                            });
                            messagesFailedToday++;
                            Logger.warn(`⚠️ [RETRY/FAILED] Queue ID: ${queueRecord.queueId} | Row ${queueRecord.rowIndex} -> Status: ${newStatus} (Reason: ${errorReason})`);
                            await sheetService.updateSettings({
                                'Sender_Status': 'Running',
                                'Last_Run_Time': nowIso,
                                'Messages_Failed_Today': String(messagesFailedToday)
                            });
                        }
                    } else {
                        Logger.warn(`⚠️ [CLAIM SKIPPED] ${claimResult.reason}`);
                    }
                }

            } catch (cycleErr) {
                Logger.error('[WORKER CYCLE ERROR]', cycleErr.message);
                try {
                    await sheetService.updateSettings({
                        'Sender_Status': 'Error',
                        'Last_Run_Time': new Date().toISOString()
                    });
                } catch (e) {}
                await sleep(10000);
            }
        }

    } catch (fatalErr) {
        Logger.error('Fatal Worker Error:', fatalErr.message);
        if (sheetService && sheetService.isConnected) {
            try {
                await sheetService.updateSettings({
                    'Sender_Status': 'Error',
                    'Last_Run_Time': new Date().toISOString()
                });
                await sheetService.disconnect();
            } catch (e) {}
        }
        if (whatsappProvider && whatsappProvider.isConnected()) {
            await whatsappProvider.disconnect();
        }
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };

