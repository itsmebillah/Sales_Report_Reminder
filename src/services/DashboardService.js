/**
 * @fileoverview DashboardService.js
 * @responsibility Generates and refreshes the operational 'Dashboard' sheet with 
 * actionable status, execution metrics, validation counts, and cleanup details.
 */

const DashboardService = (() => {

    /**
     * Refreshes the Dashboard sheet automatically after execution.
     * @param {Object} summary Metrics and execution summary.
     */
    const refreshDashboard = (summary) => {
        try {
            const ss = SpreadsheetApp.getActiveSpreadsheet();
            if (!ss) return;

            let sheet = ss.getSheetByName('Dashboard');
            if (!sheet) {
                sheet = ss.insertSheet('Dashboard', 0); // Position as 1st tab
            }

            const config = ConfigLoader.load();
            const tz = config['Timezone'] || 'Asia/Dhaka';
            const nowStr = Utilities.formatDate(new Date(), tz, "dd-MMM-yyyy HH:mm:ss");

            const isWhatsappEnabled = String(config['WhatsApp_Enabled']).toUpperCase() === 'TRUE';
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
            const logRetention = config['LOG_RETENTION_DAYS'] || 10;

            const schedulerTime = String(config['Scheduler_Time'] || '09:00');
            const schedulerStatus = `ACTIVE (Daily at ${schedulerTime})`;

            // Estimated Next Run (Tomorrow at scheduler hour)
            const hour = parseInt(schedulerTime.split(':')[0], 10) || 9;
            const nextRunDate = new Date();
            nextRunDate.setDate(nextRunDate.getDate() + 1);
            nextRunDate.setHours(hour, 0, 0, 0);
            const nextRunStr = Utilities.formatDate(nextRunDate, tz, "dd-MMM-yyyy HH:mm:ss") + " (Estimated)";

            const execTimeSec = ((summary.executionTimeMs || 0) / 1000).toFixed(2) + " seconds";

            const cleanupInfo = summary.cleanupResult || {};
            const lastCleanupTime = cleanupInfo.timestamp ? Utilities.formatDate(new Date(cleanupInfo.timestamp), tz, "dd-MMM-yyyy HH:mm:ss") : "N/A";
            const purgedReminders = cleanupInfo.reminderPurged || 0;
            const purgedLogs = cleanupInfo.logPurged || 0;

            const attMetrics = summary.attendanceMetrics || {};
            const archiveStats = AttendanceService.getArchiveStats(ss);
            const lastSyncTime = String(config['LAST_ATTENDANCE_SYNC'] || 'N/A');

            const attendancePctStr = (attMetrics.overallAttendancePct !== undefined)
                ? (attMetrics.overallAttendancePct * 100).toFixed(1) + "%"
                : "0.0%";

            // Operational Dashboard Layout Matrix
            const rows = [
                ["SALES AUTOMATION — OPERATIONAL DASHBOARD", ""],
                ["Last Refreshed Timestamp", nowStr],
                ["Overall System Status", summary.success !== false ? "OPERATIONAL" : "DEGRADED"],
                ["", ""],
                ["SYSTEM CONFIGURATION & STATUS", ""],
                ["WhatsApp Integration Enabled", isWhatsappEnabled ? "YES" : "NO"],
                ["Execution Mode", execMode],
                ["Scheduler Status", schedulerStatus],
                ["Configured Timezone", tz],
                ["Data Retention Policy", `Reminder_System: ${reminderRetention} Days | Logs: ${logRetention} Days`],
                ["", ""],
                [`SALES ATTENDANCE MODULE SUMMARY (${attMetrics.currentMonth || 'Current Month'})`, ""],
                ["Current Attendance Month", attMetrics.currentMonth || "N/A"],
                ["Today's Present SRs", attMetrics.todayPresent || 0],
                ["Today's Absent SRs", attMetrics.todayAbsent || 0],
                ["Overall Monthly Attendance %", attendancePctStr],
                ["Last Attendance Sync Time", lastSyncTime],
                ["Last Archive Month", archiveStats.lastArchiveMonth],
                ["Total Archived Months", archiveStats.totalArchivedMonths],
                ["", ""],
                [`TODAY'S PROCESSING SUMMARY (${summary.targetDate || 'Target Date'})`, ""],
                ["Total SR Evaluated", summary.totalSREvaluated || 0],
                ["Total Present SR", summary.totalPresent || 0],
                ["Total Pending SR", summary.totalPending || 0],
                ["Total TSO Messages", summary.totalTSOMessages || 0],
                ["WhatsApp Messages Sent", summary.sentCount || 0],
                ["WhatsApp Messages Failed", summary.failedCount || 0],
                ["WhatsApp Messages Skipped", summary.skippedCount || 0],
                ["", ""],
                ["STAGE-WISE VALIDATION SUMMARY", ""],
                ["Stage 1: Hierarchy Missing (HIERARCHY_NOT_FOUND)", summary.hierarchyMissingCount || 0],
                ["Stage 2: Contact List Missing (CONTACT_NOT_FOUND)", summary.contactMissingCount || 0],
                ["Stage 3: Phone Number Missing (PHONE_NOT_FOUND)", summary.phoneMissingCount || 0],
                ["", ""],
                ["EXECUTION & RETENTION TIMELINE", ""],
                ["Last Run Timestamp", nowStr],
                ["Estimated Next Scheduled Run", nextRunStr],
                ["Total Execution Duration", execTimeSec],
                ["Last Retention Cleanup Executed", lastCleanupTime],
                ["Records Purged in Last Cleanup", `Reminder_System: ${purgedReminders} rows | Logs: ${purgedLogs} rows`]
            ];

            sheet.clearContents();
            sheet.getRange(1, 1, rows.length, 2).setValues(rows);

            // Styling & Formatting
            sheet.getRange(1, 1, 1, 2).merge().setFontWeight('bold').setFontSize(13).setBackground('#1b365d').setFontColor('#ffffff');
            sheet.getRange(5, 1, 1, 2).merge().setFontWeight('bold').setBackground('#4a6b82').setFontColor('#ffffff');
            sheet.getRange(12, 1, 1, 2).merge().setFontWeight('bold').setBackground('#4a6b82').setFontColor('#ffffff');
            sheet.getRange(21, 1, 1, 2).merge().setFontWeight('bold').setBackground('#4a6b82').setFontColor('#ffffff');
            sheet.getRange(30, 1, 1, 2).merge().setFontWeight('bold').setBackground('#4a6b82').setFontColor('#ffffff');
            sheet.getRange(35, 1, 1, 2).merge().setFontWeight('bold').setBackground('#4a6b82').setFontColor('#ffffff');

            sheet.getRange(2, 1, 2, 1).setFontWeight('bold');
            sheet.getRange(6, 1, 5, 1).setFontWeight('bold');
            sheet.getRange(13, 1, 7, 1).setFontWeight('bold');
            sheet.getRange(22, 1, 7, 1).setFontWeight('bold');
            sheet.getRange(31, 1, 3, 1).setFontWeight('bold');
            sheet.getRange(36, 1, 5, 1).setFontWeight('bold');

            // Highlight Overall System Status
            const statusCell = sheet.getRange(3, 2);
            if (summary.success !== false) {
                statusCell.setBackground('#d4edda').setFontColor('#155724').setFontWeight('bold');
            } else {
                statusCell.setBackground('#f8d7da').setFontColor('#721c24').setFontWeight('bold');
            }

            sheet.autoResizeColumns(1, 2);
            sheet.setColumnWidth(1, 360);
            sheet.setColumnWidth(2, 420);

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

    return { refreshDashboard };
})();
