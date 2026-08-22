const TERMINAL_STATUSES = new Set(['SENT', 'FAILED']);
const UNRESOLVED_STATUSES = new Set(['PENDING', 'PROCESSING', 'RETRY']);

class AutoShutdownController {
    constructor({ sheetService, logger, shutdownExecutor, now = () => Date.now() }) {
        this.sheetService = sheetService;
        this.logger = logger;
        this.shutdownExecutor = shutdownExecutor;
        this.now = now;
    }

    log(message, level = 'info') {
        const method = typeof this.logger[level] === 'function' ? level : 'info';
        this.logger[method](`[AUTO-SHUTDOWN] ${message}`);
    }

    async updateState(values) {
        const updated = await this.sheetService.updateSettings(values);
        if (updated === false) {
            throw new Error('Could not persist auto-shutdown state.');
        }
    }

    async cancel(reason, logMessage) {
        await this.updateState({
            AUTO_SHUTDOWN_RUN_ACTIVE: 'FALSE',
            AUTO_SHUTDOWN_RUN_PHASE: 'CANCELLED',
            AUTO_SHUTDOWN_FINAL_CHECK_AT: '',
            AUTO_SHUTDOWN_PENDING_UNTIL: '',
            AUTO_SHUTDOWN_CANCEL_REASON: reason
        });
        this.log(logMessage || `Shutdown aborted — ${reason}`, 'warn');
        return { action: 'cancelled', reason };
    }

    parseQueueIds(rawValue) {
        try {
            const parsed = JSON.parse(rawValue || '[]');
            return Array.isArray(parsed)
                ? parsed.map(value => String(value || '').trim()).filter(Boolean)
                : [];
        } catch (error) {
            return [];
        }
    }

    async armFinalRetry(config, finalRecord) {
        if (config.autoShutdownRunPhase !== 'FINAL_RETRY_ARMING') {
            this.log('Final message FAILED — retrying once', 'warn');
            await this.updateState({
                AUTO_SHUTDOWN_RETRY_USED: 'TRUE',
                AUTO_SHUTDOWN_RUN_PHASE: 'FINAL_RETRY_ARMING',
                AUTO_SHUTDOWN_PENDING_UNTIL: ''
            });
        }

        if (finalRecord.status === 'FAILED') {
            await this.sheetService.updateQueueResult(
                config.queueSheetName,
                finalRecord.rowIndex,
                {
                    status: 'PENDING',
                    sentAt: '',
                    errorMessage: 'Auto-shutdown final-message retry scheduled',
                    retryCount: finalRecord.retryCount
                }
            );
        }

        await this.updateState({ AUTO_SHUTDOWN_RUN_PHASE: 'QUEUED' });
        return { action: 'final-retry-armed', queueId: finalRecord.queueId };
    }

    async startCountdown(config, finalRecord) {
        const delayMinutes = Number.isFinite(config.autoShutdownDelayMinutes) &&
            config.autoShutdownDelayMinutes > 0
            ? config.autoShutdownDelayMinutes
            : 12;
        const resolvedAt = new Date(this.now()).toISOString();
        const pendingUntil = new Date(this.now() + delayMinutes * 60 * 1000).toISOString();

        await this.updateState({
            AUTO_SHUTDOWN_RUN_ACTIVE: 'FALSE',
            AUTO_SHUTDOWN_RUN_PHASE: 'COUNTDOWN',
            AUTO_SHUTDOWN_FINAL_CHECK_AT: resolvedAt,
            AUTO_SHUTDOWN_PENDING_UNTIL: pendingUntil,
            AUTO_SHUTDOWN_CANCEL_REASON: ''
        });
        this.log(`${delayMinutes}-minute shutdown countdown started`);
        return {
            action: 'countdown-started',
            queueId: finalRecord.queueId,
            pendingUntil
        };
    }

    async runFinalSafetyCheck(config, records, runRecords, context) {
        const pending = records.filter(record => record.status === 'PENDING');
        if (pending.length > 0) {
            return this.cancel(
                'New pending message detected during countdown',
                'Shutdown cancelled — new pending message detected'
            );
        }

        const processing = records.some(record => record.status === 'PROCESSING');
        const retrying = records.some(record => record.status === 'RETRY');
        const senderSending = context.senderBusy ||
            String(config.senderStatus || '').trim().toUpperCase() === 'SENDING';
        const runStillActive = Boolean(config.autoShutdownRunActive);
        const runIncomplete = runRecords.some(record => !TERMINAL_STATUSES.has(record.status));

        if (processing || retrying || senderSending || runStillActive || runIncomplete) {
            return this.cancel(
                'Final safety check failed',
                'Shutdown aborted — safety check failed'
            );
        }

        this.log('Final safety check passed');
        await this.updateState({
            AUTO_SHUTDOWN_RUN_ACTIVE: 'FALSE',
            AUTO_SHUTDOWN_RUN_PHASE: 'SHUTDOWN_INITIATED',
            AUTO_SHUTDOWN_PENDING_UNTIL: '',
            AUTO_SHUTDOWN_CANCEL_REASON: ''
        });
        this.log('Windows shutdown initiated');

        try {
            await this.shutdownExecutor();
            return { action: 'shutdown-initiated' };
        } catch (error) {
            await this.updateState({
                AUTO_SHUTDOWN_RUN_PHASE: 'SHUTDOWN_FAILED',
                AUTO_SHUTDOWN_CANCEL_REASON: error.message
            });
            this.log(`Shutdown aborted — shutdown.exe failed: ${error.message}`, 'error');
            return { action: 'shutdown-failed', reason: error.message };
        }
    }

