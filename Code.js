// Pure Test Diagnostic Suite without API or Log side-effects
function doGet(e) {
    try {
        const configDays = 3;
        const tz = 'Asia/Dhaka';
        const targetDate = DateUtils.getTargetSalesDate(configDays, tz);
        const dayInt = DateUtils.getDayOfMonth(targetDate);
        const formattedDate = DateUtils.formatDate(targetDate, tz);

        const hMap = SheetService.readHierarchyBySR();
        const sRecords = SheetService.readDailySalesForDayBySR(dayInt);

        // Group records by SR
        const sGroups = {};
        for (let r of sRecords) {
            if (!sGroups[r.SR_ID]) sGroups[r.SR_ID] = 0;
            sGroups[r.SR_ID] += r.Sales_Volume;
        }

        // Cross match
        const srList = [];
        const unmatchedSRFromSales = [];

        let totalPresent = 0;
        let totalPending = 0;
        const pendingSRs = [];

        // Identify unmapped sales (Records existing in Sales but not mapped in Contact list core)
        for (let r of sRecords) {
            if (!hMap[r.SR_ID] && !unmatchedSRFromSales.includes(r.SR_ID)) {
                unmatchedSRFromSales.push(r.SR_ID);
            }
        }

        for (let srId in hMap) {
            const hier = hMap[srId];
            const val = sGroups[srId] || 0;

            const status = val > 0 ? "Present" : "Pending";

            srList.push({
                srId: srId,
                srName: hier.SR_Name,
                salesValue: val,
                status: status
            });

            if (val > 0) {
                totalPresent++;
            } else {
                totalPending++;
                pendingSRs.push(hier);
            }
        }

        // TSO Message Groupings Calculation
        const tsoGroups = {};
        for (let hier of pendingSRs) {
            const tsoId = hier.TSO_ID;
            if (!tsoGroups[tsoId]) {
                tsoGroups[tsoId] = {
                    tsoId: tsoId,
                    tsoName: hier.TSO_Name,
                    tsoPhone: hier.TSO_Phone,
                    srs: []
                };
            }
            tsoGroups[tsoId].srs.push(hier);
        }

        let wMessages = [];
        for (const tsoId in tsoGroups) {
            const group = tsoGroups[tsoId];
            let srCount = group.srs.length;
            let srListString = group.srs.map(s => `• ${s.SR_ID} - ${s.SR_Name}`).join("\n");
            const msg = `📢 Sales Posting Reminder\n\nDear ${group.tsoName},\n\nThe following SR(s) have not submitted their sales posting.\n\nSales Date: ${formattedDate}\n\nPending SR List:\n\n${srListString}\n\nTotal Pending SR: ${srCount}\n\nPlease ensure all pending sales are submitted before the reporting deadline.`;

            wMessages.push({
                tsoId: group.tsoId,
                tsoName: group.tsoName,
                tsoPhone: group.tsoPhone,
                totalPendingSR: srCount,
                pendingSRList: group.srs.map(s => ({ id: s.SR_ID, name: s.SR_Name })),
                generatedMessage: msg
            });
        }

        return ContentService.createTextOutput(JSON.stringify({
            success: true,
            targetDate: formattedDate,
            srEvaluations: srList,
            tsoGroupings: wMessages,
            metrics: {
                total_sr_processed: srList.length,
                total_present: totalPresent,
                total_pending: totalPending,
                total_tso_messages: wMessages.length,
                total_unmatched: unmatchedSRFromSales.length,
                unmatched_sr_from_sales: unmatchedSRFromSales
            }
        }, null, 2)).setMimeType(ContentService.MimeType.JSON);

    } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({
            success: false,
            error: String(err),
            stack: String(err.stack)
        })).setMimeType(ContentService.MimeType.JSON);
    }
}
