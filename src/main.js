/**
 * @fileoverview main.js
 * @responsibility Entry points for Google Apps Script triggers. 
 * Contains functions that are natively invoked by the Apps Script environment
 * such as onOpen, time-driven triggers, etc. 
 * Defers business logic to the appropriate Services.
 */

/**
 * Executes when the spreadsheet is opened.
 * Builds the full Sales Automation menu with Notification Sender controls.
 * @param {Object} e The event object provided by Google Sheets.
 */
function onOpen(e) {
    try {
        const ui = SpreadsheetApp.getUi();
        ui.createMenu('Sales Automation')
          .addItem('📋  Copy Sales Data', 'copyData')
          .addSeparator()
          .addItem('Run Daily Reminders', 'processDailyReminders')
          .addItem('⚡ Execute Scheduled Workflow (With Auto Shutdown)', 'runScheduledWorkflowManually')
          .addSeparator()
          .addItem('▶  Start Notification Sender', 'startNotificationSender')
          .addItem('⏹  Stop Notification Sender', 'stopNotificationSender')
          .addSeparator()
          .addItem('🔁  Retry Failed Messages', 'retryFailedMessages')
          .addItem('🗑  Clear Completed Queue', 'clearCompletedQueue')
          .addSeparator()
          .addItem('📊  Sender Status', 'showSenderStatus')
          .addItem('📈  System Dashboard', 'openSystemDashboard')
          .addItem('🔄  Refresh Dashboard', 'refreshDashboardNow')
          .addItem('🖨️ Print Pending TSO Report', 'printPendingTsoReport')
          .addSeparator()
          .addItem('Sync Attendance Now', 'syncAttendanceNow')
          .addItem('Setup Environment Sheets & Triggers', 'runEnvironmentSetup')
          .addItem('⚙️  Set Scheduler Time', 'openSchedulerTimePicker')
          .addItem('⚙️ Auto PC Shutdown Settings', 'openAutoShutdownSettings')
          .addToUi();
    } catch (err) {
        console.log('onOpen UI initialization skipped: ' + err);
    }
}

/**
 * Time-driven or manual trigger entry point for daily reminders.
 */
function processDailyReminders(e) {
    const isScheduled = AutoShutdownRunService.isScheduledTriggerEvent(e);
    if (isScheduled) {
        return runScheduledDailyWorkflow(e);
    }
    return executeDailyReminderGeneration(false);
}

/**
 * Opens the existing Dashboard control dialogs from their C:E/F:H action rows.
 * Configuration value edits themselves require no copy to another sheet because
 * Dashboard columns D and G are the persistent backend value columns.
 */