    async tick(runtimeConfig, context = {}) {
        const config = {
            ...runtimeConfig,
            queueSheetName: context.queueSheetName || runtimeConfig.queueSheet || 'Message_Queue'
        };
        const phase = String(config.autoShutdownRunPhase || 'IDLE').toUpperCase();
        const countdownPending = phase === 'COUNTDOWN';
        const trackedRunActive = Boolean(config.autoShutdownRunActive);

        if (!config.autoShutdownEnabled) {
            if (trackedRunActive || countdownPending) {
                this.log('Disabled — shutdown skipped');
                return this.cancel(
                    'Auto Shutdown disabled',
                    'Shutdown cancelled — Auto Shutdown disabled'
                );
            }
            return { action: 'disabled' };
        }

        if (!trackedRunActive && !countdownPending) {
            return { action: 'idle' };
        }

        if (!config.autoShutdownRunId) {
            return this.cancel('Missing scheduled run ID', 'Shutdown aborted — safety check failed');
        }

        if (phase === 'GENERATING') {
            this.log('Waiting for queue completion');
            return { action: 'waiting-for-generation' };
        }

        const queueIds = this.parseQueueIds(config.autoShutdownRunQueueIds);
        if (queueIds.length === 0 || !config.autoShutdownLastQueueId) {
            return this.cancel('Missing run queue identity', 'Shutdown aborted — safety check failed');
        }

        const records = await this.sheetService.readQueueRecords(config.queueSheetName);
        const recordsById = new Map(records.map(record => [record.queueId, record]));
        const runRecords = queueIds.map(queueId => recordsById.get(queueId));

        if (runRecords.some(record => !record)) {
            return this.cancel('Tracked queue record is missing', 'Shutdown aborted — safety check failed');
        }

        const finalRecord = recordsById.get(config.autoShutdownLastQueueId);
        if (!finalRecord || !queueIds.includes(finalRecord.queueId)) {
            return this.cancel('Final queue record is missing', 'Shutdown aborted — safety check failed');
        }

        if (countdownPending) {
            const pendingUntilMs = Date.parse(config.autoShutdownPendingUntil || '');
            if (!Number.isFinite(pendingUntilMs)) {
                return this.cancel('Invalid shutdown countdown timestamp', 'Shutdown aborted — safety check failed');
            }

            if (records.some(record => record.status === 'PENDING')) {
                return this.cancel(
                    'New pending message detected during countdown',
                    'Shutdown cancelled — new pending message detected'
                );
            }

            if (this.now() < pendingUntilMs) {
                return { action: 'countdown-pending', pendingUntil: config.autoShutdownPendingUntil };
            }
            return this.runFinalSafetyCheck(config, records, runRecords, context);
        }

        if (phase === 'FINAL_RETRY_ARMING') {
            return this.armFinalRetry(config, finalRecord);
        }

        if (phase !== 'QUEUED') {
            return { action: 'waiting', phase };
        }

        if (runRecords.some(record => UNRESOLVED_STATUSES.has(record.status))) {
            this.log('Waiting for queue completion');
            return { action: 'waiting-for-queue' };
        }

        if (runRecords.some(record => !TERMINAL_STATUSES.has(record.status))) {
            return this.cancel('Unknown queue status in tracked run', 'Shutdown aborted — safety check failed');
        }

        if (finalRecord.status === 'FAILED' && !config.autoShutdownRetryUsed) {
            return this.armFinalRetry(config, finalRecord);
        }

        if (finalRecord.status === 'SENT') {
            this.log(config.autoShutdownRetryUsed ? 'Final retry SENT' : 'Final message SENT');
        } else if (finalRecord.status === 'FAILED' && config.autoShutdownRetryUsed) {
            this.log('Final retry FAILED', 'warn');
        } else {
            return this.cancel('Final message is not terminal', 'Shutdown aborted — safety check failed');
        }

        return this.startCountdown(config, finalRecord);
    }
}

module.exports = AutoShutdownController;
