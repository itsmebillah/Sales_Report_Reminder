/**
 * @fileoverview AttendanceService.js
 * @responsibility Sales Activity Attendance Module. Manages live attendance calculations,
 * monthly summary metrics, conditional formatting (P=Green, A=Red), and month-closing archiving.
 */

const AttendanceService = (() => {

    /**
     * Future holiday ready modular architecture.
     * Evaluates whether a given date is a weekly holiday (Friday) or future custom public holiday.
     */
    const isHoliday = (dateObj, tz) => {
        const dayName = Utilities.formatDate(dateObj, tz || "Asia/Dhaka", "EEE");
        if (dayName === 'Fri') {
            return true;
        }
        // Future custom holiday list evaluation can be inserted here seamlessly
        return false;
    };

    /**
     * Updates live attendance sheet from Sales sheet data.
     * Order of execution: Sales -> Attendance
     * @returns {Object} Metrics for Dashboard update.
     */
    const updateAttendance = () => {
        try {
            const ss = SpreadsheetApp.getActiveSpreadsheet();
            if (!ss) return getEmptyMetrics();

            const config = ConfigLoader.load();
            const tz = config['Timezone'] || 'Asia/Dhaka';
            const reportingDays = parseInt(config['Reporting_Days'], 10) || 3;

            const salesDateObj = DateUtils.getTargetSalesDate(reportingDays, tz);
            const targetDayInt = DateUtils.getDayOfMonth(salesDateObj);

            // Month Closing Check on Archive Day (e.g., 4th day of month)
            checkAndRunArchive(ss, tz, config);

            const now = new Date();
            const activeReportingDate = DateUtils.getReportingMonthDate(now, tz);
            const currentMonthStr = Utilities.formatDate(activeReportingDate, tz, "MMMM yyyy");

            let sheet = ss.getSheetByName('Attendance');
            if (!sheet) {
                sheet = initAttendanceSheet(ss, activeReportingDate, tz);
            } else {
                // Ensure headers (2-row header with dynamic month days and weekdays) are up to date
                refreshAttendanceHeaders(sheet, activeReportingDate, tz);
            }

            const hierarchyMap = SheetService.readHierarchyMap();
            const srIds = Object.keys(hierarchyMap);

            if (srIds.length === 0) {
                return getEmptyMetrics();
            }

            // Read sales activity and dynamic month days info
            const monthlySalesMap = readMonthlySalesData();
            const { weekdays, daysInMonth } = getReportingMonthWeekdays(activeReportingDate, tz);
            const totalCols = 6 + daysInMonth + 3;

            // Evaluate the current date in the project timezone. The active reporting
            // period may be the previous month during the early-month rollover; in that
            // case all dates in that already completed period are eligible.
            const currentDate = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
            const isCurrentReportingMonth = currentDate.getFullYear() === activeReportingDate.getFullYear()
                && currentDate.getMonth() === activeReportingDate.getMonth();
            const attendanceEndDay = isCurrentReportingMonth
                ? Math.min(currentDate.getDate(), daysInMonth)
                : daysInMonth;

            // Build Attendance Matrix
            // Columns: 1: RSM ID, 2: RSM Name, 3: TSO ID, 4: TSO Name, 5: SR ID, 6: SR Name, 7..(6+daysInMonth): Days 1..N, Summary: Present, Absent, %
            const rows = [];
            let todayPresentCount = 0;
            let todayAbsentCount = 0;
            let grandTotalPresent = 0;
            let grandTotalWorkingDaysEvaluated = 0;

            for (let i = 0; i < srIds.length; i++) {
                const srId = srIds[i];
                const hier = hierarchyMap[srId];

                // Defensive validation: ensure required hierarchy fields are present
                if (!hier || !hier.RSM_ID || !hier.TSO_ID || !hier.SR_ID) {
                    console.log(`Hierarchy mapping failed for SR_ID ${srId}`);
                    SheetService.writeLog([
                        new Date(), "N/A", "N/A", srId || "UNKNOWN",
                        hier ? hier.SR_Name : "N/A", hier ? hier.TSO_ID : "N/A", "N/A", hier ? hier.RSM_ID : "N/A",
                        "N/A", Utilities.formatDate(new Date(), tz, "dd-MMM-yyyy"), "ATTENDANCE_VALIDATION", "", "SKIPPED",
                        `Hierarchy mapping failed for SR_ID ${srId}`
                    ]);
                    continue;
                }

                // Reversed Hierarchy Column Order: RSM ID, RSM Name, TSO ID, TSO Name, SR ID, SR Name
                const row = [
                    hier.RSM_ID || '',
                    hier.RSM_Name || '',
                    hier.TSO_ID || '',
                    hier.TSO_Name || '',
                    srId,
                    hier.SR_Name || ''
                ];

                let srPresentCount = 0;
                let srAbsentCount = 0;
                let srWorkingDaysEvaluated = 0;

                const srSalesByDay = monthlySalesMap[srId] || {};
                const isClosed = !!srSalesByDay.isClosed;

                // Find the last day where this SR has sales > 0
                let lastSalesDay = 0;
                for (let d = 1; d <= daysInMonth; d++) {
                    const salesVal = srSalesByDay[d] !== undefined ? srSalesByDay[d] : 0;
                    if (salesVal > 0) {
                        lastSalesDay = d;
                    }
                }

                // Days 1..daysInMonth (Dynamic Month Days)
                for (let d = 1; d <= daysInMonth; d++) {
                    const salesVal = srSalesByDay[d] !== undefined ? srSalesByDay[d] : 0;
                    const dateObj = new Date(activeReportingDate.getFullYear(), activeReportingDate.getMonth(), d);
                    const isWeeklyHoliday = isHoliday(dateObj, tz);

                    if (d <= attendanceEndDay) {
                        if (isClosed && d > lastSalesDay) {
                            row.push('CLOSE');
                        } else if (salesVal > 0) {
                            row.push('P');
                            srPresentCount++;
                            srWorkingDaysEvaluated++;
                            if (d === targetDayInt) todayPresentCount++;
                        } else {
                            if (isWeeklyHoliday) {
                                row.push(''); // Friday blank (does not count as Absent)
                            } else {
                                row.push('A');
                                srAbsentCount++;
                                srWorkingDaysEvaluated++;
                            }
                            if (d === targetDayInt) todayAbsentCount++;
                        }
                    } else {
                        row.push(''); // Future dates remain BLANK
                    }
                }

                // Working Day Aware Attendance Percentage Formula = Present Count / Working Days Evaluated
                const attendancePct = srWorkingDaysEvaluated > 0 ? (srPresentCount / srWorkingDaysEvaluated) : 0;

                row.push(srPresentCount);
                row.push(srAbsentCount);
                row.push(attendancePct);

                grandTotalPresent += srPresentCount;
                grandTotalWorkingDaysEvaluated += srWorkingDaysEvaluated;

                rows.push(row);
            }


            // ── PRESENTATION LAYER: Sort & hierarchical grouping ──────────────────────
            // ONLY display order changes. Attendance values are NOT modified.
            // Level 1: RSM_ID (col 0)  Level 2: TSO_ID (col 2)  Level 3: SR_ID (col 4)
            //
            // Uses plain numeric comparison (Number()) instead of localeCompare with options,
            // which is not reliably supported across all GAS V8 runtime versions.
            function cmpId(x, y) {
                var nx = Number(x), ny = Number(y);
                if (!isNaN(nx) && !isNaN(ny)) return nx - ny;              // numeric IDs
                return String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0; // string IDs
            }
            rows.sort(function(a, b) {
                var r = cmpId(a[0], b[0]); if (r !== 0) return r; // RSM_ID
                var t = cmpId(a[2], b[2]); if (t !== 0) return t; // TSO_ID
                return cmpId(a[4], b[4]);                          // SR_ID
            });

            // Build finalRows: interleave RSM separator rows between sorted data rows.
            // Track sheet row positions for batch formatting (no one-by-one calls).
            const finalRows       = [];
            const rsmHeaderSheetRows = []; // 1-based sheet rows where RSM header rows land
            const tsoFirstSheetRows  = []; // 1-based sheet rows of the first SR of each new TSO group
            let lastRsmId = null;
            let lastTsoId = null;

            for (let i = 0; i < rows.length; i++) {
                const row     = rows[i];
                const rsmId   = String(row[0] || '');
                const rsmName = String(row[1] || '');
                const tsoId   = String(row[2] || '');

                if (rsmId !== lastRsmId) {
                    // Insert RSM separator/header row (data starts at sheet row 3)
                    const hdrRow = new Array(totalCols).fill('');
                    hdrRow[0] = 'RSM: ' + rsmId + ' - ' + rsmName;
                    rsmHeaderSheetRows.push(3 + finalRows.length);
                    finalRows.push(hdrRow);
                    lastRsmId = rsmId;
                    lastTsoId = null; // Reset TSO tracking on each new RSM
                }

                if (tsoId !== lastTsoId && lastTsoId !== null) {
                    // First SR row of a new TSO within the same RSM → subtle top border
                    tsoFirstSheetRows.push(3 + finalRows.length);
                }
                lastTsoId = tsoId;
                finalRows.push(row);
            }

            // Write Attendance data atomically (Fast bulk setValues starting at Row 3)
            if (finalRows.length > 0) {
                // Expand sheet if the extra RSM header rows push beyond current size
                const curMax = sheet.getMaxRows();
                if (2 + finalRows.length > curMax) {
                    sheet.insertRowsAfter(curMax, (2 + finalRows.length) - curMax);
                }

                // Reset ALL data rows: break merges, clear content, reset background & borders
                const dataRowCount = sheet.getMaxRows() - 2;
                if (dataRowCount > 0) {
                    const resetRange = sheet.getRange(3, 1, dataRowCount, totalCols);
                    resetRange.breakApart();                                         // Remove previous RSM merges
                    resetRange.clearContent();
                    resetRange.clearFormat();                                        // Safely reset all formatting to sheet defaults
                }

                sheet.getRange(3, 1, finalRows.length, totalCols).setValues(finalRows);

                // Format Attendance % column (Column totalCols) as Percentage
                sheet.getRange(3, totalCols, finalRows.length, 1).setNumberFormat('0.0%');

                // Apply Friday column background shading
                applyFridayBackgrounds(sheet, finalRows.length, weekdays, daysInMonth);

                // Apply Conditional Formatting for P (Green) & A (Red)
                applyConditionalFormatting(sheet, finalRows.length, daysInMonth, finalRows);

                // ── TSO ALTERNATING ROW BACKGROUND (contiguous-run batch) ────────────────
                // Alternates #FFFFFF / #F7F7F7 on each TSO group change.
                // Uses contiguous run batching: one getRange call per color run, not per row.
                // RSM header rows are skipped here; dark-blue formatting overwrites them below.
                const TSO_BG  = ['#ffffff', '#f7f7f7'];
                const rsmHdrSet = new Set(rsmHeaderSheetRows);
                const colorRuns = [];      // {startRow, endRow, colorIdx}
                let tsoColorIdx  = 0;
                let runStart     = -1;
                let runEnd       = -1;
                let runColor     = -1;
                let prevTsoIdCl  = null;

                for (let ci = 0; ci < finalRows.length; ci++) {
                    const sRow = 3 + ci;
                    if (rsmHdrSet.has(sRow)) {
                        if (runStart !== -1) { colorRuns.push({ startRow: runStart, endRow: runEnd, colorIdx: runColor }); runStart = -1; }
                        tsoColorIdx = 0; prevTsoIdCl = null; // Reset alternation for each RSM group
                        continue;
                    }
                    const rowTso = String(finalRows[ci][2] || '');
                    if (prevTsoIdCl !== null && rowTso !== prevTsoIdCl) { tsoColorIdx = 1 - tsoColorIdx; } // Flip on TSO change
                    prevTsoIdCl = rowTso;
                    if (runStart === -1 || tsoColorIdx !== runColor) {
                        if (runStart !== -1) { colorRuns.push({ startRow: runStart, endRow: runEnd, colorIdx: runColor }); }
                        runStart = sRow; runEnd = sRow; runColor = tsoColorIdx;
                    } else {
                        runEnd = sRow;
                    }
                }
                if (runStart !== -1) { colorRuns.push({ startRow: runStart, endRow: runEnd, colorIdx: runColor }); }

                for (let cr = 0; cr < colorRuns.length; cr++) {
                    const run = colorRuns[cr];
                    sheet.getRange(run.startRow, 1, run.endRow - run.startRow + 1, totalCols)
                         .setBackground(TSO_BG[run.colorIdx]);
                }
                // ─────────────────────────────────────────────────────────────────────────

                // ── RSM HEADER FORMATTING (batch loop) ───────────────────────────────────

                // Runs AFTER applyFridayBackgrounds so dark-blue overrides the white/gray reset.
                for (let h = 0; h < rsmHeaderSheetRows.length; h++) {
                    const rowNum = rsmHeaderSheetRows[h];
                    sheet.getRange(rowNum, 1, 1, 6).merge();             // Merge A:F for clean title
                    sheet.getRange(rowNum, 1, 1, totalCols)
                         .setBackground('#1b365d')
                         .setFontColor('#ffffff')
                         .setFontWeight('bold')
                         .setFontSize(12);
                }

                // ── TSO GROUP TOP BORDER (batch loop) ─────────────────────────────────────
                for (let t = 0; t < tsoFirstSheetRows.length; t++) {
                    const rowNum = tsoFirstSheetRows[t];
                    sheet.getRange(rowNum, 1, 1, totalCols)
                         .setBorder(true, false, false, false, false, false,
                                    '#555555', SpreadsheetApp.BorderStyle.SOLID);
                }
            }


            const overallPct = grandTotalWorkingDaysEvaluated > 0 ? (grandTotalPresent / grandTotalWorkingDaysEvaluated) : 0;

            return {
                currentMonth: currentMonthStr,
                todayPresent: todayPresentCount,
                todayAbsent: todayAbsentCount,
                overallAttendancePct: overallPct
            };

        } catch (err) {
            console.log("AttendanceService update encountered an error: " + err);
            return getEmptyMetrics();
        }
    };

    /**
     * Generates weekday short names and exact days count for the target reporting month.
     */
    const getReportingMonthWeekdays = (reportingDate, tz) => {
        const weekdays = [];
        const year = reportingDate.getFullYear();
        const month = reportingDate.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month, d);
            const dayName = Utilities.formatDate(dateObj, tz || "Asia/Dhaka", "EEE");
            weekdays.push(dayName);
        }
        return { weekdays, daysInMonth };
    };

    /**
     * Initializes the live Attendance sheet headers and layout with a 2-row header.
     */
    const initAttendanceSheet = (ss, activeReportingDate, tz) => {
        let sheet = ss.getSheetByName('Attendance');
        if (!sheet) {
            sheet = ss.insertSheet('Attendance', 1); // Position right after Dashboard
        }
        refreshAttendanceHeaders(sheet, activeReportingDate, tz);
        return sheet;
    };

    /**
     * Refreshes the 2-row header of the Attendance sheet with dynamic month days and weekdays.
     */
    const refreshAttendanceHeaders = (sheet, activeReportingDate, tz) => {
        const { weekdays, daysInMonth } = getReportingMonthWeekdays(activeReportingDate, tz);
        const totalCols = 6 + daysInMonth + 3;

        // Row 1: Weekday names
        const row1 = ['', '', '', '', '', '', ...weekdays, '', '', ''];

        // Row 2: Numeric day numbers & column labels
        const dayNumbers = [];
        for (let d = 1; d <= daysInMonth; d++) dayNumbers.push(String(d));

        const row2 = [
            'RSM ID', 'RSM Name', 'TSO ID', 'TSO Name', 'SR ID', 'SR Name',
            ...dayNumbers,
            'Present Count', 'Absent Count', 'Attendance %'
        ];

        // Adjust column count dynamically if month days changed
        const maxCols = sheet.getMaxColumns();
        if (maxCols > totalCols) {
            sheet.deleteColumns(totalCols + 1, maxCols - totalCols);
        } else if (maxCols < totalCols) {
            sheet.insertColumnsAfter(maxCols, totalCols - maxCols);
        }

        sheet.getRange(1, 1, 2, totalCols).setValues([row1, row2]);

        // Style Headers
        sheet.getRange(1, 1, 2, totalCols)
             .setFontWeight('bold')
             .setBackground('#1b365d')
             .setFontColor('#ffffff');

        // Subtle highlight for Friday headers in Row 1 & Row 2
        for (let d = 1; d <= daysInMonth; d++) {
            const colIdx = d + 6;
            if (weekdays[d - 1] === 'Fri') {
                sheet.getRange(1, colIdx, 2, 1).setBackground('#2c4d75');
            } else {
                sheet.getRange(1, colIdx, 2, 1).setBackground('#1b365d');
            }
        }

        // Freeze Row 2 and Columns A:F (Columns 1..6)
        sheet.setFrozenRows(2);
        sheet.setFrozenColumns(6);

        // Resize Day columns nicely
        for (let c = 7; c <= 6 + daysInMonth; c++) {
            sheet.setColumnWidth(c, 32);
        }
    };

    /**
     * Applies subtle light gray background shading to Friday day columns (Rows 3+).
     */
    const applyFridayBackgrounds = (sheet, numRows, weekdays, daysInMonth) => {
        try {
            const dayRange = sheet.getRange(3, 7, numRows, daysInMonth);
            dayRange.setBackground('#ffffff');

            for (let d = 1; d <= daysInMonth; d++) {
                if (weekdays[d - 1] === 'Fri') {
                    const colIdx = d + 6;
                    sheet.getRange(3, colIdx, numRows, 1).setBackground('#e9ecef');
                }
            }
        } catch (e) {
            console.log("applyFridayBackgrounds error: " + e);
        }
    };

    /**
     * Applies conditional formatting rules for P (Green) and A (Red).
     */
    const applyConditionalFormatting = (sheet, numRows, daysInMonth, finalRows) => {
        try {
            const dayRange = sheet.getRange(3, 7, numRows, daysInMonth);
            
            // 1. Center align all daily attendance cells
            dayRange.setHorizontalAlignment('center')
                    .setVerticalAlignment('middle');

            // 2. Set CLOSE cells font size to 6px and bold, normal cells to 10px and normal weight
            const sizes = [];
            const weights = [];
            for (let r = 0; r < numRows; r++) {
                const sizeRow = [];
                const weightRow = [];
                for (let c = 0; c < daysInMonth; c++) {
                    const val = String(finalRows[r][6 + c] || '');
                    if (val === 'CLOSE') {
                        sizeRow.push(6);
                        weightRow.push('bold');
                    } else {
                        sizeRow.push(10);
                        weightRow.push('normal');
                    }
                }
                sizes.push(sizeRow);
                weights.push(weightRow);
            }
            dayRange.setFontSizes(sizes);
            dayRange.setFontWeights(weights);

            const rules = [];

            // Rule 1: 'P' -> Soft Green
            rules.push(SpreadsheetApp.newConditionalFormatRule()
                .whenTextEqualTo('P')
                .setBackground('#d4edda')
                .setFontColor('#155724')
                .setRanges([dayRange])
                .build());

            // Rule 2: 'A' -> Soft Red
            rules.push(SpreadsheetApp.newConditionalFormatRule()
                .whenTextEqualTo('A')
                .setBackground('#f8d7da')
                .setFontColor('#721c24')
                .setRanges([dayRange])
                .build());

            // Rule 3: 'CLOSE' -> Soft Silver/Gray
            rules.push(SpreadsheetApp.newConditionalFormatRule()
                .whenTextEqualTo('CLOSE')
                .setBackground('#e2e3e5')
                .setFontColor('#383d41')
                .setBold(true)
                .setRanges([dayRange])
                .build());

            sheet.setConditionalFormatRules(rules);
        } catch (e) {
            console.log("applyConditionalFormatting error: " + e);
        }
    };

    /**
     * Checks if current day matches ATTENDANCE_ARCHIVE_DAY and creates monthly archive if missing.
     */
    const checkAndRunArchive = (ss, tz, config) => {
        try {
            const archiveDay = parseInt(config['ATTENDANCE_ARCHIVE_DAY'], 10) || 5;
            const now = new Date();
            const currentDay = now.getDate();

            if (currentDay !== archiveDay) return;

            // Target Archive month: Previous month
            const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const archiveYear = prevMonthDate.getFullYear();
            const archiveMonth = String(prevMonthDate.getMonth() + 1).padStart(2, '0');
            const archiveName = `Attendance_${archiveYear}_${archiveMonth}`;

            const existingArchive = ss.getSheetByName(archiveName);
            if (existingArchive) {
                console.log(`Archive ${archiveName} already exists. Skipped.`);
                return;
            }

            const liveSheet = ss.getSheetByName('Attendance');
            if (!liveSheet) return;

            // STEP 1: Copy live Attendance sheet
            const archiveSheet = liveSheet.copyTo(ss).setName(archiveName);

            // STEP 3: Hide archive sheet automatically
            archiveSheet.hideSheet();

            // STEP 4: Reset live Attendance sheet data values (Cols 7..40) while keeping employee info & formatting
            resetLiveAttendanceData(liveSheet);

            SheetService.writeLog([
                new Date(), "N/A", "N/A",
                "N/A", "N/A", "N/A",
                "N/A", "N/A", "N/A",
                Utilities.formatDate(now, tz, "dd-MMM-yyyy"), "ARCHIVE", "", "SUCCESS", `Archived ${archiveName} successfully.`
            ]);
        } catch (err) {
            console.log("checkAndRunArchive encountered an error: " + err);
        }
    };

    /**
     * Resets attendance values & summary columns for a new reporting month while preserving layout.
     */
    const resetLiveAttendanceData = (sheet) => {
        const maxRows = sheet.getMaxRows();
        if (maxRows > 2) {
            sheet.getRange(3, 7, maxRows - 2, 34).clearContent();
        }
    };

    /**
     * Retrieves Archive statistics for the Dashboard.
     */
    const getArchiveStats = (ss) => {
        try {
            const sheets = ss.getSheets();
            const archiveSheets = [];

            for (let i = 0; i < sheets.length; i++) {
                const name = sheets[i].getName();
                if (/^Attendance_\d{4}_\d{2}$/i.test(name)) {
                    archiveSheets.push(name);
                }
            }

            archiveSheets.sort();
            const lastArchive = archiveSheets.length > 0 ? archiveSheets[archiveSheets.length - 1] : "N/A";

            return {
                lastArchiveMonth: lastArchive,
                totalArchivedMonths: archiveSheets.length
            };
        } catch (e) {
            return { lastArchiveMonth: "N/A", totalArchivedMonths: 0 };
        }
    };

    const getEmptyMetrics = () => {
        return {
            currentMonth: "N/A",
            todayPresent: 0,
            todayAbsent: 0,
            overallAttendancePct: 0
        };
    };

    /**
     * Determines the last posted sales day (maximum day integer where at least one SR has sales > 0).
     */
    const getLastPostedSalesDay = (monthlySalesMap, daysInMonth) => {
        let maxDay = 0;
        for (const srId in monthlySalesMap) {
            const srSales = monthlySalesMap[srId];
            if (srSales) {
                for (let d = 1; d <= daysInMonth; d++) {
                    if (srSales[d] !== undefined && srSales[d] > 0) {
                        if (d > maxDay) {
                            maxDay = d;
                        }
                    }
                }
            }
        }
        return maxDay > 0 ? maxDay : 1;
    };

    /**
     * Reads all 31 days sales totals for each SR from the Sales sheet.
     * @returns {Object} Map where key is SR_ID and value is object of { day: salesVal }.
     */
    const readMonthlySalesData = () => {
        const map = {};
        try {
            const ss = SpreadsheetApp.getActiveSpreadsheet();
            if (!ss) return map;
            const sheet = ss.getSheetByName('Sales');
            if (!sheet) return map;

            const data = sheet.getDataRange().getValues();
            if (data.length < 5) return map;

            // Map Date headers from Row 4 (index 3)
            const dateHeaders = data[3] || [];
            const dayColMap = {}; // Maps DayInt (1..31) -> Column Index

            for (let c = 0; c < dateHeaders.length; c++) {
                const val = dateHeaders[c];
                let dayInt = -1;
                if (typeof val === 'object' && val instanceof Date) {
                    dayInt = val.getDate();
                } else {
                    dayInt = parseInt(val, 10);
                }
                if (dayInt >= 1 && dayInt <= 31) {
                    dayColMap[dayInt] = c;
                }
            }

            // Read Rows 5 onward for SR ID (Column A / Index 0)
            for (let i = 4; i < data.length; i++) {
                const row = data[i];
                const srId = String(row[0] || '').trim();
                const designation = String(row[5] || '').toUpperCase().trim();

                if (srId && srId !== 'undefined' && srId !== '' && (designation === 'SR' || designation === '' || !row[5])) {
                    if (!map[srId]) {
                        map[srId] = {};
                    }

                    const srStatusRaw = String(row[10] !== undefined ? row[10] : '').trim();
                    const srStatusNorm = srStatusRaw.toUpperCase();
                    const isSr = (designation === 'SR');
                    const isClosed = isSr && (srStatusNorm === 'CLOSE' || srStatusRaw === '1');
                    map[srId].isClosed = !!(map[srId].isClosed || isClosed);

                    for (let d = 1; d <= 31; d++) {
                        const colIdx = dayColMap[d] !== undefined ? dayColMap[d] : (15 + d);
                        const rawVal = row[colIdx];
                        const val = parseFloat(rawVal);
                        if (!map[srId][d]) map[srId][d] = 0;
                        if (!isNaN(val) && val > 0) {
                            map[srId][d] += val;
                        }
                    }
                }
            }
        } catch (e) {
            console.log("readMonthlySalesData error: " + e);
        }
        return map;
    };

    /**
     * Computes a fast string hash/checksum of the Sales sheet content.
     */
    const computeSalesHash = () => {
        try {
            const ss = SpreadsheetApp.getActiveSpreadsheet();
            if (!ss) return "";
            const sheet = ss.getSheetByName('Sales');
            if (!sheet) return "";

            const data = sheet.getDataRange().getValues();
            if (data.length === 0) return "";

            let payload = `${data.length}_${data[0].length}_`;
            for (let i = 4; i < data.length; i++) {
                const row = data[i];
                const srId = String(row[0] || '').trim();
                if (srId) {
                    payload += srId;
                    for (let c = 16; c < row.length; c++) {
                        if (row[c] !== "" && row[c] !== 0) {
                            payload += `:${c}=${row[c]}`;
                        }
                    }
                }
            }

            const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, payload);
            return rawHash.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
        } catch (e) {
            console.log("computeSalesHash error: " + e);
            return String(new Date().getTime());
        }
    };

    /**
     * Saves last sales state fingerprint and attendance sync timestamp in Settings sheet.
     */
    const saveSyncState = (hashStr, timestampStr) => {
        try {
            const ss = SpreadsheetApp.getActiveSpreadsheet();
            if (!ss) return;
            const sheet = ss.getSheetByName('Settings');
            if (!sheet) return;

            const data = sheet.getDataRange().getValues();
            let stateRowIdx = -1;
            let syncRowIdx = -1;

            for (let i = 0; i < data.length; i++) {
                const key = String(data[i][0] || '').trim();
                if (key === 'LAST_SALES_STATE' || key === 'LAST_ATTENDANCE_SYNC_HASH') stateRowIdx = i + 1;
                if (key === 'LAST_ATTENDANCE_SYNC' || key === 'LAST_ATTENDANCE_SYNC_TIME') syncRowIdx = i + 1;
            }

            if (stateRowIdx > 0) {
                sheet.getRange(stateRowIdx, 2).setValue(hashStr);
            } else {
                sheet.appendRow(['LAST_SALES_STATE', hashStr]);
            }

            if (syncRowIdx > 0) {
                sheet.getRange(syncRowIdx, 2).setValue(timestampStr);
            } else {
                sheet.appendRow(['LAST_ATTENDANCE_SYNC', timestampStr]);
            }
        } catch (e) {
            console.log("saveSyncState error: " + e);
        }
    };

    /**
     * Dedicated standalone syncAttendance service independent from the reminder engine.
     * Wrapped in LockService to ensure only one instance executes at a time.
     * Detects whether Sales sheet has changed before rebuilding Attendance.
     * NEVER sends WhatsApp messages and NEVER executes reminder logic.
     */
    const syncAttendance = () => {
        const lock = LockService.getScriptLock();
        const hasLock = lock.tryLock(0);
        if (!hasLock) {
            console.log("Another syncAttendance process is currently running. Exiting gracefully.");
            return { success: true, running: true, message: "Concurrent execution prevented." };
        }

        try {
            const currentHash = computeSalesHash();
            const config = ConfigLoader.load();
            const lastHash = String(config['LAST_SALES_STATE'] || config['LAST_ATTENDANCE_SYNC_HASH'] || '');

            // Fast exit if Sales data hasn't changed since last sync
            if (currentHash && currentHash === lastHash) {
                console.log("No changes detected in Sales sheet. Attendance sync skipped.");
                return { success: true, changed: false };
            }

            // Sales data changed! Rebuild Attendance sheet
            const attendanceMetrics = updateAttendance();

            const tz = config['Timezone'] || 'Asia/Dhaka';
            const nowStr = Utilities.formatDate(new Date(), tz, "dd-MMM-yyyy HH:mm:ss");

            // Save new sync state
            saveSyncState(currentHash, nowStr);

            // Apply Office User Mode visibility
            VisibilityService.applyOfficeUserModeVisibility();

            // Refresh Dashboard (Attendance Metrics)
            DashboardService.refreshDashboard({
                success: true,
                attendanceMetrics: attendanceMetrics
            });

            return { success: true, changed: true, timestamp: nowStr };
        } catch (err) {
            console.log("syncAttendance error: " + err);
            return { success: false, error: String(err) };
        } finally {
            try {
                lock.releaseLock();
            } catch (e) {
                // Ignore lock release warnings
            }
        }
    };

    return { updateAttendance, getArchiveStats, syncAttendance };
})();
