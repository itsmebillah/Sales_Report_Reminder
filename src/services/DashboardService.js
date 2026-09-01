/**
 * @fileoverview DashboardService.js
 * @responsibility Generates and refreshes the operational 'Dashboard' sheet with 
 * actionable status, execution metrics, validation counts, and cleanup details.
 */

const DashboardService = (() => {
    const escapeHtml = (value) => String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const buildTable = (headers, rows) => {
        const headerHtml = headers.map(header => `<th>${escapeHtml(header)}</th>`).join('');
        const bodyHtml = rows.map(row => `<tr>${headers.map((_, index) => {
            const value = escapeHtml(row[index]).replace(/\r?\n/g, '<br>');
            return `<td>${value}</td>`;
        }).join('')}</tr>`).join('');

        return `<table>
  <colgroup>
    <col style="width:9%"><col style="width:9%"><col style="width:7%">
    <col style="width:14%"><col style="width:9%"><col style="width:7%">
    <col style="width:14%"><col style="width:5%"><col style="width:26%">
  </colgroup>
  <thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody>
</table>`;
    };

    /**
     * Refreshes the Dashboard sheet automatically after execution.
     * @param {Object} summary Metrics and execution summary.
     */
    const refreshDashboard = (summaryObj) => {
        const summary = summaryObj || {};
        try {
            const ss = SpreadsheetApp.getActiveSpreadsheet();
            if (!ss) return;

            let sheet = ss.getSheetByName('Dashboard');
            if (!sheet) {
                sheet = ss.insertSheet('Dashboard', 0); // Position as 1st tab
            }

            // Read existing values from Dashboard to preserve metrics when not provided in summary
            const existingValues = {};
            try {
                const data = sheet.getDataRange().getDisplayValues();
                data.forEach(r => {
                    if (r[0]) {
                        existingValues[String(r[0]).trim()] = r[1] !== undefined ? String(r[1]).trim() : '';
                    }
                });
            } catch (e) {
                console.log("No existing dashboard data found or sheet is empty: " + e);
            }

            // Helpers to merge summary values with existing values or defaults
            const getVal = (key, newValue, defaultValue) => {
                if (newValue !== undefined && newValue !== null) return newValue;
                const existing = existingValues[key];
                if (existing !== undefined && existing !== null && existing !== '') return existing;
                return defaultValue;
            };

            const getNum = (key, newValue, defaultValue) => {
                if (newValue !== undefined && newValue !== null) return Number(newValue);
                const existing = existingValues[key];
                if (existing !== undefined && existing !== null && existing !== '') {
                    const parsed = Number(existing.replace(/%/g, '').replace(/,/g, '').trim());
                    return isNaN(parsed) ? existing : parsed;
                }
                return defaultValue;
            };

            const config = ConfigLoader.load();
            const tz = config['Timezone'] || 'Asia/Dhaka';
            const nowStr = Utilities.formatDate(new Date(), tz, "dd-MMM-yyyy HH:mm:ss");

            const isWhatsappEnabled = String(
                config['WHATSAPP_ENABLED'] !== undefined ? config['WHATSAPP_ENABLED'] : config['WhatsApp_Enabled']
            ).toUpperCase() === 'TRUE';
            const isDryRun = String(config['Dry_Run']).toUpperCase() === 'TRUE';
            const isTestMode = String(config['TEST_MODE']).toUpperCase() === 'TRUE';
            const overridePhone = String(config['OVERRIDE_PHONE'] || '').trim();

            let execMode = "PRODUCTION (Live WhatsApp API)";
            if (isTestMode && overridePhone !== '') {
                execMode = `TEST MODE (Redirected to Override Phone: ${overridePhone})`;
            } else if (isDryRun) {
                execMode = "DRY RUN (Simulated Transmission)";
            }

            const reminderRetention = config['REMINDER_RETENTION_DAYS'] || 30;

            // Robust parsing of time-only cells (which are read as Date objects in Apps Script)
            let schedulerTime = '09:00';
            const rawSchedTime = config['Scheduler_Time'];
            if (rawSchedTime instanceof Date) {
                schedulerTime = Utilities.formatDate(rawSchedTime, tz, "HH:mm");
            } else if (rawSchedTime) {
                const strTime = String(rawSchedTime).trim();
                if (strTime.includes('1899')) {
                    try {
                        const dateObj = new Date(strTime);
                        schedulerTime = Utilities.formatDate(dateObj, tz, "HH:mm");
                    } catch (e) {
                        schedulerTime = strTime;
                    }
                } else {
                    // Extract time using regex if formatted as e.g. "04:00:00 PM"
                    const match = strTime.match(/(\d{1,2}):(\d{2})/);
                    if (match) {
                        let h = parseInt(match[1], 10);
                        const m = match[2];
                        const isPm = strTime.toUpperCase().includes('PM');
                        const isAm = strTime.toUpperCase().includes('AM');
                        if (isPm && h < 12) h += 12;
                        if (isAm && h === 12) h = 0;
                        schedulerTime = `${String(h).padStart(2, '0')}:${m}`;
                    } else {
                        schedulerTime = strTime;
                    }
                }
            }

            // Convert 24-hour format string (e.g. "16:00") to 12-hour format string (e.g. "04:00 PM") for dashboard display
            let displayTime = schedulerTime;
            const timeParts = schedulerTime.split(':');
            if (timeParts.length === 2) {
                let h = parseInt(timeParts[0], 10);
                const m = timeParts[1];
                const ampm = h >= 12 ? 'PM' : 'AM';
                let displayH = h % 12;
                if (displayH === 0) displayH = 12;
                displayTime = `${String(displayH).padStart(2, '0')}:${m} ${ampm}`;
            }

            const workflowTriggerCount = Number(config['SCHEDULER_TRIGGER_WORKFLOW_COUNT'] || 0);
            const legacyTriggerCount = Number(config['SCHEDULER_TRIGGER_LEGACY_COUNT'] || 0);
            const dailyTriggerCount = Number(config['SCHEDULER_TRIGGER_DAILY_COUNT'] || 0);
            const schedulerHealthy = workflowTriggerCount === 1 && legacyTriggerCount === 0 && dailyTriggerCount === 1;
            const schedulerStatus = `${schedulerHealthy ? 'ACTIVE' : 'CHECK REQUIRED'} (Daily near ${displayTime})`;

            // Estimated Next Run (Tomorrow at scheduler hour)
            const hour = parseInt(schedulerTime.split(':')[0], 10) || 9;
            const minute = parseInt(schedulerTime.split(':')[1], 10) || 0;
            const nextRunDate = new Date();
            nextRunDate.setDate(nextRunDate.getDate() + 1);
            nextRunDate.setHours(hour, minute, 0, 0);
            const nextRunStr = Utilities.formatDate(nextRunDate, tz, "dd-MMM-yyyy HH:mm:ss") + " (Estimated)";

            const execTimeSec = summary.executionTimeMs !== undefined 
                ? ((summary.executionTimeMs) / 1000).toFixed(2) + " seconds"
                : (existingValues["Total Execution Duration"] || "0.00 seconds");

            const cleanupInfo = summary.cleanupResult || {};
            const lastCleanupTime = cleanupInfo.timestamp 
                ? Utilities.formatDate(new Date(cleanupInfo.timestamp), tz, "dd-MMM-yyyy HH:mm:ss") 
                : (existingValues["Last Retention Cleanup Executed"] || "N/A");
            const purgedReminders = cleanupInfo.reminderPurged !== undefined
                ? cleanupInfo.reminderPurged
                : getNum("Records Purged in Last Cleanup", undefined, 0);

            const attMetrics = summary.attendanceMetrics || {};
            const archiveStats = AttendanceService.getArchiveStats(ss);
            const lastSyncTime = String(config['LAST_ATTENDANCE_SYNC'] || 'N/A');

            const attendancePctStr = (attMetrics.overallAttendancePct !== undefined)
                ? (attMetrics.overallAttendancePct * 100).toFixed(1) + "%"
                : (existingValues["Overall Monthly Attendance %"] || "0.0%");

            const attTotalCells = attMetrics.totalCells !== undefined
                ? attMetrics.totalCells
                : (attMetrics.todayPresent || 0) + (attMetrics.todayAbsent || 0);

            const procTotalCells = summary.totalCellKPI !== undefined
                ? summary.totalCellKPI
                : (getNum("Total Present SR", summary.totalPresent, 0) + getNum("Total Pending SR", summary.totalPending, 0));

            // Operational Dashboard Layout Matrix
            const rows = [
                ["SALES AUTOMATION — OPERATIONAL DASHBOARD", ""],
                ["Last Refreshed Timestamp", nowStr],
                ["Overall System Status", getVal("Overall System Status", summary.success !== undefined ? (summary.success !== false ? "OPERATIONAL" : "DEGRADED") : undefined, "OPERATIONAL")],
                ["SYSTEM CONFIGURATION & STATUS", ""],
                ["WhatsApp Integration Enabled", isWhatsappEnabled ? "YES" : "NO"],
                ["Execution Mode", execMode],
                ["Scheduler Status", schedulerStatus],
                ["Configured Timezone", tz],
                ["Data Retention Policy", `Reminder_System: ${reminderRetention} Days | Logs: Append-only history`],
                [`SALES ATTENDANCE MODULE SUMMARY (${attMetrics.currentMonth || existingValues["Current Attendance Month"] || 'Current Month'})`, ""],
                ["Current Attendance Month", getVal("Current Attendance Month", attMetrics.currentMonth, "N/A")],
                ["Today's Present SRs", getNum("Today's Present SRs", attMetrics.todayPresent, 0)],
                ["Today's Absent SRs", getNum("Today's Absent SRs", attMetrics.todayAbsent, 0)],
                ["Overall Monthly Attendance %", attendancePctStr],
                ["Last Attendance Sync Time", lastSyncTime],
                ["Last Archive Month", archiveStats.lastArchiveMonth],
                ["Total Archived Months", archiveStats.totalArchivedMonths],
                [`TODAY'S PROCESSING SUMMARY (${summary.targetDate || existingValues["Today's Processing Summary Date"] || 'Target Date'})`, ""],
                ["Total SR Evaluated", getNum("Total SR Evaluated", summary.totalSREvaluated, 0)],
                ["Total Present SR", getNum("Total Present SR", summary.totalPresent, 0)],
                ["Total Pending SR", getNum("Total Pending SR", summary.totalPending, 0)],
                ["Total Sales KPI", getNum("Total Sales KPI", procTotalCells, 0)],
                ["Total TSO Messages", getNum("Total TSO Messages", summary.totalTSOMessages, 0)],
                ["WhatsApp Messages Sent", getNum("WhatsApp Messages Sent", summary.sentCount, 0)],
                ["WhatsApp Messages Failed", getNum("WhatsApp Messages Failed", summary.failedCount, 0)],
                ["WhatsApp Messages Skipped", getNum("WhatsApp Messages Skipped", summary.skippedCount, 0)],
                ["STAGE-WISE VALIDATION SUMMARY", ""],
                ["Stage 1: Hierarchy Missing (HIERARCHY_NOT_FOUND)", getNum("Stage 1: Hierarchy Missing (HIERARCHY_NOT_FOUND)", summary.hierarchyMissingCount, 0)],
                ["Stage 2: Contact List Missing (CONTACT_NOT_FOUND)", getNum("Stage 2: Contact List Missing (CONTACT_NOT_FOUND)", summary.contactMissingCount, 0)],
                ["Stage 3: Phone Number Missing (PHONE_NOT_FOUND)", getNum("Stage 3: Phone Number Missing (PHONE_NOT_FOUND)", summary.phoneMissingCount, 0)],
                ["EXECUTION & RETENTION TIMELINE", ""],
                ["Last Run Timestamp", getVal("Last Run Timestamp", nowStr, nowStr)],
                ["Estimated Next Scheduled Run", getVal("Estimated Next Scheduled Run", nextRunStr, nextRunStr)],
                ["Total Execution Duration", execTimeSec],
                ["Last Retention Cleanup Executed", lastCleanupTime],
                ["Records Purged in Last Cleanup", typeof purgedReminders === 'number' ? `Reminder_System: ${purgedReminders} rows` : purgedReminders]
            ];

            // Refresh only the operational area. Dashboard C:E is persistent
            // configuration storage and must never be cleared by metric refreshes.
            const operationalRange = sheet.getRange(1, 1, sheet.getMaxRows(), 2);
            operationalRange.breakApart().clearContent().clearFormat().clearDataValidations().clearNote();

            // Re-write fresh clean values
            sheet.getRange(1, 1, rows.length, 2).setValues(rows);
            sheet.getRange(1, 2, rows.length, 1).setNumberFormat('@'); // Format value column B as plain text

            // Styling & Formatting. Values, formulas, row order, and report
            // calculations above remain unchanged; this is presentation only.
            const reportHeaderColor = '#17324d';
            const reportSectionColor = '#365f78';
            const reportBorderColor = '#d9e2ea';
            const sectionRows = [4, 10, 18, 27, 31];
            const screenFitLastRow = 36;

            sheet.getRange(1, 1, rows.length, 2)
                .setFontFamily('Arial')
                .setFontSize(8)
                .setVerticalAlignment('middle')
                .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
            sheet.setRowHeightsForced(1, rows.length, 31);
            sheet.getRange(2, 1, rows.length - 1, 1).setBackground('#f7f9fb');

            sheet.getRange(1, 1, 1, 2).merge()
                .setFontWeight('bold').setFontSize(12)
                .setBackground(reportHeaderColor).setFontColor('#ffffff')
                .setHorizontalAlignment('left');
            sheet.setRowHeight(1, 31);
            sectionRows.forEach(row => {
                sheet.getRange(row, 1, 1, 2).merge()
                    .setFontWeight('bold').setFontSize(8)
                    .setBackground(reportSectionColor).setFontColor('#ffffff')
                    .setHorizontalAlignment('left');
                sheet.setRowHeight(row, 31);
            });

            sheet.getRange(2, 1, rows.length - 1, 2)
                .setBorder(true, true, true, true, true, true, reportBorderColor, SpreadsheetApp.BorderStyle.SOLID);

            sheet.getRange(2, 1, 2, 1).setFontWeight('bold');
            sheet.getRange(5, 1, 5, 1).setFontWeight('bold');
            sheet.getRange(11, 1, 7, 1).setFontWeight('bold');
            sheet.getRange(19, 1, 8, 1).setFontWeight('bold');
            sheet.getRange(28, 1, 3, 1).setFontWeight('bold');
            sheet.getRange(32, 1, 5, 1).setFontWeight('bold');

            // Highlight Overall System Status
            const statusCell = sheet.getRange(3, 2);
            const overallStatus = rows[2][1];
            if (overallStatus === "OPERATIONAL") {
                statusCell.setBackground('#d4edda').setFontColor('#155724').setFontWeight('bold');
            } else {
                statusCell.setBackground('#f8d7da').setFontColor('#721c24').setFontWeight('bold');
            }

            // Keep the operator-critical report in the same 29-row viewport as
            // the four control panels. Detail rows remain intact and can be
            // unhidden when deeper validation/retention history is needed.
            sheet.showRows(1, Math.min(screenFitLastRow, rows.length));
            if (rows.length > screenFitLastRow) {
                sheet.hideRows(screenFitLastRow + 1, rows.length - screenFitLastRow);
            }
            sheet.setColumnWidth(1, 300);
            sheet.setColumnWidth(2, 310);
            // Build/refresh the single configuration control center without
            // changing any existing values.
            ConfigurationService.ensureDashboardConfigurationArea(sheet);

            // BI Dashboard Total Sales KPI Card on J2:K3 merged range
            const kpiHeaderRange = sheet.getRange("J2:K2");
            const kpiValueRange = sheet.getRange("J3:K3");
            const kpiFullRange = sheet.getRange("J2:K3");

            kpiHeaderRange.breakApart().merge()
                .setValue("TOTAL SALES KPI")
                .setFontFamily("Arial")
                .setFontSize(8)
                .setFontWeight("bold")
                .setBackground("#1e293b")
                .setFontColor("#94a3b8")
                .setHorizontalAlignment("center")
                .setVerticalAlignment("middle");

            kpiValueRange.breakApart().merge()
                .setFormula("=Sales!N3")
                .setFontFamily("Arial")
                .setFontSize(16)
                .setFontWeight("bold")
                .setBackground("#0f172a")
                .setFontColor("#38bdf8")
                .setHorizontalAlignment("center")
                .setVerticalAlignment("middle");

            kpiFullRange.setBorder(true, true, true, true, true, true, "#334155", SpreadsheetApp.BorderStyle.SOLID);

            // Today's Sales Entry Tracking Card on J4:K9
            const trackingHeaderRange = sheet.getRange("J4:K4");
            trackingHeaderRange.breakApart().merge()
                .setValue("TODAY'S SALES UPDATES")
                .setFontFamily("Arial")
                .setFontSize(8)
                .setFontWeight("bold")
                .setBackground("#1e293b")
                .setFontColor("#94a3b8")
                .setHorizontalAlignment("center")
                .setVerticalAlignment("middle");
            sheet.setRowHeight(4, 22);

            let savedFirstTime = "";
            let savedPrevTime = "";
            let savedLastTime = "";
            let savedFirstVal = "";
            let savedPrevVal = "";
            try {
                const props = PropertiesService.getScriptProperties();
                savedFirstTime = props.getProperty("TODAY_FIRST_SALES_TIME") || "";
                savedPrevTime = props.getProperty("TODAY_PREV_SALES_TIME") || "";
                savedLastTime = props.getProperty("TODAY_LAST_SALES_TIME") || "";
                savedFirstVal = props.getProperty("TODAY_FIRST_SALES_VALUE") || "";
                savedPrevVal = props.getProperty("TODAY_PREV_SALES_VALUE") || "";
            } catch (e) {}

            const j5Label = savedFirstTime ? `1st Update (${savedFirstTime})` : "1st Update (Initial)";
            const j6Label = savedPrevTime ? `Prev Update (${savedPrevTime})` : "Prev Update (2nd Last)";
            const j7Label = savedLastTime ? `Last Update (${savedLastTime})` : "Last Update (Current)";

            // J5: 1st Update Label (with time)
            sheet.getRange("J5").setValue(j5Label)
                .setFontFamily("Arial")
                .setFontSize(8.5)
                .setFontWeight("bold")
                .setBackground("#f8fafc")
                .setFontColor("#475569")
                .setHorizontalAlignment("left")
                .setVerticalAlignment("middle");
            sheet.setRowHeight(5, 22);

            // K5: 1st Sales Value
            const k5Cell = sheet.getRange("K5");
            const existingK5 = k5Cell.getValue();
            if (existingK5 === "" || existingK5 === null || existingK5 === undefined) {
                if (savedFirstVal !== "") {
                    k5Cell.setValue(Number(savedFirstVal));
                } else {
                    k5Cell.setValue(0);
                }
            }
            k5Cell.setFontFamily("Arial")
                .setFontSize(9)
                .setFontWeight("bold")
                .setBackground("#ffffff")
                .setFontColor("#0f172a")
                .setHorizontalAlignment("right")
                .setVerticalAlignment("middle")
                .setNumberFormat("#,##0.00");

            // J6: Prev Update Label (with time)
            sheet.getRange("J6").setValue(j6Label)
                .setFontFamily("Arial")
                .setFontSize(8.5)
                .setFontWeight("bold")
                .setBackground("#f8fafc")
                .setFontColor("#475569")
                .setHorizontalAlignment("left")
                .setVerticalAlignment("middle");
            sheet.setRowHeight(6, 22);

            // K6: Prev Sales Value
            const k6Cell = sheet.getRange("K6");
            const existingK6 = k6Cell.getValue();
            if (existingK6 === "" || existingK6 === null || existingK6 === undefined) {
                if (savedPrevVal !== "") {
                    k6Cell.setValue(Number(savedPrevVal));
                } else if (savedFirstVal !== "") {
                    k6Cell.setValue(Number(savedFirstVal));
                } else {
                    k6Cell.setValue(0);
                }
            }
            k6Cell.setFontFamily("Arial")
                .setFontSize(9)
                .setFontWeight("bold")
                .setBackground("#ffffff")
                .setFontColor("#0f172a")
                .setHorizontalAlignment("right")
                .setVerticalAlignment("middle")
                .setNumberFormat("#,##0.00");

            // J7: Last Update Label (with time)
            sheet.getRange("J7").setValue(j7Label)
                .setFontFamily("Arial")
                .setFontSize(8.5)
                .setFontWeight("bold")
                .setBackground("#f8fafc")
                .setFontColor("#475569")
                .setHorizontalAlignment("left")
                .setVerticalAlignment("middle");
            sheet.setRowHeight(7, 22);

            // K7: Last Sales Formula pointing to J3
            sheet.getRange("K7").setFormula("=J3")
                .setFontFamily("Arial")
                .setFontSize(9)
                .setFontWeight("bold")
                .setBackground("#ffffff")
                .setFontColor("#0f172a")
                .setHorizontalAlignment("right")
                .setVerticalAlignment("middle")
                .setNumberFormat("#,##0.00");

            // J8: Last Change (Diff) Label
            sheet.getRange("J8").setValue("Last Change (Diff)")
                .setFontFamily("Arial")
                .setFontSize(8.5)
                .setFontWeight("bold")
                .setBackground("#eff6ff")
                .setFontColor("#1d4ed8")
                .setHorizontalAlignment("left")
                .setVerticalAlignment("middle");
            sheet.setRowHeight(8, 22);

            // K8: Last Change Formula (K7 - K6)
            sheet.getRange("K8").setFormula("=IF(ISNUMBER(K6),K7-K6,0)")
                .setFontFamily("Arial")
                .setFontSize(9.5)
                .setFontWeight("bold")
                .setBackground("#eff6ff")
                .setFontColor("#2563eb")
                .setHorizontalAlignment("right")
                .setVerticalAlignment("middle")
                .setNumberFormat("+#,##0.00;-#,##0.00;0.00");

            // J9: Today's Total Entry (Diff) Label
            sheet.getRange("J9").setValue("Today's Entry (Diff)")
                .setFontFamily("Arial")
                .setFontSize(8.5)
                .setFontWeight("bold")
                .setBackground("#f0fdf4")
                .setFontColor("#15803d")
                .setHorizontalAlignment("left")
                .setVerticalAlignment("middle");
            sheet.setRowHeight(9, 22);

            // K9: Today's Total Entry Formula (K7 - K5)
            sheet.getRange("K9").setFormula("=IF(ISNUMBER(K5),K7-K5,0)")
                .setFontFamily("Arial")
                .setFontSize(9.5)
                .setFontWeight("bold")
                .setBackground("#f0fdf4")
                .setFontColor("#16a34a")
                .setHorizontalAlignment("right")
                .setVerticalAlignment("middle")
                .setNumberFormat("+#,##0.00;-#,##0.00;0.00");

            sheet.getRange("J4:K9").setBorder(true, true, true, true, true, true, "#cbd5e1", SpreadsheetApp.BorderStyle.SOLID);
            sheet.setColumnWidth(10, 110);
            sheet.setColumnWidth(11, 110);

            // Apply Protection to make Dashboard read-only except for spreadsheet owner/editors
            try {
                let protection = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0];
                if (!protection) {
                    protection = sheet.protect().setDescription('Dashboard Operational Protection');
                }
                protection.setWarningOnly(false);
                const me = Session.getEffectiveUser();
                if (me) {
                    protection.addEditor(me);
                }
                if (protection.canDomainEdit()) {
                    protection.setDomainEdit(false);
                }
            } catch (protErr) {
                console.log("Dashboard protection assignment note: " + protErr);
            }

        } catch (err) {
            console.log("DashboardService refresh encountered an error: " + err);
        }
    };

    /**
     * Navigates the active user interface to the Dashboard tab.
     */
    const openDashboard = () => {
        try {
            const ss = SpreadsheetApp.getActiveSpreadsheet();
            if (!ss) return;
            const sheet = ss.getSheetByName('Dashboard');
            if (sheet) {
                ss.setActiveSheet(sheet);
            }
        } catch (e) {
            console.log("Error opening dashboard: " + e);
        }
    };

    return { refreshDashboard, openDashboard };
})();
