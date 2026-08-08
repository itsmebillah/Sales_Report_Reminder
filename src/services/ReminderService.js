const ReminderService = (() => {

    /**
     * Helper to compute the final destination phone number used by WhatsApp Service.
     */
    const getDestinationPhone = (rawPhone, config) => {
        const isTestMode = String(config['TEST_MODE']).toUpperCase() === 'TRUE';
        const overridePhone = String(config['OVERRIDE_PHONE'] || '').trim();
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
        const { tsoMap, srMap } = SheetService.readContactMap(); // Reading from Contact list sheet
        const salesRecords = SheetService.readDailySalesForDayBySR(targetDayInt); // Reading from Sales sheet

        // Phase 1 Queue Cleanup (Ensuring clean storage at runtime)
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
                const currentLevel = cacheMap[srId] || 'NONE';
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

        // Execute Queue Extraction
        for (const tsoId in tsoGroups) {
            const group = tsoGroups[tsoId];

            const srCount = group.srs.length;
            // Format strictly as bulleted list matching the exact spec
            const srList = group.srs.map(s => `• ${s.SR_ID} - ${s.SR_Name || s.SR_NAME}`).join("\n");

            // Exact message body
            const messageBody = `আসসালামু আলাইকুম।\n\nপ্রিয় ${group.tsoName},\n\n📢 সেলস পোস্টিং রিমাইন্ডার\n\n📅 রিপোর্টিং তারিখ: ${formattedSalesDate}\n\n📌 মোট বাকি এসআর: ${srCount} জন\n\nবাকি থাকা এসআরদের তালিকা:\n\n${srList}\n\nঅনুগ্রহ করে নির্ধারিত সময়সীমার মধ্যে উপরের এসআরদের সেলস পোস্টিং সম্পন্ন করুন।\n\n⚠️ কোনো এসআর Close হয়ে থাকলে অনুগ্রহ করে সংশ্লিষ্ট গ্রুপে জানাবেন।\n\nℹ️ যদি ইতোমধ্যে সেলস পোস্টিং সম্পন্ন হয়ে থাকে, তাহলে অনুগ্রহ করে এই বার্তাটি উপেক্ষা করুন।\n\nধন্যবাদ।`;

            const queueId = Utilities.getUuid();
            const provider = config['NOTIFICATION_PROVIDER'] || 'WhatsApp';
            const targetPhone = getDestinationPhone(group.tsoPhone, config);

            if (!dryRun) {
                // Queue_ID, Timestamp, Provider, Recipient_Name, Recipient_Phone, Recipient_Type, 
                // TSO_ID, TSO_Name, Sales_Date, Pending_SR_Count, Pending_SR_List, 
                // Message_Body, Status, Retry_Count, Created_At, Sent_At, Error_Message
                messageQueueRows.push([
                    queueId, timestamp, provider, group.tsoName, targetPhone, "TSO",
                    group.tsoId, group.tsoName, formattedSalesDate, srCount, srList,
                    messageBody, "PENDING", 0, timestamp, "", ""
                ]);
            }

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

        if (!dryRun) {
            SheetService.writePendingSRs(pendingSrRows);
            SheetService.writePendingTSOs(pendingTsoRows);
            SheetService.writeMessageQueue(messageQueueRows);
        }

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

    return { processReminders };
})();
