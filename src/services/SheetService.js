/**
 * @fileoverview SheetService.js
 * @responsibility Data Access Layer. Maps contact data natively and exposes 
 * Sales lookup capabilities required by the decision engine using SR ID as primary key.
 */

const SheetService = (() => {

    const getSheetSafe = (sheetName) => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        if (!ss) throw new Error("No active spreadsheet found.");
        const sheet = ss.getSheetByName(sheetName);
        if (!sheet) throw new Error(`Sheet missing: ${sheetName}`);
        return sheet;
    };

    const ensureMessageQueueHeaders = (requiredHeaders) => {
        const sheet = getSheetSafe('Message_Queue');
        const lastColumn = sheet.getLastColumn();
        const headers = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
        const existing = new Set(headers.map(header => String(header || '').trim()).filter(Boolean));
        const missing = requiredHeaders.filter(header => !existing.has(header));
        if (missing.length > 0) {
            sheet.getRange(1, lastColumn + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
        }
        return headers.concat(missing);
    };

    /**
     * Parses the Hierarchy sheet into a fast memory dictionary based on SR_ID.
     * Dynamically reads header row to eliminate hardcoded column index dependencies.
     * Validates required headers before processing data.
     * @returns {Object} Map where Key is SR_ID.
     */
    const readHierarchyMap = () => {
        let sheet;
        try {
            sheet = getSheetSafe('Hierarchy');
        } catch (e) {
            return readHierarchyBySR();
        }
        const data = sheet.getDataRange().getValues();
        if (data.length === 0) {
            console.log("Hierarchy sheet structure validation failed: Sheet is empty.");
            throw new Error("Hierarchy sheet structure is invalid.");
        }

        // Build dynamic header map from Row 1 (Index 0)
        const headerRow = data[0] || [];
        const headerMap = {};
        for (let c = 0; c < headerRow.length; c++) {
            const hName = String(headerRow[c] || '').trim();
            if (hName) {
                headerMap[hName] = c;
            }
        }

        // Validate that all required headers are present
        const requiredHeaders = ['RSM Name', 'RSM ID', 'TSO Name', 'TSO ID', 'SR Name', 'SR ID'];
        for (let r = 0; r < requiredHeaders.length; r++) {
            const reqHeader = requiredHeaders[r];
            if (headerMap[reqHeader] === undefined) {
                console.log(`Hierarchy sheet structure is invalid. Missing header: ${reqHeader}`);
                throw new Error(`Hierarchy sheet structure is invalid. Missing header: ${reqHeader}`);
            }
        }

        const idxSrId = headerMap['SR ID'];
        const idxSrName = headerMap['SR Name'];
        const idxTsoId = headerMap['TSO ID'];
        const idxTsoName = headerMap['TSO Name'];
        const idxRsmId = headerMap['RSM ID'];
        const idxRsmName = headerMap['RSM Name'];

        const map = {};

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const srId = String(row[idxSrId] !== undefined ? row[idxSrId] : '').trim();

            if (srId && srId !== 'undefined' && srId !== '') {
                if (map[srId]) {
                    console.log(`Duplicate SR_ID detected in Hierarchy sheet: ${srId}`);
                } else {
                    map[srId] = {
                        RSM_ID: String(row[idxRsmId] !== undefined ? row[idxRsmId] : '').trim(),
                        RSM_Name: String(row[idxRsmName] !== undefined ? row[idxRsmName] : '').trim(),
                        TSO_ID: String(row[idxTsoId] !== undefined ? row[idxTsoId] : '').trim(),
                        TSO_Name: String(row[idxTsoName] !== undefined ? row[idxTsoName] : '').trim(),
                        SR_ID: srId,
                        SR_Name: String(row[idxSrName] !== undefined ? row[idxSrName] : '').trim()
                    };
                }
            }
        }
        return map;
    };

    /**
     * Parses the Contact list sheet into dictionaries for TSO and SR lookup.
     * @returns {Object} { tsoMap, srMap, rsmMap, rsmConflicts }
     */
    const readContactMap = () => {
        const sheet = getSheetSafe('Contact list');
        const data = sheet.getDataRange().getValues();
        const tsoMap = {};
        const srMap = {};
        const rsmMap = {};
        const rsmConflicts = {};

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const tsoId = String(row[3] !== undefined ? row[3] : '').trim();
            const srId = String(row[6] !== undefined ? row[6] : '').trim();

            const contactObj = {
                RSM_ID: row[0],
                RSM_Name: row[1],
                RSM_Phone: row[2],
                TSO_ID: tsoId,
                TSO_Name: row[4],
                TSO_Phone: row[5],
                SR_ID: srId,
                SR_Name: row[7],
                SR_Phone: row[8]
            };

            const rsmId = String(row[0] !== undefined ? row[0] : '').trim();
            const rsmName = String(row[1] !== undefined ? row[1] : '').trim();
            const rsmPhone = String(row[2] !== undefined ? row[2] : '').trim();
            const normalizedRsmPhone = rsmPhone.replace(/\D/g, '');
            if (rsmId && rsmId !== 'undefined') {
                const existingRsm = rsmMap[rsmId];
                if (existingRsm && (existingRsm.RSM_Name !== rsmName || existingRsm.Normalized_Phone !== normalizedRsmPhone)) {
                    delete rsmMap[rsmId];
                    rsmConflicts[rsmId] = 'Conflicting RSM name or phone entries in Contact list';
                } else if (!existingRsm && !rsmConflicts[rsmId]) {
                    rsmMap[rsmId] = { RSM_ID: rsmId, RSM_Name: rsmName, RSM_Phone: rsmPhone, Normalized_Phone: normalizedRsmPhone };
                }
            }

            if (tsoId && tsoId !== 'undefined' && tsoId !== '' && !tsoMap[tsoId]) {
                tsoMap[tsoId] = contactObj;
            }
            if (srId && srId !== 'undefined' && srId !== '' && !srMap[srId]) {
                srMap[srId] = contactObj;
            }
        }
        return { tsoMap, srMap, rsmMap, rsmConflicts };
    };

    /**
     * Legacy helper: Parses the Contact list sheet into a dictionary based on SR_ID.
     */
    const readHierarchyBySR = () => {
        const sheet = getSheetSafe('Contact list');
        const data = sheet.getDataRange().getValues();
        const map = {};

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const srId = String(row[6]).trim(); // Column G (Index 6)

            if (srId && srId !== 'undefined' && srId !== '') {
                if (!map[srId]) {
                    map[srId] = {
                        RSM_ID: row[0],
                        RSM_Name: row[1],
                        RSM_Phone: row[2],
                        TSO_ID: row[3],
                        TSO_Name: row[4],
                        TSO_Phone: row[5],
                        SR_ID: srId,
                        SR_Name: row[7],
                        SR_Phone: row[8],
                        Dealer_ID: row[9] || '',
                        Dealer_Name: row[10] || '',
                        Dealer_Phone: row[11] || '',
                        Growth_Rate: row[12] || '',
                        MIS: row[13] || ''
                    };
                }
            }
        }
        return map;
    };

    /**
     * Reads target column from Sales based on Day integer grouped by SR.
     * Extracts SR ID strictly from Column A and filters ONLY where Designation = SR (Column F).
     */
    const readDailySalesForDayBySR = (dayInt) => {
        const sheet = getSheetSafe('Sales');
        const data = sheet.getDataRange().getValues();

        // Evaluate explicit Date column matching inside Row 4 (index 3)
        let targetColIndex = -1;
        const headerDates = data[3] || [];
        for (let c = 0; c < headerDates.length; c++) {
            let val = headerDates[c];
            if (typeof val === 'object' && val instanceof Date) {
                if (val.getDate() === dayInt) {
                    targetColIndex = c;
                    break;
                }
            } else {
                // Handle numeric / string casts 
                if (parseInt(val, 10) === dayInt) {
                    targetColIndex = c;
                    break;
                }
            }
        }

        // Fallback to mapped offset structure if date header not caught literally (Day 1 at Q/Index 16)
        if (targetColIndex === -1) {
            targetColIndex = 15 + dayInt;
        }

        const returns = [];

        // Row 5 onward (index 4 onward) contains sales values
        for (let i = 4; i < data.length; i++) {
            const row = data[i];
            const srId = String(row[0]).trim(); // Column A (Index 0) = Employee ID

            // Column F (Index 5) = Designation per spec. Fallback checks dynamic column or adjacent columns.
            const designationVal = String(row[5] !== undefined ? row[5] : '').toUpperCase().trim();
            const hasDesignationSR = (designationVal === 'SR');

            if (srId && srId !== 'undefined' && srId !== '' && hasDesignationSR) {

                // ── CLOSED SR FILTER (Column K = Index 10) ──────────────────────────────
                // Business Rule: If Status is 'Close' or '1', the SR is permanently closed.
                // Closed SRs must NEVER enter the reminder workflow.
                // This is the ONLY place this filter is applied.
                const srStatusRaw = String(row[10] !== undefined ? row[10] : '').trim();
                const srStatusNorm = srStatusRaw.toUpperCase();
                const isClosed = (srStatusNorm === 'CLOSE' || srStatusRaw === '1');

                if (isClosed) {
                    const srName = String(row[1] !== undefined ? row[1] : '').trim();
                    console.log(`[CLOSED SR EXCLUDED] SR_ID: ${srId} | SR_Name: ${srName} | Status: "${srStatusRaw}" → Skipped permanently.`);
                    continue; // Do NOT include this SR in any workflow output
                }
                // ────────────────────────────────────────────────────────────────────────

                const rawSale = row[targetColIndex];
                const parsedSale = parseFloat(rawSale);
                returns.push({
                    SR_ID: srId,
                    Sales_Volume: isNaN(parsedSale) ? 0 : parsedSale
                });
            }
        }
        return returns;
    };


    const writeLog = (logArray) => {
        const sheet = getSheetSafe('Logs');
        sheet.appendRow(logArray);
    };

    const clearDataKeepHeaders = (sheetName) => {
        try {
            const sheet = getSheetSafe(sheetName);
            const lastRow = sheet.getLastRow();
            if (lastRow > 1) {
                sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
            }
        } catch (e) { } // Error if sheet doesn't exist yet
    };

    const writePendingSRs = (rows) => {
        if (!rows || rows.length === 0) return;
        const sheet = getSheetSafe('Pending_SR');
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    };

    const writePendingTSOs = (rows) => {
        if (!rows || rows.length === 0) return;
        const sheet = getSheetSafe('Pending_TSO');
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    };

    const writeMessageQueue = (rows) => {
        if (!rows || rows.length === 0) return;
        const sheet = getSheetSafe('Message_Queue');
        const queueWidth = sheet.getLastColumn();
        const headers = sheet.getRange(1, 1, 1, queueWidth).getValues()[0];
        const normalizedRows = rows.map(row => {
            if (!Array.isArray(row)) {
                return headers.map(header => {
                    const key = String(header || '').trim();
                    return Object.prototype.hasOwnProperty.call(row, key) ? row[key] : '';
                });
            }
            const normalized = row.slice();
            while (normalized.length < queueWidth) normalized.push('');
            return normalized;
        });
        sheet.getRange(sheet.getLastRow() + 1, 1, normalizedRows.length, queueWidth).setValues(normalizedRows);
    };

    const readReminderSystemCache = (targetSalesDate) => {
        const sheet = getSheetSafe('Reminder_System');
        const data = sheet.getDataRange().getValues();
        const map = {};

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const status = row[2];
            const dateStr = String(row[5]);
            const level = row[6];
            const srId = String(row[7]).trim();

            if (dateStr === targetSalesDate && (status === 'SENT' || status === 'DRY_RUN' || status === 'SKIPPED')) {
                if (map[srId] !== 'RSM') {
                    map[srId] = level;
                }
            }
        }
        return map;
    };

    const writeReminderSystemCache = (rowArray) => {
        const sheet = getSheetSafe('Reminder_System');
        sheet.appendRow(rowArray);
    };

    return {
        readHierarchyMap,
        readContactMap,
        ensureMessageQueueHeaders,
        readHierarchyBySR,
        readDailySalesForDayBySR,
        writeLog,
        clearDataKeepHeaders,
        writePendingSRs,
        writePendingTSOs,
        writeMessageQueue,
        readReminderSystemCache,
        writeReminderSystemCache
    };
})();
