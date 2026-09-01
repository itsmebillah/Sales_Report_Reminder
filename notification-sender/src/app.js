/**
 * app.js
 * @responsibility Phase 5.2 — Google Sheets Controlled Notification Worker.
 *
 * WORKFLOW:
 * 1. Startup: Connect Google Sheets, run Queue Recovery for stalled PROCESSING records,
 *    initialize WhatsApp Web client (kept alive continuously).
 * 2. Main Loop:
 *    - Reload runtime configuration from Dashboard C:E.
 *    - If SYSTEM_STATUS == 'STOP': Set Sender_Status = 'Waiting', sleep POLL_INTERVAL seconds.
 *    - If SYSTEM_STATUS == 'RUNNING':
 *        - Update Sender_Status = 'Running', Last_Run_Time = now.
 *        - Scan Message_Queue for PENDING records.
 *        - Claim ONE record atomically (PENDING -> PROCESSING).
 *        - Dispatch via WhatsApp Web (respecting DRY RUN simulation & TEST MODE recipient redirection).
 *        - Update row status (PROCESSING -> SENT / RETRY / FAILED).
 *        - Update Last_Message_Time and daily counters in Dashboard configuration.
 * 3. Graceful Shutdown: On SIGINT/SIGTERM, write Sender_Status = 'Stopped', disconnect cleanly.
 */

const os = require('os');
const ConfigService = require('./config/ConfigService');
const GoogleSheetService = require('./services/GoogleSheetService');
const WhatsAppWebProvider = require('./providers/WhatsAppWebProvider');
const Logger = require('./utils/Logger');
const AutoShutdownController = require('./shutdown/AutoShutdownController');
const executeWindowsShutdown = require('./shutdown/WindowsShutdownExecutor');
const { formatBDDateTime, getBDDateStr } = require('./utils/DateFormatter');

let isKeepAliveActive = true;
let todayDateStr = getBDDateStr();
let messagesSentToday = 0;
let messagesFailedToday = 0;
let isSendingMessage = false;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getWorkerCycleMode(runtimeConfig) {
    const systemStatus = String(runtimeConfig.systemStatus || 'STOP').toUpperCase();
    if (systemStatus === 'STOP') return 'IDLE';
    if (!runtimeConfig.queueEnabled || !runtimeConfig.whatsappEnabled) return 'PAUSED';
    return 'ACTIVE';
}