function onEdit(e) {
    try {
        if (!e || !e.range || e.range.getSheet().getName() !== 'Dashboard') return;
        const editedColumn = e.range.getColumn();
        if ((editedColumn !== 4 && editedColumn !== 7) || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
        if (typeof ConfigLoader !== 'undefined' && ConfigLoader.invalidate) ConfigLoader.invalidate();

        const action = String(e.value || '').toUpperCase();
        const label = String(e.range.getSheet().getRange(e.range.getRow(), editedColumn - 1).getDisplayValue() || '').trim();
        if (label === 'Open Scheduler Time Picker' && action === 'TRUE') {
            e.range.setValue(false);
            openSchedulerTimePicker();
        } else if (label === 'Open Auto Shutdown Control' && action === 'OPEN CONTROL') {
            e.range.setValue('READY');
            openAutoShutdownSettings();
        } else if (label === 'Reminder Message Draft' || label === 'MESSAGE_DRAFT') {
            if (typeof ConfigurationService !== 'undefined' && ConfigurationService.renderDraftPreview) {
                ConfigurationService.renderDraftPreview(e.range.getSheet());
            }
        }
    } catch (err) {
        console.log('Dashboard control action skipped: ' + err);
    }
}

/**
 * Executes the existing reminder service with the requested shutdown tracking
 * context. Scheduled callers reach this only after Sales Data Copy succeeds.
 */
function executeDailyReminderGeneration(isScheduled) {
    let shutdownRun = { eligible: false, runId: '' };
    try {
        shutdownRun = AutoShutdownRunService.begin(isScheduled);
    } catch (stateErr) {
        console.log('[AUTO-SHUTDOWN] Run tracking unavailable — shutdown skipped: ' + stateErr.message);
    }

    let result;
    try {
        result = ReminderService.processReminders();
    } catch (err) {
        try { AutoShutdownRunService.abort(shutdownRun, err.message); } catch (stateErr) {}
        throw err;
    }

    try {
        AutoShutdownRunService.completeGeneration(shutdownRun);
    } catch (stateErr) {
        console.log('[AUTO-SHUTDOWN] Run tracking failed — shutdown skipped: ' + stateErr.message);
        try { AutoShutdownRunService.abort(shutdownRun, stateErr.message); } catch (abortErr) {}
    }

    // Manual menu runs keep their historical behavior but are allowed to wake
    // the already-running sender. They never become shutdown eligible.
    if (!isScheduled && NotificationControlService.getQueueIds().length > 0) {
        NotificationControlService.startSender();
    }
    return result;
}

/**
 * Dedicated Scheduler_Time workflow. Apps Script executes each step
 * synchronously, so reminder generation cannot start until copyData returns.
 */
function runScheduledDailyWorkflow(e) {
    if (!AutoShutdownRunService.isScheduledTriggerEvent(e)) {
        throw new Error('runScheduledDailyWorkflow must be invoked by its clock trigger.');
    }

    const workflowId = Utilities.getUuid();
    console.log('[AUTO DAILY WORKFLOW] Scheduled workflow started: ' + workflowId);

    // Prevent a persisted RUNNING flag from processing an old queue while the
    // new Sales data and queue are being rebuilt.
    NotificationControlService.stopSender();

    try {
        console.log('[SALES DATA SYNC] Copy Sales Data started');
        copyData();
        console.log('[SALES DATA SYNC] Copy Sales Data completed successfully');
    } catch (err) {
        console.log('[SALES DATA SYNC] Copy Sales Data FAILED — daily reminder cancelled: ' + err.message);
        throw err;
    }

    try {
        console.log('[DAILY WORKFLOW] Sales data ready — starting Daily Reminders');
        const result = executeDailyReminderGeneration(true);
        console.log('[DAILY WORKFLOW] Daily Reminder generation completed');

        const queueIds = NotificationControlService.getQueueIds();
        if (queueIds.length === 0) {
            NotificationControlService.stopSender();
            console.log('[DAILY WORKFLOW] No reminder messages generated — sender remains idle and Auto Shutdown is skipped');
            return result;
        }

        NotificationControlService.startSender();
        console.log('[DAILY WORKFLOW] Message queue ready — notification sender released');
        return result;
    } catch (err) {
        NotificationControlService.stopSender();
        console.log('[DAILY WORKFLOW] Daily Reminder generation FAILED — sender and Auto Shutdown remain stopped: ' + err.message);
        throw err;
    }
}

/**
 * Manual menu trigger for running the exact scheduled workflow with Auto Shutdown enabled.
 */
function runScheduledWorkflowManually() {
    const fakeTriggerEvent = { triggerUid: 'manual-clock-trigger-' + Utilities.getUuid() };
    return runScheduledDailyWorkflow(fakeTriggerEvent);
}

/**
 * Dedicated standalone entry point for Attendance synchronization.
 * Calls updateAttendance() directly to ALWAYS rebuild and sort the sheet,
 * bypassing the hash-based skip in syncAttendance() which would prevent
 * re-sorting when Sales data has not changed.
 */
function syncAttendanceNow() {
    return AttendanceService.updateAttendance();
}

/**
 * Trigger entry point for background attendance synchronization.
 */
function syncAttendance() {
    return AttendanceService.syncAttendance();
}

/**
 * Opens a print-only, read-only view of the current Pending_TSO report.
 */
function printPendingTsoReport() {
    return PendingTsoPrintService.openPrintDialog();
}

/**
 * Generates the current Pending_TSO report as a named PDF for the print dialog.
 */
function generatePendingTsoPdf() {
    return PendingTsoPrintService.generatePdf();
}

/**
 * Temporary diagnostic function to perform live Graph API verification.
 */
function debugMetaGraphAPI() {
    const config = ConfigLoader.load();
    const phoneId = String(config['PHONE_NUMBER_ID'] || config['WhatsApp_Phone_Number_ID'] || '').trim();
    const wabaId = String(config['WHATSAPP_BUSINESS_ACCOUNT_ID'] || config['WABA_ID'] || '1859813382068631').trim();
    const apiVersion = String(config['META_API_VERSION'] || 'v25.0').trim();
    const templateName = String(config['TEMPLATE_NAME'] || '').trim();
    const templateLanguage = String(config['TEMPLATE_LANGUAGE'] || 'en_US').trim();
    const rawToken = String(config['ACCESS_TOKEN'] || config['WhatsApp_API_Token'] || '').trim();

    Logger.log("==================================================");
    Logger.log("1. RUNTIME CONFIGURATION VALUES");
    Logger.log("==================================================");
    Logger.log("PHONE_NUMBER_ID: " + phoneId);
    Logger.log("WHATSAPP_BUSINESS_ACCOUNT_ID: " + wabaId);
    Logger.log("TEMPLATE_NAME: " + templateName);
    Logger.log("TEMPLATE_LANGUAGE: " + templateLanguage);
    Logger.log("META_API_VERSION: " + apiVersion);
    Logger.log("ACCESS_TOKEN configured: " + (rawToken ? "YES" : "NO"));

    const headers = {
        'Authorization': 'Bearer ' + rawToken
    };

    // 2. Verify WABA
    const wabaUrl = `https://graph.facebook.com/${apiVersion}/${wabaId}?fields=id,name,account_review_status,message_template_namespace`;
    Logger.log("\n==================================================");
    Logger.log("2. VERIFY WABA (GET " + wabaUrl + ")");
    Logger.log("==================================================");
    try {
        const wabaRes = UrlFetchApp.fetch(wabaUrl, { method: 'get', headers: headers, muteHttpExceptions: true });
        Logger.log("HTTP Status: " + wabaRes.getResponseCode());
        Logger.log("Full JSON Response:\n" + wabaRes.getContentText());
    } catch (e) {
        Logger.log("WABA Exception: " + e);
    }

    // 3. Verify Phone Number
    const phoneUrl = `https://graph.facebook.com/${apiVersion}/${phoneId}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`;
    Logger.log("\n==================================================");
    Logger.log("3. VERIFY PHONE NUMBER (GET " + phoneUrl + ")");
    Logger.log("==================================================");
    try {
        const phoneRes = UrlFetchApp.fetch(phoneUrl, { method: 'get', headers: headers, muteHttpExceptions: true });
        Logger.log("HTTP Status: " + phoneRes.getResponseCode());
        Logger.log("Full JSON Response:\n" + phoneRes.getContentText());
    } catch (e) {
        Logger.log("Phone Exception: " + e);
    }

    // 4. List ALL Templates
    const templatesUrl = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`;
    Logger.log("\n==================================================");
    Logger.log("4. LIST ALL TEMPLATES (GET " + templatesUrl + ")");
    Logger.log("==================================================");
    let allTemplatesJson = null;
    try {
        const templatesRes = UrlFetchApp.fetch(templatesUrl, { method: 'get', headers: headers, muteHttpExceptions: true });
        Logger.log("HTTP Status: " + templatesRes.getResponseCode());
        const bodyStr = templatesRes.getContentText();
        Logger.log("Entire JSON Response:\n" + bodyStr);
        try { allTemplatesJson = JSON.parse(bodyStr); } catch (pErr) {}
    } catch (e) {
        Logger.log("List Templates Exception: " + e);
    }

    // 5. Search Template
    const searchUrl = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates?name=${encodeURIComponent(templateName)}`;
    Logger.log("\n==================================================");
    Logger.log("5. SEARCH TEMPLATE (GET " + searchUrl + ")");
    Logger.log("==================================================");
    let searchTemplatesJson = null;
    try {
        const searchRes = UrlFetchApp.fetch(searchUrl, { method: 'get', headers: headers, muteHttpExceptions: true });
        Logger.log("HTTP Status: " + searchRes.getResponseCode());
        const searchBodyStr = searchRes.getContentText();
        Logger.log("Entire JSON Response:\n" + searchBodyStr);
        try { searchTemplatesJson = JSON.parse(searchBodyStr); } catch (pErr) {}
    } catch (e) {
        Logger.log("Search Template Exception: " + e);
    }

    // 6. Find Exact Language Code
    Logger.log("\n==================================================");
    Logger.log("6. FIND EXACT LANGUAGE CODE");
    Logger.log("==================================================");
    let foundTemplate = null;
    if (searchTemplatesJson && searchTemplatesJson.data && searchTemplatesJson.data.length > 0) {
        foundTemplate = searchTemplatesJson.data[0];
    } else if (allTemplatesJson && allTemplatesJson.data && allTemplatesJson.data.length > 0) {
        foundTemplate = allTemplatesJson.data.find(t => t.name === templateName);
    }

    if (foundTemplate) {
        Logger.log("Template: " + (foundTemplate.name || templateName));
        Logger.log("Language: " + (foundTemplate.language || 'N/A'));
        Logger.log("Status: " + (foundTemplate.status || 'N/A'));
        Logger.log("Category: " + (foundTemplate.category || 'N/A'));
    } else {
        Logger.log("Template '" + templateName + "' was NOT found in WABA ID " + wabaId);
    }

    // 7. Print EXACT Payload
    const overridePhone = String(config['TEST_RECIPIENT_PHONE'] || config['OVERRIDE_PHONE'] || '').trim();
    if (!overridePhone) {
        Logger.log("Test send skipped: configure TEST_RECIPIENT_PHONE explicitly.");
        return;
    }
    let recipientPhone = overridePhone;
    recipientPhone = recipientPhone.replace(/\D/g, '');
    if (recipientPhone.startsWith('0')) recipientPhone = '880' + recipientPhone.substring(1);

    const bodyParameters = [
        { type: "text", text: "TSO Name" },
        { type: "text", text: "06-Aug-2026" },
        { type: "text", text: "3" },
        { type: "text", text: "• SR1 - Name1\n• SR2 - Name2" }
    ];

    const exactPayload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientPhone,
        type: "template",
        template: {
            name: templateName,
            language: {
                code: templateLanguage
            },
            components: [
                {
                    type: "body",
                    parameters: bodyParameters
                }
            ]
        }
    };

    Logger.log("\n==================================================");
    Logger.log("7. PRINT EXACT PAYLOAD");
    Logger.log("==================================================");
    Logger.log(JSON.stringify(exactPayload, null, 2));

    // 8. Send ONE Test Message
    const sendEndpoint = `https://graph.facebook.com/${apiVersion}/${phoneId}/messages`;
    Logger.log("\n==================================================");
    Logger.log("8. SEND ONE TEST MESSAGE (POST " + sendEndpoint + ")");
    Logger.log("==================================================");
    try {
        const postRes = UrlFetchApp.fetch(sendEndpoint, {
            method: 'post',
            contentType: 'application/json',
            headers: headers,
            payload: JSON.stringify(exactPayload),
            muteHttpExceptions: true
        });
        Logger.log("HTTP Status: " + postRes.getResponseCode());
        const postBodyStr = postRes.getContentText();
        Logger.log("Entire JSON Response:\n" + postBodyStr);

        try {
            const parsedPost = JSON.parse(postBodyStr);
            if (parsedPost.error && parsedPost.error.fbtrace_id) {
                Logger.log("fbtrace_id: " + parsedPost.error.fbtrace_id);
            }
        } catch (eErr) {}
    } catch (e) {
        Logger.log("Test Message POST Exception: " + e);
    }

    // 9. Compare
    Logger.log("\n==================================================");
    Logger.log("9. VALUE COMPARISON AUDIT");
    Logger.log("==================================================");
    Logger.log("Runtime Setting Template Name: '" + templateName + "'");
    Logger.log("Runtime Setting Language Code: '" + templateLanguage + "'");
    if (foundTemplate) {
        Logger.log("Graph API Registered Language Code: '" + foundTemplate.language + "'");
        if (templateLanguage !== foundTemplate.language) {
            Logger.log("MISMATCH DETECTED! Runtime Setting Language ('" + templateLanguage + "') does NOT match Graph API Template Language ('" + foundTemplate.language + "')");
        } else {
            Logger.log("MATCH CONFIRMED! Runtime Setting Language matches Graph API Template Language.");
        }
    } else {
        Logger.log("CANNOT COMPARE: Template '" + templateName + "' was not found in Graph API template list.");
    }
}

