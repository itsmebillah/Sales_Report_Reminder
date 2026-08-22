/**
 * @fileoverview Persistent run tracking for scheduled reminder auto-shutdown.
 * This service never sends messages and never executes an operating-system shutdown.
 */
const AutoShutdownRunService = (() => {
    const log = message => console.log('[AUTO-SHUTDOWN] ' + message);

    const isScheduledTriggerEvent = event =>
        Boolean(event && String(event.triggerUid || '').trim());

    const writeState = values => NotificationControlService.updateSettings(values);

    const clearState = (phase, reason) => {
        writeState({
            AUTO_SHUTDOWN_RUN_ACTIVE: 'FALSE',
            AUTO_SHUTDOWN_RUN_ID: '',
            AUTO_SHUTDOWN_RUN_PHASE: phase,
            AUTO_SHUTDOWN_RUN_QUEUE_IDS: '[]',
            AUTO_SHUTDOWN_LAST_QUEUE_ID: '',
            AUTO_SHUTDOWN_FINAL_CHECK_AT: '',
            AUTO_SHUTDOWN_PENDING_UNTIL: '',
            AUTO_SHUTDOWN_RETRY_USED: 'FALSE',
            AUTO_SHUTDOWN_CANCEL_REASON: reason || ''
        });
    };

    /**
     * Arms tracking only for an Apps Script clock-trigger invocation.
     * Manual menu/editor runs explicitly cancel any previous countdown.
     */
    const begin = isScheduled => {
        if (!isScheduled) {
            clearState('MANUAL_RUN', 'Manual reminder run is not shutdown eligible');
            log('Manual reminder run detected — shutdown not armed');
            return { eligible: false, runId: '' };
        }

        log('Scheduled reminder run detected');
        if (String(NotificationControlService.getSetting('AUTO_SHUTDOWN_ENABLED')).toUpperCase() !== 'TRUE') {
            clearState('DISABLED', 'Auto Shutdown disabled when scheduled run started');
            log('Disabled — shutdown skipped');
            return { eligible: false, runId: '' };
        }

        const previousCountdown = NotificationControlService.getSetting('AUTO_SHUTDOWN_PENDING_UNTIL');
        if (previousCountdown) {
            log('Shutdown cancelled — new scheduled reminder run detected');
        }

        const runId = Utilities.getUuid();
        writeState({
            AUTO_SHUTDOWN_RUN_ACTIVE: 'TRUE',
            AUTO_SHUTDOWN_RUN_ID: runId,
            AUTO_SHUTDOWN_RUN_PHASE: 'GENERATING',
            AUTO_SHUTDOWN_RUN_QUEUE_IDS: '[]',
            AUTO_SHUTDOWN_LAST_QUEUE_ID: '',
            AUTO_SHUTDOWN_FINAL_CHECK_AT: '',
            AUTO_SHUTDOWN_PENDING_UNTIL: '',
            AUTO_SHUTDOWN_RETRY_USED: 'FALSE',
            AUTO_SHUTDOWN_CANCEL_REASON: ''
        });
        log('Reminder run started: ' + runId);
        return { eligible: true, runId };
    };

    /**
     * Captures the exact queue IDs after ReminderService finishes writing the run.
     */
    const completeGeneration = run => {
        if (!run || !run.eligible || !run.runId) return;
        if (NotificationControlService.getSetting('AUTO_SHUTDOWN_RUN_ID') !== run.runId) {
            log('Shutdown aborted — tracked run was replaced before queue generation completed');
            return;
        }

        const queueIds = NotificationControlService.getQueueIds();
        if (queueIds.length === 0) {
            clearState('NO_MESSAGES', 'Scheduled reminder run generated no messages');
            log('No messages generated — shutdown skipped');
            return;
        }

        const finalQueueId = queueIds[queueIds.length - 1];
        writeState({
            AUTO_SHUTDOWN_RUN_ACTIVE: 'TRUE',
            AUTO_SHUTDOWN_RUN_PHASE: 'QUEUED',
            AUTO_SHUTDOWN_RUN_QUEUE_IDS: JSON.stringify(queueIds),
            AUTO_SHUTDOWN_LAST_QUEUE_ID: finalQueueId,
            AUTO_SHUTDOWN_FINAL_CHECK_AT: '',
            AUTO_SHUTDOWN_PENDING_UNTIL: '',
            AUTO_SHUTDOWN_RETRY_USED: 'FALSE',
            AUTO_SHUTDOWN_CANCEL_REASON: ''
        });
        log('Final message identified: ' + finalQueueId);
        log('Waiting for queue completion');
    };

    const abort = (run, reason) => {
        if (!run || !run.eligible || !run.runId) return;
        if (NotificationControlService.getSetting('AUTO_SHUTDOWN_RUN_ID') !== run.runId) return;
        clearState('ABORTED', reason || 'Reminder generation failed');
        log('Shutdown aborted — reminder run failed before queue tracking completed');
    };

    return {
        isScheduledTriggerEvent,
        begin,
        completeGeneration,
        abort
    };
})();