async function initializeStartupIdle({
    sheetService,
    whatsappProvider,
    runtimeConfig,
    logger = Logger,
    configService = ConfigService,
    afterStop = async () => {}
}) {
    // SYSTEM_STATUS may have remained RUNNING when Windows shut down. PM2
    // startup must never interpret that persisted value as permission to work.
    const stopWriteSucceeded = await sheetService.updateSettings({
        'SYSTEM_STATUS': 'STOP',
        'Sender_Status': 'Starting',
        'Last_Run_Time': formatBDDateTime()
    });
    if (stopWriteSucceeded !== true) {
        throw new Error('[STARTUP SAFETY] Could not persist SYSTEM_STATUS=STOP; worker startup aborted before connectivity or polling.');
    }

    logger.info('[STARTUP SAFETY] SYSTEM_STATUS=STOP persisted before queue recovery.');
    await afterStop();

    if (runtimeConfig.whatsappEnabled && !whatsappProvider.isConnected()) {
        logger.info('[STARTUP] Initializing WhatsApp client without releasing the queue worker...');
        const providerConfig = configService.getProviderConfig('WHATSAPP_WEB');
        await whatsappProvider.initialize(providerConfig);
        await whatsappProvider.connect(120000);
        logger.info('✓ WhatsApp Web Client connected and ready; worker remains idle.');
    }

    const waitingWriteSucceeded = await sheetService.updateSettings({
        'Sender_Status': 'Waiting',
        'Last_Run_Time': formatBDDateTime()
    });
    if (waitingWriteSucceeded !== true) {
        throw new Error('[STARTUP SAFETY] Could not persist idle runtime status; worker startup aborted before polling.');
    }
    return { mode: 'IDLE' };
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
                    'Last_Run_Time': formatBDDateTime()
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
            // This reads only Dashboard configuration so the test uses the configured
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

        const recoverQueueAfterStop = async () => {
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
        };

        // Windows/PM2 startup initializes connectivity only. The Apps Script
        // Scheduler_Time workflow explicitly changes SYSTEM_STATUS to RUNNING.
        await initializeStartupIdle({
            sheetService,
            whatsappProvider,
            runtimeConfig,
            logger: Logger,
            afterStop: recoverQueueAfterStop
        });
        runtimeConfig = await ConfigService.reload(sheetService);

        Logger.info('✓ Initialization complete. Entering main polling loop...');

        // Step 3: Main Continuous Polling Loop
        while (isKeepAliveActive) {
            try {
                // Reload dynamic runtime settings on every iteration
                runtimeConfig = await ConfigService.reload(sheetService);
                const pollIntervalMs = (runtimeConfig.pollInterval || 10) * 1000;
                const queueSheetName = runtimeConfig.queueSheet || 'Message_Queue';
                const cycleMode = getWorkerCycleMode(runtimeConfig);

                // Check calendar day shift to reset daily counters
                const currentDateStr = getBDDateStr();
                if (currentDateStr !== todayDateStr) {
                    todayDateStr = currentDateStr;
                    messagesSentToday = 0;
                    messagesFailedToday = 0;
                }

                // ── GATE 1: SYSTEM_STATUS == STOP ──
                if (cycleMode === 'IDLE') {
                    if (runtimeConfig.senderStatus !== 'Waiting') {
                        Logger.info(`[SYSTEM_STATUS: STOP] Worker sleeping for ${runtimeConfig.pollInterval}s...`);
                        await sheetService.updateSettings({
                            'Sender_Status': 'Waiting',
                            'Last_Run_Time': formatBDDateTime()
                        });
                    }
                    await sleep(pollIntervalMs);
                    continue;
                }

                // ── GATE 2: Toggles Disabled ──
                if (cycleMode === 'PAUSED') {
                    if (runtimeConfig.senderStatus !== 'Paused') {
                        Logger.info(`[WORKER PAUSED] Queue or WhatsApp disabled in Dashboard configuration. Sleeping for ${runtimeConfig.pollInterval}s...`);
                        await sheetService.updateSettings({
                            'Sender_Status': 'Paused',
                            'Last_Run_Time': formatBDDateTime()
                        });
                    }
                    await sleep(pollIntervalMs);
                    continue;
                }

                // Auto Shutdown may advance only after Scheduler_Time (or an
                // explicit manual sender start) releases the worker gate.
                const shutdownResult = await autoShutdownController.tick(runtimeConfig, {
                    queueSheetName,
                    senderBusy: isSendingMessage
                });
                if (shutdownResult.action === 'shutdown-initiated') {
                    await sleep(pollIntervalMs);
                    continue;
                }

                // Ensure WhatsApp Client is connected
                if (!whatsappProvider.isConnected()) {
                    Logger.info('[WHATSAPP INITIALIZING] Connecting WhatsApp Web browser...');
                    await sheetService.updateSettings({ 'Sender_Status': 'Starting' });
                    const providerConfig = ConfigService.getProviderConfig('WHATSAPP_WEB');
                    await whatsappProvider.initialize(providerConfig);
                    await whatsappProvider.connect(120000);
                    Logger.info('✓ WhatsApp Web Client connected and ready!');
                    await sheetService.updateSettings({
                        'Sender_Status': 'Running',
                        'Last_Run_Time': formatBDDateTime()
                    });
                }

                // Read PENDING records from queue sheet
                const pendingRecords = await sheetService.readPendingQueue(queueSheetName);

                if (!pendingRecords || pendingRecords.length === 0) {
                    const isCountdownActive = String(runtimeConfig.autoShutdownRunPhase || '').toUpperCase() === 'COUNTDOWN';
                    if (!isCountdownActive) {
                        Logger.info(`✓ [QUEUE COMPLETED] All pending messages in "${queueSheetName}" have been processed. Auto-stopping sender (SYSTEM_STATUS -> STOP).`);
                        await sheetService.updateSettings({
                            'SYSTEM_STATUS': 'STOP',
                            'Sender_Status': 'Waiting',
                            'Last_Run_Time': formatBDDateTime()
                        });
                    } else if (runtimeConfig.senderStatus !== 'Waiting') {
                        Logger.info(`[AUTO-SHUTDOWN COUNTDOWN] Queue completed. Waiting for shutdown countdown...`);
                        await sheetService.updateSettings({
                            'Sender_Status': 'Waiting',
                            'Last_Run_Time': formatBDDateTime()
                        });
                    }
                    await sleep(pollIntervalMs);
                    continue;
                }

                // Update status to Running when there is active work to process
                if (runtimeConfig.senderStatus !== 'Running') {
                    await sheetService.updateSettings({
                        'Sender_Status': 'Running',
                        'Last_Run_Time': formatBDDateTime()
                    });
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
                            'Last_Run_Time': formatBDDateTime()
                        });

                        // Check Dry Run & Test Mode Overrides
                        let sendResult;
                        const isDryRun = Boolean(runtimeConfig.dryRun);
                        const isTestMode = Boolean(runtimeConfig.testMode || runtimeConfig.senderMode === 'TEST');
                        const testPhone = String(runtimeConfig.testRecipientPhone || runtimeConfig.overridePhone || '').trim();

                        let targetPhone = queueRecord.recipientPhone;
                        if (isTestMode && testPhone !== '') {
                            targetPhone = testPhone;
                            Logger.info(`[TEST MODE ACTIVE] Redirecting Queue ID: ${queueRecord.queueId} (${queueRecord.recipientName}) -> TEST PHONE: ${targetPhone}`);
                        }

                        if (isDryRun) {
                            Logger.info(`[DRY RUN SIMULATION] Simulated WhatsApp send for Queue ID: ${queueRecord.queueId} to ${targetPhone} (No real message sent).`);
                            sendResult = {
                                success: true,
                                outcome: 'CONFIRMED',
                                messageId: `DRY_RUN_${Date.now()}`,
                                ack: 1,
                                timestamp: new Date()
                            };
                        } else if (isTestMode && !testPhone) {
                            Logger.warn(`[TEST MODE WARNING] Test Mode is active but TEST_RECIPIENT_PHONE is blank! Simulating transmission to protect real recipients.`);
                            sendResult = {
                                success: true,
                                outcome: 'CONFIRMED',
                                messageId: `TEST_SIMULATED_${Date.now()}`,
                                ack: 1,
                                timestamp: new Date()
                            };
                        } else {
                            // Send real WhatsApp message (blocks for up to 30s while ACK == 0)
                            isSendingMessage = true;
                            try {
                                sendResult = await whatsappProvider.send({
                                    recipientPhone: targetPhone,
                                    message: queueRecord.message
                                });
                            } finally {
                                isSendingMessage = false;
                            }
                        }

                        const nowBD = formatBDDateTime();
                        const sentAtBD = sendResult.timestamp ? formatBDDateTime(sendResult.timestamp) : nowBD;

                        if (sendResult.success && sendResult.ack >= 1) {
                            await sheetService.updateQueueResult(queueSheetName, queueRecord.rowIndex, {
                                status: 'SENT',
                                sentAt: sentAtBD,
                                messageId: sendResult.messageId || '',
                                ack: sendResult.ack,
                                errorMessage: isDryRun ? '[DRY_RUN_SIMULATED]' : '',
                                retryCount: queueRecord.retryCount || 0
                            });
                            messagesSentToday++;
                            Logger.info(`✓ [SENT] Queue ID: ${queueRecord.queueId} | Row ${queueRecord.rowIndex} | ACK: ${sendResult.ack}${isDryRun ? ' (DRY RUN)' : ''} | SentAt: ${sentAtBD}`);
                            await sheetService.updateSettings({
                                'Sender_Status': 'Running',
                                'Last_Run_Time': nowBD,
                                'Last_Message_Time': nowBD,
                                'Messages_Sent_Today': String(messagesSentToday)
                            });

                        } else if (sendResult.outcome === 'CONFIRMATION_PENDING') {
                            // Dispatch was completed, but no ACK was received in 30s.
                            // Mark as SENT to prevent duplicate retries, preserving the warning log.
                            const diagnostic = sendResult.error || 'Dispatch was attempted, but delivery confirmation could not be correlated safely. Automatic retry is blocked to prevent a duplicate message.';
                            await sheetService.updateQueueResult(queueSheetName, queueRecord.rowIndex, {
                                status: 'SENT',
                                sentAt: sentAtBD,
                                messageId: sendResult.messageId || '',
                                ack: sendResult.ack !== undefined ? sendResult.ack : 0,
                                errorMessage: diagnostic,
                                retryCount: queueRecord.retryCount || 0
                            });
                            messagesSentToday++;
                            Logger.warn(`⚠️ [SENT (CONFIRMATION_PENDING)] Queue ID: ${queueRecord.queueId} | Row ${queueRecord.rowIndex} | ACK: ${sendResult.ack !== undefined ? sendResult.ack : 0} -> ${diagnostic}`);
                            await sheetService.updateSettings({
                                'Sender_Status': 'Running',
                                'Last_Run_Time': nowBD,
                                'Last_Message_Time': nowBD,
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

                            if (newStatus === 'FAILED') {
                                messagesFailedToday++;
                                Logger.warn(`❌ [FAILED] Queue ID: ${queueRecord.queueId} | Row ${queueRecord.rowIndex} -> Status: FAILED (Reason: ${errorReason})`);
                                await sheetService.updateSettings({
                                    'Sender_Status': 'Running',
                                    'Last_Run_Time': nowBD,
                                    'Messages_Failed_Today': String(messagesFailedToday)
                                });
                            } else {
                                Logger.warn(`⚠️ [RETRY] Queue ID: ${queueRecord.queueId} | Row ${queueRecord.rowIndex} -> Attempt ${nextRetry} of ${runtimeConfig.maxRetry || 3} (Reason: ${errorReason})`);
                                await sheetService.updateSettings({
                                    'Sender_Status': 'Running',
                                    'Last_Run_Time': nowBD
                                });
                            }
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
                        'Last_Run_Time': formatBDDateTime()
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
                    'Last_Run_Time': formatBDDateTime()
                });
            } catch (e) {}
        }
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(err => {
        Logger.error('Unhandled Bootstrap Exception:', err);
        process.exit(1);
    });
}

module.exports = {
    getWorkerCycleMode,
    initializeStartupIdle
};