// ============================================================================
// PHASE 5.2: GOOGLE SHEETS CONTROLLED NOTIFICATION SENDER HANDLERS
// ============================================================================

/**
 * Rebuilds the message queue from the pending data prepared by the daily workflow.
 */
function generateMessageQueue() {
    ReminderService.generateMessageQueueFromPending();
    SpreadsheetApp.getActiveSpreadsheet().toast('Message queue generated successfully!', 'Sales Automation', 5);
}

/**
 * Starts the Notification Sender continuous worker (sets SYSTEM_STATUS = RUNNING).
 */
function startNotificationSender() {
    NotificationControlService.startSender();
    SpreadsheetApp.getActiveSpreadsheet().toast('Notification Sender Started (SYSTEM_STATUS = RUNNING)', 'Sales Automation', 5);
}

/**
 * Stops the Notification Sender continuous worker (sets SYSTEM_STATUS = STOP).
 */
function stopNotificationSender() {
    NotificationControlService.stopSender();
    SpreadsheetApp.getActiveSpreadsheet().toast('Notification Sender Stopped (SYSTEM_STATUS = STOP)', 'Sales Automation', 5);
}

/**
 * Resets all FAILED queue records back to RETRY.
 */
function retryFailedMessages() {
    const count = NotificationControlService.retryFailed();
    SpreadsheetApp.getUi().alert('Retry Failed Messages', `Reset ${count} FAILED queue message(s) to RETRY status.`, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Clears all SENT rows from Message_Queue.
 */
function clearCompletedQueue() {
    const count = NotificationControlService.clearSent();
    SpreadsheetApp.getUi().alert('Clear Completed Queue', `Deleted ${count} SENT queue message(s) from Message_Queue.`, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Opens System Dashboard.
 */
function openSystemDashboard() {
    if (typeof DashboardService !== 'undefined') {
        if (DashboardService.refreshDashboard) {
            DashboardService.refreshDashboard();
        }
        if (DashboardService.openDashboard) {
            DashboardService.openDashboard();
        }
    } else {
        SpreadsheetApp.getUi().alert('System Dashboard', 'DashboardService is running.', SpreadsheetApp.getUi().ButtonSet.OK);
    }
}

/**
 * Refreshes the Dashboard sheet layout and operational metrics manually.
 */
function refreshDashboardNow() {
    try {
        DashboardService.refreshDashboard();
        SpreadsheetApp.getUi().alert('Dashboard Refreshed', 'Dashboard layout and operational metrics refreshed successfully.', SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (err) {
        SpreadsheetApp.getUi().alert('Error refreshing dashboard: ' + err.message);
    }
}

/**
 * Ensures required environment sheets and default settings exist.
 */
function runEnvironmentSetup() {
    const added = NotificationControlService.ensureDefaultSettings();
    SpreadsheetApp.getUi().alert('Environment Setup', `Environment setup complete. Added ${added} missing default setting(s).`, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Displays live Notification Sender status dialog.
 */
function showSenderStatus() {
    const s = NotificationControlService.getStatusSummary();
    const isRunning = s.systemStatus === 'RUNNING';
    const statusIcon = isRunning ? '🟢' : '🔴';

    const htmlOutput = HtmlService.createHtmlOutput(`
        <!DOCTYPE html>
        <html>
        <head>
            <base target="_top">
            <style>
                body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 20px; background-color: #f8f9fa; color: #212529; }
                .card { background: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); padding: 18px; margin-bottom: 15px; border-left: 4px solid ${isRunning ? '#28a745' : '#dc3545'}; }
                .title { font-size: 16px; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
                .status-badge { font-size: 12px; padding: 4px 10px; border-radius: 12px; background: ${isRunning ? '#e6f4ea' : '#fce8e6'}; color: ${isRunning ? '#137333' : '#c5221f'}; font-weight: 600; }
                .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
                .stat-box { background: #f1f3f4; padding: 10px; border-radius: 6px; text-align: center; }
                .stat-val { font-size: 20px; font-weight: 700; color: #1a73e8; }
                .stat-label { font-size: 11px; color: #5f6368; margin-top: 2px; }
                .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f3f4; font-size: 13px; }
                .label { color: #5f6368; font-weight: 500; }
                .val { font-weight: 600; color: #202124; }
                .footer { text-align: right; margin-top: 15px; }
                button { background-color: #1a73e8; color: white; border: none; padding: 8px 16px; border-radius: 4px; font-weight: 500; cursor: pointer; }
                button:hover { background-color: #1557b0; }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="title">
                    <span>${statusIcon} Notification Sender</span>
                    <span class="status-badge">${s.systemStatus}</span>
                </div>
                <div class="row"><span class="label">Worker State:</span><span class="val">${s.senderStatus}</span></div>
                <div class="row"><span class="label">Sender Mode:</span><span class="val">${s.senderMode}</span></div>
                <div class="row"><span class="label">Poll Interval:</span><span class="val">${s.pollInterval}s</span></div>
                <div class="row"><span class="label">Last Heartbeat:</span><span class="val">${s.lastRunTime}</span></div>
                <div class="row"><span class="label">Last Message Sent:</span><span class="val">${s.lastMessageTime}</span></div>
            </div>

            <div class="grid">
                <div class="stat-box"><div class="stat-val">${s.sentToday}</div><div class="stat-label">Sent Today</div></div>
                <div class="stat-box"><div class="stat-val" style="color:${s.failedToday > 0 ? '#d93025' : '#1a73e8'}">${s.failedToday}</div><div class="stat-label">Failed Today</div></div>
            </div>

            <div class="card" style="border-left-color: #1a73e8;">
                <div class="title">📋 Message Queue Breakdown</div>
                <div class="row"><span class="label">Pending:</span><span class="val">${s.queueCounts.pending}</span></div>
                <div class="row"><span class="label">Processing:</span><span class="val">${s.queueCounts.processing}</span></div>
                <div class="row"><span class="label">Retry:</span><span class="val">${s.queueCounts.retry}</span></div>
                <div class="row"><span class="label">Failed:</span><span class="val">${s.queueCounts.failed}</span></div>
                <div class="row"><span class="label">Completed (Sent):</span><span class="val">${s.queueCounts.sent}</span></div>
                <div class="row" style="border-bottom:none;"><span class="label">Total Records:</span><span class="val">${s.queueCounts.total}</span></div>
            </div>

            <div class="footer">
                <button onclick="google.script.host.close()">Close</button>
            </div>
        </body>
        </html>
    `).setWidth(420).setHeight(520);

    SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'Sender Status & Dashboard');
}

/**
 * Copies sales data from source sheet to target Sales sheet.
 */
function copyData() {
  const SOURCE_ID = "1uQnfNHo-rkazm02yG81LZn1slmQtNvmiFwS48vjq1E0";
  const TARGET_ID = "1Gi1pbNBUM-16oLylCaovl_IkO8qXzsMadO_Jxtm526g";

  const source = SpreadsheetApp.openById(SOURCE_ID).getSheetByName("Sheet4");
  const target = SpreadsheetApp.openById(TARGET_ID).getSheetByName("Sales");

  // শুধু A1:DS1000 পর্যন্ত পড়বে
  const data = source.getRange("A1:DS1000").getDisplayValues();

  // শুধু A1:DS1000 এর data clear করবে
  target.getRange("A1:DS1000").clearContent();

  // Data paste
  target.getRange(1, 1, data.length, data[0].length).setValues(data);

  // Rebuild Attendance only after the copied Sales data is committed.
  SpreadsheetApp.flush();
  syncAttendanceNow();
}

/**
 * Opens the HTML modal dialog for Scheduler Time Picker.
 */
function openSchedulerTimePicker() {
    try {
        const htmlOutput = HtmlService.createHtmlOutputFromFile('SchedulerTimePicker')
            .setWidth(320)
            .setHeight(180)
            .setTitle('Set Scheduler Time');
        SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'Set Scheduler Time');
    } catch (err) {
        SpreadsheetApp.getUi().alert('Error opening time picker: ' + err.message);
    }
}

/**
 * Returns the current Scheduler_Time setting value as a string.
 */
function getCurrentSchedulerTime() {
    try {
        const config = ConfigLoader.load();
        const rawTime = config['Scheduler_Time'];
        if (rawTime instanceof Date) {
            const tz = config['Timezone'] || 'Asia/Dhaka';
            return Utilities.formatDate(rawTime, tz, "HH:mm");
        }
        return String(rawTime || '').trim();
    } catch (err) {
        return '';
    }
}

/**
 * Saves Scheduler_Time in Dashboard configuration as plain-text HH:mm,
 * and re-installs the project Daily execution trigger.
 * @param {string} newTime 24-hour formatted string "HH:mm" or empty string to clear.
 */
function saveSchedulerTime(newTime) {
    try {
        const normalizedTime = String(newTime || '').trim();
        if (normalizedTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(normalizedTime)) {
            throw new Error('Scheduler Time must use 24-hour HH:mm format.');
        }
        ConfigurationService.updateSetting('Scheduler_Time', normalizedTime);

        // Force spreadsheet flush to make sure changes are written before trigger reload
        SpreadsheetApp.flush();

        // Replace all reminder-workflow clock triggers, create exactly one,
        // and persist the live post-install counts for external verification.
        const triggerStatus = EnvironmentSetup.installTrigger();
        NotificationControlService.updateSettings({
            SCHEDULER_TRIGGER_LAST_VERIFIED_AT: new Date().toISOString(),
            SCHEDULER_TRIGGER_CONFIGURED_TIME: triggerStatus.configuredSchedulerTime,
            SCHEDULER_TRIGGER_TIMEZONE: triggerStatus.timezone,
            SCHEDULER_TRIGGER_DAILY_COUNT: String(triggerStatus.dailyTriggerCount),
            SCHEDULER_TRIGGER_WORKFLOW_COUNT: String(triggerStatus.runScheduledDailyWorkflowCount),
            SCHEDULER_TRIGGER_LEGACY_COUNT: String(triggerStatus.processDailyRemindersCount)
        });

        // Re-calculate and update Dashboard metrics to reflect the new scheduler next run time
        DashboardService.refreshDashboard();

        SpreadsheetApp.getUi().alert("Scheduler time updated successfully! Next run time has been adjusted.");
    } catch (err) {
        SpreadsheetApp.getUi().alert("Failed to save scheduler time: " + err.message);
        throw err;
    }
}

/** Opens the Auto PC Shutdown Settings dialog. */
function openAutoShutdownSettings() {
    const html = HtmlService.createHtmlOutputFromFile('AutoShutdownSettings')
        .setWidth(340)
        .setHeight(250);
    SpreadsheetApp.getUi().showModalDialog(html, 'Auto PC Shutdown Settings');
}

/** Returns whether automatic PC shutdown is enabled. */
function getAutoShutdownEnabled() {
    const value = NotificationControlService.getSetting('AUTO_SHUTDOWN_ENABLED');
    return String(value).toUpperCase() === 'TRUE';
}

/** Saves whether automatic PC shutdown is enabled. */
function saveAutoShutdownEnabled(enabled) {
    const value = enabled ? 'TRUE' : 'FALSE';
    NotificationControlService.updateSetting(
        'AUTO_SHUTDOWN_ENABLED',
        value,
        'Enable/disable auto PC shutdown after reminders'
    );
    DashboardService.refreshDashboard();
}

/** Returns the configured shutdown delay in minutes. */
function getAutoShutdownDelay() {
    const value = NotificationControlService.getSetting('AUTO_SHUTDOWN_DELAY_MINUTES');
    return Number(value) || 12;
}

/** Saves the Auto Shutdown delay without changing shutdown safety logic. */
function saveAutoShutdownDelay(minutes) {
    const delay = Number(minutes);
    if (!Number.isFinite(delay) || delay < 1 || delay > 120 || Math.floor(delay) !== delay) {
        throw new Error('Shutdown delay must be a whole number from 1 to 120 minutes.');
    }
    NotificationControlService.updateSetting('AUTO_SHUTDOWN_DELAY_MINUTES', String(delay));
    DashboardService.refreshDashboard();
}

