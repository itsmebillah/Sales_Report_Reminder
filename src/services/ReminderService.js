const ReminderService = (() => {

    /**
     * Helper to compute the final destination phone number used by WhatsApp Service.
     */
    const getDestinationPhone = (rawPhone, config) => {
        const conf = config || {};
        const isTestMode = String(conf['TEST_MODE']).toUpperCase() === 'TRUE' || String(conf['SENDER_MODE']).toUpperCase() === 'TEST';
        const overridePhone = String(conf['TEST_RECIPIENT_PHONE'] || conf['OVERRIDE_PHONE'] || conf['TEST_PHONE'] || '').trim();
        const isOverridden = Boolean(isTestMode && overridePhone !== '');
        const target = isOverridden ? overridePhone : rawPhone;
        if (!target || target === '' || target === '#N/A' || target === 'undefined' || target === 'null') {
            return '';
        }
        let digits = String(target).replace(/\D/g, '');
        if (digits.startsWith('0')) {
            digits = '880' + digits.substring(1);
        } else if (digits.length === 10 && digits.startsWith('1')) {
            digits = '880' + digits;
        }
        return digits;
    };

    const isValidRsmPhone = (rawPhone) => /^8801\d{9}$/.test(getDestinationPhone(rawPhone, {
        TEST_MODE: 'FALSE',
        OVERRIDE_PHONE: ''
    }));

    const buildRsmSummaryMessage = (rsmName, salesDate, tsoSummaries, totalPendingSrCount) => {
        const tsoDetails = tsoSummaries.map(group =>
            `TSO: ${group.tsoName} (${group.tsoId})\nPending SR: ${group.pendingSrCount}\nSR details:\n${group.pendingSrList}`
        ).join('\n\n');

        return `Assalamu Alaikum.\n\nDear ${rsmName},\n\nSales Posting Reminder Summary\nSales Date: ${salesDate}\nTotal Pending SR: ${totalPendingSrCount}\n\n${tsoDetails}`;
    };

    const buildRsmQueueRows = (tsoGroups, rsmMap, rsmConflicts, formattedSalesDate, timestamp, provider, config, dryRun) => {
        const groupsByRsm = {};
        const seenIdempotencyKeys = new Set();
        const queueRows = [];
        const skipped = [];

        Object.keys(tsoGroups).forEach(tsoId => {
            const group = tsoGroups[tsoId];
            const rsmId = String(group.rsmId || '').trim();
            if (!rsmId) return;
            if (!groupsByRsm[rsmId]) groupsByRsm[rsmId] = [];
            groupsByRsm[rsmId].push({
                tsoId: group.tsoId,
                tsoName: group.tsoName,
                pendingSrCount: group.srs.length,
                pendingSrList: group.srs.map(s => `• ${s.SR_ID} - ${s.SR_Name || s.SR_NAME}`).join('\n')
            });
        });

        Object.keys(groupsByRsm).forEach(rsmId => {
            const idempotencyKey = `RSM_SUMMARY|${formattedSalesDate}|${rsmId}`;
            if (seenIdempotencyKeys.has(idempotencyKey)) return;
            seenIdempotencyKeys.add(idempotencyKey);

            if (rsmConflicts[rsmId]) {
                skipped.push({ rsmId, reason: rsmConflicts[rsmId] });
                return;
            }

            const rsm = rsmMap[rsmId];
            if (!rsm || !isValidRsmPhone(rsm.RSM_Phone)) {
                skipped.push({ rsmId, reason: 'RSM phone is missing or invalid in Contact list' });
                return;
            }

            const tsoSummaries = groupsByRsm[rsmId];
            const totalPendingSrCount = tsoSummaries.reduce((total, group) => total + group.pendingSrCount, 0);
            const pendingSrList = tsoSummaries.map(group =>
                `TSO: ${group.tsoName} (${group.tsoId})\nPending SR: ${group.pendingSrCount}\n${group.pendingSrList}`
            ).join('\n\n');
            const targetPhone = getDestinationPhone(rsm.RSM_Phone, config);

            queueRows.push({
                Queue_ID: Utilities.getUuid(),
                Timestamp: timestamp,
                Provider: provider,
                Recipient_Name: rsm.RSM_Name,
                Recipient_Phone: targetPhone,
                Recipient_Type: 'RSM',
                Sales_Date: formattedSalesDate,
                Pending_SR_Count: totalPendingSrCount,
                Pending_SR_List: pendingSrList,
                Message_Body: buildRsmSummaryMessage(rsm.RSM_Name, formattedSalesDate, tsoSummaries, totalPendingSrCount),
                Status: 'PENDING',
                Retry_Count: 0,
                Created_At: timestamp,
                RSM_ID: rsm.RSM_ID,
                RSM_Name: rsm.RSM_Name,
                Idempotency_Key: idempotencyKey
            });
        });

        return { queueRows, skipped };
    };

    const processReminders = () => {
        const startTime = new Date().getTime();
        const generatedLogs = [];

        const config = ConfigLoader.load();
        const dryRun = String(config['Dry_Run']).toUpperCase() === 'TRUE';
        const whatsappEnabled = String(config['WhatsApp_Enabled']).toUpperCase() === 'TRUE';
        const reportingDays = parseInt(config['Reporting_Days'], 10) || 3;
        const tz = config['Timezone'] || 'Asia/Dhaka';

        const salesDateObj = DateUtils.getTargetSalesDate(reportingDays, tz);
        const targetDayInt = DateUtils.getDayOfMonth(salesDateObj);
        const formattedSalesDate = DateUtils.formatDate(salesDateObj, tz);

        const hierarchyMap = SheetService.readHierarchyMap(); // Reading from Hierarchy sheet
        const { tsoMap, srMap, rsmMap, rsmConflicts } = SheetService.readContactMap(); // Reading from Contact list sheet
        const salesRecords = SheetService.readDailySalesForDayBySR(targetDayInt); // Reading from Sales sheet

        // Phase 1 Queue Cleanup (Ensuring clean storage at runtime)
        SheetService.ensureMessageQueueHeaders(['RSM_ID', 'RSM_Name', 'Idempotency_Key']);
        SheetService.clearDataKeepHeaders('Pending_SR');
        SheetService.clearDataKeepHeaders('Pending_TSO');
        SheetService.clearDataKeepHeaders('Message_Queue');

        // Step 1: Accumulate Sales Volume per SR_ID from Sales sheet
        const srSalesSum = {};
        for (let i = 0; i < salesRecords.length; i++) {
            const record = salesRecords[i];
            const srId = record.SR_ID;
            if (!srSalesSum[srId]) {
                srSalesSum[srId] = 0;
            }
            if (record.Sales_Volume > 0) {
                srSalesSum[srId] += record.Sales_Volume;
            }
        }

        const cacheMap = SheetService.readReminderSystemCache(formattedSalesDate);

        // Step 2: Stage-Wise Validation for every SR present in Sales sheet
        const salesSRIds = Object.keys(srSalesSum);
        const validPendingSRs = [];

        let hierarchyMissingCount = 0;
        let contactMissingCount = 0;
        let phoneMissingCount = 0;
        let totalPresentCount = 0;

        for (let i = 0; i < salesSRIds.length; i++) {
            const srId = salesSRIds[i];
            const salesVal = srSalesSum[srId];

            // STAGE 1: Sales -> Hierarchy lookup
            const hier = hierarchyMap[srId];
            if (!hier) {
                hierarchyMissingCount++;
                const auditRecord = [
                    new Date(), "N/A", "N/A",
                    srId, "N/A", "N/A",
                    "N/A", "N/A", "N/A",
                    formattedSalesDate, "STAGE_1_HIERARCHY", "", "HIERARCHY_NOT_FOUND", `SR_ID ${srId} not found in Hierarchy`
                ];
                SheetService.writeLog(auditRecord);
                generatedLogs.push(auditRecord);
                continue; // STOP here! Do NOT continue to Contact List lookup!
            }

            // STAGE 2: Hierarchy -> Contact lookup
            const tsoId = String(hier.TSO_ID).trim();
            const contact = tsoMap[tsoId] || srMap[srId];
            if (!contact) {
                contactMissingCount++;
                const auditRecord = [
                    new Date(), "N/A", "N/A",
                    srId, hier.SR_Name, tsoId,
                    hier.TSO_Name, hier.RSM_ID, hier.RSM_Name,
                    formattedSalesDate, "STAGE_2_CONTACT", "", "CONTACT_NOT_FOUND", `TSO ${tsoId} not found in Contact list`
                ];
                SheetService.writeLog(auditRecord);
                generatedLogs.push(auditRecord);
                continue; // STOP here! Do NOT continue to Phone lookup!
            }

            // STAGE 3: Contact found -> Phone lookup
            const tsoPhone = String(contact.TSO_Phone || hier.TSO_Phone || '').trim();
            const isValidPhone = Boolean(tsoPhone && tsoPhone !== '#N/A' && tsoPhone !== 'undefined' && tsoPhone !== 'null');

            if (!isValidPhone) {
                phoneMissingCount++;
                const auditRecord = [
                    new Date(), "N/A", "N/A",
                    srId, hier.SR_Name, tsoId,
                    hier.TSO_Name, hier.RSM_ID, hier.RSM_Name,
                    formattedSalesDate, "STAGE_3_PHONE", "", "PHONE_NOT_FOUND", "Phone number is blank"
                ];
                SheetService.writeLog(auditRecord);
                generatedLogs.push(auditRecord);
                continue; // STOP here! Skip message generation.
            }

            // All validation stages passed! Check Present vs Pending
            if (salesVal > 0) {
                totalPresentCount++;
            } else {
                const isTestMode = String(config['TEST_MODE']).toUpperCase() === 'TRUE' || String(config['SENDER_MODE']).toUpperCase() === 'TEST';
                const currentLevel = (isTestMode || dryRun) ? 'NONE' : (cacheMap[srId] || 'NONE');
                if (currentLevel !== 'TSO' && currentLevel !== 'RSM') {
                    validPendingSRs.push({
                        SR_ID: srId,
                        SR_Name: hier.SR_Name,
                        TSO_ID: tsoId,
                        TSO_Name: hier.TSO_Name || contact.TSO_Name,
                        TSO_Phone: tsoPhone,
                        RSM_ID: hier.RSM_ID || contact.RSM_ID,
                        RSM_Name: hier.RSM_Name || contact.RSM_Name
                    });
                }
            }
        }

        // Grouping Valid Pending SRs by TSO_ID
        const tsoGroups = {};
        for (let i = 0; i < validPendingSRs.length; i++) {
            const item = validPendingSRs[i];
            const tsoId = item.TSO_ID;

            if (!tsoGroups[tsoId]) {
                tsoGroups[tsoId] = {
                    tsoId: tsoId,
                    tsoName: item.TSO_Name,
                    tsoPhone: item.TSO_Phone,
                    rsmId: item.RSM_ID,
                    rsmName: item.RSM_Name,
                    srs: []
                };
            }
            tsoGroups[tsoId].srs.push(item);
        }

        let sentCount = 0; // Legacy dashboard support
        let failedCount = 0;
        let skippedCount = 0;

        const pendingSrRows = [];
        const pendingTsoRows = [];
        const messageQueueRows = [];
        const timestamp = new Date();
        const messageDraft = String(config['MESSAGE_DRAFT'] || config['REMINDER_MESSAGE_DRAFT'] || 'WITH_DEADLINE').toUpperCase().trim();
        const nextDayDate = DateUtils.getNextDayDate(new Date(), tz);
        const formattedNextDayDate = DateUtils.formatDate(nextDayDate, tz);
        const withDeadlineText = `${formattedNextDayDate} 10.00 থেকে সকাল 11.00 টা`;
        const todayDate = new Date();
        const formattedTodayDate = DateUtils.formatDate(todayDate, tz);
        const standardDeadlineText = `আজ (${formattedTodayDate}) সকাল 10.00 থেকে 11.00 টা`;

        // Execute Queue Extraction
        for (const tsoId in tsoGroups) {
            const group = tsoGroups[tsoId];

            const srCount = group.srs.length;
            // Format strictly as bulleted list matching the exact spec
            const srList = group.srs.map(s => `• ${s.SR_ID} - ${s.SR_Name || s.SR_NAME}`).join("\n");

            // Exact message body based on configured message draft
            let messageBody;
            const isDraft2 = messageDraft === 'STANDARD' || messageDraft === 'DRAFT_2' || messageDraft === 'DRAFT 2';
            if (isDraft2) {
                messageBody = `আসসালামু আলাইকুম।\n\nপ্রিয় ${group.tsoName},\n\n📢 সেলস পোস্টিং রিমাইন্ডার\n\n📅 রিপোর্টিং তারিখ: ${formattedSalesDate}\n⏰ পোস্টিংয়ের শেষ সময়: ${standardDeadlineText}\n\n📌 মোট বাকি এসআর: ${srCount} জন\n\nবাকি থাকা এসআরদের তালিকা:\n\n${srList}\n\nঅনুগ্রহ করে নির্ধারিত সময়সীমার মধ্যে উপরের এসআরদের সেলস পোস্টিং সম্পন্ন করুন।\n\n⚠️ কোনো এসআর Close হয়ে থাকলে অনুগ্রহ করে সংশ্লিষ্ট গ্রুপে জানাবেন।\n\nℹ️ যদি ইতোমধ্যে সেলস পোস্টিং সম্পন্ন হয়ে থাকে, কোনো এসার ছুটিতে থাকে কিংবা সেলস না থাকে তাহলে অনুগ্রহ করে এই বার্তাটি উপেক্ষা করুন।\n\nধন্যবাদ।`;
            } else {
                messageBody = `আসসালামু আলাইকুম।\n\nপ্রিয় ${group.tsoName},\n\n📢 সেলস পোস্টিং রিমাইন্ডার\n\n📅 রিপোর্টিং তারিখ: *${formattedSalesDate}*\n⏰ পোস্টিংয়ের শেষ সময়: *${withDeadlineText}*\n\n📌 মোট বাকি এসআর: ${srCount} জন\n\nবাকি থাকা এসআরদের তালিকা:\n\n${srList}\n\nঅনুগ্রহ করে নির্ধারিত সময়সীমার মধ্যে উপরের এসআরদের সেলস পোস্টিং সম্পন্ন করুন।\n\n⚠️ কোনো এসআর Close হয়ে থাকলে অনুগ্রহ করে সংশ্লিষ্ট গ্রুপে জানাবেন।\n\nℹ️ যদি ইতোমধ্যে সেলস পোস্টিং সম্পন্ন হয়ে থাকে, কোনো এসার ছুটিতে থাকে কিংবা সেলস না থাকে তাহলে অনুগ্রহ করে এই বার্তাটি উপেক্ষা করুন।\n\nধন্যবাদ।`;
            }

            const queueId = Utilities.getUuid();
            const provider = config['NOTIFICATION_PROVIDER'] || 'WhatsApp';
            const targetPhone = getDestinationPhone(group.tsoPhone, config);

            // Queue_ID, Timestamp, Provider, Recipient_Name, Recipient_Phone, Recipient_Type, 
            // TSO_ID, TSO_Name, Sales_Date, Pending_SR_Count, Pending_SR_List, 
            // Message_Body, Status, Retry_Count, Created_At, Sent_At, Error_Message,
            // Message_ID, ACK, Processing_Started_At, Worker_ID, Recovery_Time, Recovery_Reason
            messageQueueRows.push([
                queueId, timestamp, provider, group.tsoName, targetPhone, "TSO",
                group.tsoId, group.tsoName, formattedSalesDate, srCount, srList,
                messageBody, "PENDING", 0, timestamp, "", "", "", "", "", "", "", ""
            ]);

            // Timestamp, Sales_Date, TSO_ID, TSO_Name, TSO_Phone, RSM_ID, RSM_Name, Pending_SR_Count, Pending_SR_List
            pendingTsoRows.push([
                timestamp, formattedSalesDate, group.tsoId, group.tsoName, group.tsoPhone,
                group.rsmId, group.rsmName, srCount, srList
            ]);

            for (let j = 0; j < group.srs.length; j++) {
                const srItem = group.srs[j];
                // Timestamp, Sales_Date, Dealer_ID, Dealer_Name, SR_ID, SR_Name, TSO_ID, TSO_Name, RSM_ID, RSM_Name, Reason, Sales_Status
                pendingSrRows.push([
                    timestamp, formattedSalesDate, "", "", srItem.SR_ID, srItem.SR_Name,
                    group.tsoId, group.tsoName, group.rsmId, group.rsmName, "No Sales Volume", "Pending"
                ]);

                // Preserve backwards compatibility with existing systems
                SheetService.writeReminderSystemCache([
                    "N/A", targetPhone, dryRun ? "DRY_RUN" : "QUEUED",
                    new Date(), "", formattedSalesDate, "TSO", srItem.SR_ID
                ]);
            }

            let wStatus = dryRun ? "DRY_RUN" : "QUEUED";
            if (dryRun) skippedCount++; else sentCount++;

            const auditRecord = [
                new Date(), "N/A", "N/A", "Multiple", "Multiple", group.tsoId,
                group.tsoName, group.rsmId, group.rsmName, formattedSalesDate, "TSO", targetPhone, wStatus, ""
            ];
            SheetService.writeLog(auditRecord);
            generatedLogs.push(auditRecord);
        }

        // RSM is an additional notification layer built only from the TSO
        // groups already produced above. It does not re-evaluate Sales/SR rules.
        const rsmQueueResult = buildRsmQueueRows(
            tsoGroups, rsmMap, rsmConflicts, formattedSalesDate, timestamp,
            config['NOTIFICATION_PROVIDER'] || 'WhatsApp', config, dryRun
        );
        messageQueueRows.push(...rsmQueueResult.queueRows);

        rsmQueueResult.skipped.forEach(skipped => {
            const auditRecord = [
                new Date(), 'N/A', 'N/A', 'Multiple', 'Multiple', '', '', skipped.rsmId,
                (rsmMap[skipped.rsmId] && rsmMap[skipped.rsmId].RSM_Name) || '', formattedSalesDate,
                'RSM', '', 'SKIPPED', skipped.reason
            ];
            SheetService.writeLog(auditRecord);
            generatedLogs.push(auditRecord);
        });

        SheetService.writePendingSRs(pendingSrRows);
        SheetService.writePendingTSOs(pendingTsoRows);
        SheetService.writeMessageQueue(messageQueueRows);

        // Automatic Data Retention Cleanup
        const cleanupResult = CleanupService.runCleanup();

        // Update Sales Activity Attendance Module (Sales -> Attendance)
        const attendanceMetrics = AttendanceService.updateAttendance();

        // Apply Office User Mode sheet visibility
        VisibilityService.applyOfficeUserModeVisibility();

        const endTime = new Date().getTime();
        const durationMs = endTime - startTime;

        // Automatically Refresh Dashboard (Attendance -> Dashboard -> Logs)
        DashboardService.refreshDashboard({
            success: true,
            targetDate: formattedSalesDate,
            totalSREvaluated: salesSRIds.length,
            totalPresent: totalPresentCount,
            totalPending: validPendingSRs.length,
            totalCellKPI: totalPresentCount + validPendingSRs.length,
            totalTSOMessages: Object.keys(tsoGroups).length,
            sentCount: sentCount,
            failedCount: failedCount,
            skippedCount: skippedCount,
            hierarchyMissingCount: hierarchyMissingCount,
            contactMissingCount: contactMissingCount,
            phoneMissingCount: phoneMissingCount,
            executionTimeMs: durationMs,
            cleanupResult: cleanupResult,
            attendanceMetrics: attendanceMetrics
        });

        return generatedLogs;
    };

    /**
     * Rebuilds only Message_Queue from the Pending_TSO rows produced by the
     * daily reminder workflow. This intentionally performs no reminder
     * evaluation, pending-sheet generation, attendance update, dashboard
     * refresh, cache write, or audit logging.
     * @returns {number} Number of queue rows generated.
     */
    const generateMessageQueueFromPending = () => {
        const config = ConfigLoader.load();
        const dryRun = String(config['Dry_Run']).toUpperCase() === 'TRUE';
        const tz = config['Timezone'] || 'Asia/Dhaka';

        SheetService.clearDataKeepHeaders('Message_Queue');

        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const pendingTsoSheet = ss.getSheetByName('Pending_TSO');
        if (!pendingTsoSheet || pendingTsoSheet.getLastRow() <= 1) return 0;

        const pendingTsoRows = pendingTsoSheet
            .getRange(2, 1, pendingTsoSheet.getLastRow() - 1, pendingTsoSheet.getLastColumn())
            .getValues();
        const queueRows = [];
        const timestamp = new Date();
        const provider = config['NOTIFICATION_PROVIDER'] || 'WhatsApp';

        const messageDraft = String(config['MESSAGE_DRAFT'] || config['REMINDER_MESSAGE_DRAFT'] || 'WITH_DEADLINE').toUpperCase().trim();
        const nextDayDate = DateUtils.getNextDayDate(timestamp, tz);
        const formattedNextDayDate = DateUtils.formatDate(nextDayDate, tz);
        const withDeadlineText = `${formattedNextDayDate} 10.00 থেকে সকাল 11.00 টা`;
        const formattedTodayDate = DateUtils.formatDate(timestamp, tz);
        const standardDeadlineText = `আজ (${formattedTodayDate}) সকাল 10.00 থেকে 11.00 টা`;

        for (let i = 0; i < pendingTsoRows.length; i++) {
            const row = pendingTsoRows[i];
            const salesDate = row[1];
            const tsoId = row[2];
            const tsoName = row[3];
            const tsoPhone = row[4];
            const pendingSrCount = row[7];
            const pendingSrList = row[8];
            const targetPhone = getDestinationPhone(tsoPhone, config);

            let messageBody;
            const isDraft2 = messageDraft === 'STANDARD' || messageDraft === 'DRAFT_2' || messageDraft === 'DRAFT 2';
            if (isDraft2) {
                messageBody = `আসসালামু আলাইকুম।\n\nপ্রিয় ${tsoName},\n\n📢 সেলস পোস্টিং রিমাইন্ডার\n\n📅 রিপোর্টিং তারিখ: ${salesDate}\n⏰ পোস্টিংয়ের শেষ সময়: ${standardDeadlineText}\n\n📌 মোট বাকি এসআর: ${pendingSrCount} জন\n\nবাকি থাকা এসআরদের তালিকা:\n\n${pendingSrList}\n\nঅনুগ্রহ করে নির্ধারিত সময়সীমার মধ্যে উপরের এসআরদের সেলস পোস্টিং সম্পন্ন করুন।\n\n⚠️ কোনো এসআর Close হয়ে থাকলে অনুগ্রহ করে সংশ্লিষ্ট গ্রুপে জানাবেন।\n\nℹ️ যদি ইতোমধ্যে সেলস পোস্টিং সম্পন্ন হয়ে থাকে, কোনো এসার ছুটিতে থাকে কিংবা সেলস না থাকে তাহলে অনুগ্রহ করে এই বার্তাটি উপেক্ষা করুন।\n\nধন্যবাদ।`;
            } else {
                messageBody = `আসসালামু আলাইকুম।\n\nপ্রিয় ${tsoName},\n\n📢 সেলস পোস্টিং রিমাইন্ডার\n\n📅 রিপোর্টিং তারিখ: *${salesDate}*\n⏰ পোস্টিংয়ের শেষ সময়: *${withDeadlineText}*\n\n📌 মোট বাকি এসআর: ${pendingSrCount} জন\n\nবাকি থাকা এসআরদের তালিকা:\n\n${pendingSrList}\n\nঅনুগ্রহ করে নির্ধারিত সময়সীমার মধ্যে উপরের এসআরদের সেলস পোস্টিং সম্পন্ন করুন।\n\n⚠️ কোনো এসআর Close হয়ে থাকলে অনুগ্রহ করে সংশ্লিষ্ট গ্রুপে জানাবেন।\n\nℹ️ যদি ইতোমধ্যে সেলস পোস্টিং সম্পন্ন হয়ে থাকে, কোনো এসার ছুটিতে থাকে কিংবা সেলস না থাকে তাহলে অনুগ্রহ করে এই বার্তাটি উপেক্ষা করুন।\n\nধন্যবাদ।`;
            }

            queueRows.push([
                Utilities.getUuid(), timestamp, provider, tsoName, targetPhone, 'TSO',
                tsoId, tsoName, salesDate, pendingSrCount, pendingSrList,
                messageBody, 'PENDING', 0, timestamp, '', '', '', '', '', '', '', ''
            ]);
        }

        SheetService.writeMessageQueue(queueRows);
        return queueRows.length;
    };

    return { processReminders, generateMessageQueueFromPending, buildRsmQueueRows };
})();
