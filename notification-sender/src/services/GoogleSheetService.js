/**
 * GoogleSheetService.js
 * @responsibility Production-ready Google Sheets Data Access Layer using Service Account authentication.
 * Handles Dashboard-backed configuration and Message_Queue data access.
 */

const { google } = require('googleapis');
const fs = require('fs');

class GoogleSheetService {
    constructor() {
        this.sheets = null;
        this.spreadsheetId = null;
        this.isConnected = false;
    }

    /**
     * Connects to Google Sheets using Google Service Account credentials.
     * @param {Object} infraConfig Object containing googleSheetId and googleServiceAccountJson
     */
    async connect(infraConfig) {
        this.spreadsheetId = infraConfig.googleSheetId;

        if (!this.spreadsheetId) {
            throw new Error('GOOGLE_SHEET_ID is missing in infrastructure environment configuration.');
        }

        const credsInput = infraConfig.googleServiceAccountJson;
        let credentials = null;

        if (credsInput) {
            if (fs.existsSync(credsInput)) {
                credentials = JSON.parse(fs.readFileSync(credsInput, 'utf8'));
            } else {
                try {
                    credentials = JSON.parse(credsInput);
                } catch (e) {
                    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is neither a valid file path nor valid JSON string.');
                }
            }
        }

        const auth = new google.auth.GoogleAuth({
            credentials: credentials || undefined,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });

        const client = await auth.getClient();
        this.sheets = google.sheets({ version: 'v4', auth: client });
        this.isConnected = true;
    }

    /**
     * Reads raw key-value pairs from both Dashboard configuration panels C:H.
     * @returns {Promise<Object>} Map of raw key-value pairs.
     */
    async readConfiguration() {
        if (!this.isConnected || !this.sheets) {
            throw new Error('GoogleSheetService is not connected. Call connect() first.');
        }

        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Dashboard!C1:H'
            });

            const rows = response.data.values || [];
            const settingsMap = {};

            for (let i = 0; i < rows.length; i++) {
                const leftKey = String(rows[i][2] || '').trim();
                const rightKey = String(rows[i][5] || '').trim();
                if (leftKey) settingsMap[leftKey] = rows[i][1];
                if (rightKey) settingsMap[rightKey] = rows[i][4];
            }
            return settingsMap;
        } catch (err) {
            console.warn('[WARN] Could not read Dashboard configuration:', err.message);
            return {};
        }
    }

    /**
     * Updates key-value pairs in either Dashboard panel while preserving key location.
     * Upserts keys — updates existing cells or appends new rows.
     * @param {Object} settingsMap Object mapping key -> value
     */
    async updateSettings(settingsMap) {
        if (!this.isConnected || !this.sheets) {
            throw new Error('GoogleSheetService is not connected. Call connect() first.');
        }

        try {
            const resp = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Dashboard!C1:H'
            });

            const rows = resp.data.values || [];
            const keyToRowMap = {};
            let lastConfigRow = 0;
            for (let i = 0; i < rows.length; i++) {
                const leftKey = String(rows[i][2] || '').trim();
                const rightKey = String(rows[i][5] || '').trim();
                if (leftKey) keyToRowMap[leftKey] = { row: i + 1, valueColumn: 'D' };
                if (rightKey) keyToRowMap[rightKey] = { row: i + 1, valueColumn: 'G' };
                if (leftKey || rightKey) lastConfigRow = i + 1;
            }
            if (lastConfigRow === 0) {
                throw new Error('Dashboard configuration is missing. Run the verified Settings-to-Dashboard migration first.');
            }

            const updates = [];
            const newRows = [];

            for (const [key, value] of Object.entries(settingsMap)) {
                if (keyToRowMap[key]) {
                    const location = keyToRowMap[key];
                    updates.push({
                        range: `Dashboard!${location.valueColumn}${location.row}`,
                        values: [[value !== undefined && value !== null ? String(value) : '']]
                    });
                } else {
                    newRows.push([
                        String(key).replace(/_/g, ' '),
                        value !== undefined && value !== null ? String(value) : '',
                        key
                    ]);
                }
            }

            if (updates.length > 0) {
                await this.batchUpdate(updates);
            }

            if (newRows.length > 0) {
                const newRowUpdates = newRows.map((row, index) => ({
                    range: `Dashboard!C${lastConfigRow + index + 1}:E${lastConfigRow + index + 1}`,
                    values: [row]
                }));
                await this.batchUpdate(newRowUpdates);
            }
            return true;
        } catch (err) {
            console.warn('[WARN] Could not update Dashboard configuration:', err.message);
            return false;
        }
    }

    /**
     * Reads Message_Queue status counts for reporting.
     * @param {string} queueSheetName
     * @returns {Promise<Object>} { pending, processing, sent, retry, failed, total }
     */
    async readQueueCounts(queueSheetName = 'Message_Queue') {
        if (!this.isConnected || !this.sheets) {
            return { pending: 0, processing: 0, sent: 0, retry: 0, failed: 0, total: 0 };
        }

        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${queueSheetName}!A1:Z`
            });

            const rows = response.data.values || [];
            if (rows.length <= 1) return { pending: 0, processing: 0, sent: 0, retry: 0, failed: 0, total: 0 };

            const headers = rows[0] || [];
            let statusCol = -1;
            headers.forEach((h, idx) => {
                if (String(h || '').trim().toUpperCase() === 'STATUS') statusCol = idx;
            });

            if (statusCol === -1) return { pending: 0, processing: 0, sent: 0, retry: 0, failed: 0, total: 0 };

            const counts = { pending: 0, processing: 0, sent: 0, retry: 0, failed: 0 };
            for (let i = 1; i < rows.length; i++) {
                const s = String(rows[i][statusCol] || '').trim().toUpperCase();
                if      (s === 'PENDING')    counts.pending++;
                else if (s === 'PROCESSING') counts.processing++;
                else if (s === 'SENT')       counts.sent++;
                else if (s === 'RETRY')      counts.retry++;
                else if (s === 'FAILED')     counts.failed++;
            }
            counts.total = rows.length - 1;
            return counts;
        } catch (e) {
            return { pending: 0, processing: 0, sent: 0, retry: 0, failed: 0, total: 0 };
        }
    }

    /**
     * Reads the complete queue state needed for run-scoped completion checks.
     * This does not claim or mutate any queue record.
     */
    async readQueueRecords(queueSheetName = 'Message_Queue') {
        if (!this.isConnected || !this.sheets) {
            throw new Error('GoogleSheetService is not connected. Call connect() first.');
        }

        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${queueSheetName}!A1:Z`
        });
        const rows = response.data.values || [];
        if (rows.length <= 1) return [];

        const headerMap = {};
        (rows[0] || []).forEach((name, index) => {
            if (name) headerMap[String(name).trim()] = index;
        });
        const queueIdCol = headerMap['Queue_ID'] !== undefined ? headerMap['Queue_ID'] : 0;
        const statusCol = headerMap['Status'] !== undefined ? headerMap['Status'] : 12;
        const retryCol = headerMap['Retry_Count'] !== undefined ? headerMap['Retry_Count'] : 13;

        return rows.slice(1).map((row, index) => {
            const retryCount = parseInt(row[retryCol], 10);
            return {
                queueId: String(row[queueIdCol] || '').trim(),
                status: String(row[statusCol] || '').trim().toUpperCase(),
                retryCount: Number.isNaN(retryCount) ? 0 : retryCount,
                rowIndex: index + 2
            };
        }).filter(record => record.queueId);
    }


    /**
     * Reads queue sheet and filters for claimable PENDING/RETRY records in memory.
     * @param {string} queueSheetName Name of queue sheet tab (e.g. 'Message_Queue')
     * @returns {Promise<Array<Object>>} List of normalized queue objects.
     */
    async readPendingQueue(queueSheetName = 'Message_Queue') {
        if (!this.isConnected || !this.sheets) {
            throw new Error('GoogleSheetService is not connected. Call connect() first.');
        }

        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${queueSheetName}!A1:Z`
        });

        const rows = response.data.values || [];
        if (rows.length === 0) {
            return [];
        }

        // Row 1 (index 0) contains headers
        const headerRow = rows[0] || [];
        const headerMap = {};
        headerRow.forEach((colName, index) => {
            if (colName) {
                headerMap[String(colName).trim()] = index;
            }
        });

        const idxQueueId = headerMap['Queue_ID'] !== undefined ? headerMap['Queue_ID'] : 0;
        const idxProvider = headerMap['Provider'] !== undefined ? headerMap['Provider'] : 2;
        const idxRecipientName = headerMap['Recipient_Name'] !== undefined ? headerMap['Recipient_Name'] : 3;
        const idxRecipientPhone = headerMap['Recipient_Phone'] !== undefined ? headerMap['Recipient_Phone'] : 4;
        const idxMessageBody = headerMap['Message_Body'] !== undefined ? headerMap['Message_Body'] : 11;
        const idxStatus = headerMap['Status'] !== undefined ? headerMap['Status'] : 12;
        const idxRetryCount = headerMap['Retry_Count'] !== undefined ? headerMap['Retry_Count'] : 13;

        const pendingRecords = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const status = String(row[idxStatus] || '').trim().toUpperCase();

            if (status === 'PENDING' || status === 'RETRY') {
                const retryVal = parseInt(row[idxRetryCount], 10);
                pendingRecords.push({
                    queueId: String(row[idxQueueId] || '').trim(),
                    provider: String(row[idxProvider] || 'WHATSAPP_WEB').trim(),
                    recipientName: String(row[idxRecipientName] || '').trim(),
                    recipientPhone: String(row[idxRecipientPhone] || '').trim(),
                    message: String(row[idxMessageBody] || '').trim(),
                    retryCount: Number.isNaN(retryVal) ? 0 : retryVal,
                    status: status,
                    rowIndex: i + 1
                });
            }
        }

        return pendingRecords;
    }

    /**
     * Updates queue status for a single row.
     * @param {string} queueSheetName
     * @param {number} rowIndex
     * @param {string} status
     */
    async updateQueueStatus(queueSheetName, rowIndex, status) {
        if (!this.isConnected || !this.sheets) {
            throw new Error('GoogleSheetService is not connected. Call connect() first.');
        }

        const range = `${queueSheetName}!M${rowIndex}`;
        await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: range,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[status]]
            }
        });
    }

    /**
     * Batch updates multiple queue records in a single API call.
     * @param {Array<Object>} updates List of { range, values }
     */
    async batchUpdate(updates) {
        if (!this.isConnected || !this.sheets) {
            throw new Error('GoogleSheetService is not connected. Call connect() first.');
        }

        if (!updates || updates.length === 0) return;

        await this.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: updates
            }
        });
    }

    /**
     * Updates full delivery result for a queue record row in Google Sheets.
     * @param {string} queueSheetName Tab name (e.g. 'Message_Queue')
     * @param {number} rowIndex 1-based row number in sheet
     * @param {Object} updateData Object containing status, sentAt, messageId, errorMessage, retryCount
     */
    async updateQueueResult(queueSheetName = 'Message_Queue', rowIndex, updateData) {
        if (!this.isConnected || !this.sheets) {
            throw new Error('GoogleSheetService is not connected. Call connect() first.');
        }

        const status = updateData.status || 'SENT';
        // An explicitly supplied empty value means the message was not
        // confirmed. Do not replace it with a misleading timestamp.
        const sentAt = Object.prototype.hasOwnProperty.call(updateData, 'sentAt')
            ? updateData.sentAt
            : '';
        const messageId = updateData.messageId || '';
        const errorMsg = updateData.errorMessage || '';
        const retryCount = updateData.retryCount !== undefined ? updateData.retryCount : 0;

        // Fetch header row to map exact column indices
        const headerResp = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${queueSheetName}!1:1`
        });

        const headers = (headerResp.data.values && headerResp.data.values[0]) || [];
        const headerMap = {};
        headers.forEach((h, idx) => {
            if (h) headerMap[String(h).trim()] = idx;
        });

        const updates = [];

        // Update Status
        const colStatus = headerMap['Status'] !== undefined ? headerMap['Status'] : 12; // col M
        updates.push({
            range: `${queueSheetName}!${this.colIndexToLetter(colStatus)}${rowIndex}`,
            values: [[status]]
        });

        // Update Retry_Count
        const colRetry = headerMap['Retry_Count'] !== undefined ? headerMap['Retry_Count'] : 13; // col N
        updates.push({
            range: `${queueSheetName}!${this.colIndexToLetter(colRetry)}${rowIndex}`,
            values: [[retryCount]]
        });

        // Update Error_Message if header exists
        if (headerMap['Error_Message'] !== undefined) {
            const colErr = headerMap['Error_Message'];
            updates.push({
                range: `${queueSheetName}!${this.colIndexToLetter(colErr)}${rowIndex}`,
                values: [[errorMsg]]
            });
        }

        // Update Message_ID if header exists
        if (headerMap['Message_ID'] !== undefined) {
            const colMsgId = headerMap['Message_ID'];
            updates.push({
                range: `${queueSheetName}!${this.colIndexToLetter(colMsgId)}${rowIndex}`,
                values: [[messageId]]
            });
        }

        // Update Sent_At if header exists
        if (headerMap['Sent_At'] !== undefined) {
            const colSentAt = headerMap['Sent_At'];
            updates.push({
                range: `${queueSheetName}!${this.colIndexToLetter(colSentAt)}${rowIndex}`,
                values: [[sentAt]]
            });
        }

        // Update ACK if header exists and present in updateData
        if (headerMap['ACK'] !== undefined && updateData.ack !== undefined) {
            const colAck = headerMap['ACK'];
            updates.push({
                range: `${queueSheetName}!${this.colIndexToLetter(colAck)}${rowIndex}`,
                values: [[updateData.ack]]
            });
        }

        await this.batchUpdate(updates);
    }

    /**
     * Ensures permanent delivery-tracking headers exist in Row 1 of queue sheet.
     * Appends missing headers at the end of Row 1 without modifying existing column order.
     * @param {string} queueSheetName
     * @returns {Promise<Object>} Map of header names to 0-indexed column positions.
     */
    async ensureQueueHeaders(queueSheetName = 'Message_Queue') {
        if (!this.isConnected || !this.sheets) {
            throw new Error('GoogleSheetService is not connected. Call connect() first.');
        }

        const headerResp = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${queueSheetName}!1:1`
        });

        const headers = (headerResp.data.values && headerResp.data.values[0]) ? [...headerResp.data.values[0]] : [];
        const requiredHeaders = [
            'Status', 'Retry_Count', 'Sent_At', 'Error_Message', 'Message_ID',
            'ACK', 'Processing_Started_At', 'Worker_ID', 'Recovery_Time', 'Recovery_Reason'
        ];
        let headersModified = false;

        for (const reqHeader of requiredHeaders) {
            const exists = headers.some(h => String(h || '').trim() === reqHeader);
            if (!exists) {
                headers.push(reqHeader);
                headersModified = true;
            }
        }

        if (headersModified) {
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `${queueSheetName}!A1`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [headers]
                }
            });
            const added = requiredHeaders.filter(h => !headers.slice(0, headers.length - requiredHeaders.length).includes(h));
            console.log(`[INFO] Automatically added missing headers to "${queueSheetName}": ${requiredHeaders.join(', ')}`);
        }

        const headerMap = {};
        headers.forEach((h, idx) => {
            if (h) headerMap[String(h).trim()] = idx;
        });

        return headerMap;
    }

    /**
     * Claims a pending/retry queue record atomically before dispatching.
     * Ensures headers exist, verifies Status is PENDING or RETRY, updates Status to PROCESSING,
     * writes Processing_Started_At and Worker_ID, and verifies claim success.
     * @param {string} queueSheetName
     * @param {number} rowIndex
     * @param {string} workerId
     * @returns {Promise<Object>} { success: boolean, startTime: string, reason?: string }
     */
    async claimQueueRecord(queueSheetName = 'Message_Queue', rowIndex, workerId) {
        if (!this.isConnected || !this.sheets) {
            throw new Error('GoogleSheetService is not connected. Call connect() first.');
        }

        const headerMap = await this.ensureQueueHeaders(queueSheetName);
        const colStatus = headerMap['Status'] !== undefined ? headerMap['Status'] : 12;
        const colProcStart = headerMap['Processing_Started_At'];
        const colWorker = headerMap['Worker_ID'];

        const colStatusLetter = this.colIndexToLetter(colStatus);

        // 1. Read current Status value from sheet
        const statusResp = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${queueSheetName}!${colStatusLetter}${rowIndex}`
        });

        const currentStatus = (statusResp.data.values && statusResp.data.values[0] && statusResp.data.values[0][0])
            ? String(statusResp.data.values[0][0]).trim().toUpperCase()
            : '';

        if (currentStatus !== 'PENDING' && currentStatus !== 'RETRY') {
            return {
                success: false,
                reason: `Record at row ${rowIndex} has status "${currentStatus}" (expected PENDING or RETRY). Already claimed or processed by another worker.`
            };
        }

        const startTime = new Date().toISOString();
        const updates = [
            {
                range: `${queueSheetName}!${colStatusLetter}${rowIndex}`,
                values: [['PROCESSING']]
            }
        ];

        if (colProcStart !== undefined) {
            updates.push({
                range: `${queueSheetName}!${this.colIndexToLetter(colProcStart)}${rowIndex}`,
                values: [[startTime]]
            });
        }

        if (colWorker !== undefined) {
            updates.push({
                range: `${queueSheetName}!${this.colIndexToLetter(colWorker)}${rowIndex}`,
                values: [[workerId]]
            });
        }

        // 2. Perform claim update
        await this.batchUpdate(updates);

        // 3. Re-verify claim by reading Status back
        const verifyResp = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${queueSheetName}!${colStatusLetter}${rowIndex}`
        });

        const verifyStatus = (verifyResp.data.values && verifyResp.data.values[0] && verifyResp.data.values[0][0])
            ? String(verifyResp.data.values[0][0]).trim().toUpperCase()
            : '';

        if (verifyStatus !== 'PROCESSING') {
            return {
                success: false,
                reason: `Race condition lost. Row ${rowIndex} status is "${verifyStatus}".`
            };
        }

        return {
            success: true,
            startTime: startTime,
            workerId: workerId
        };
    }

    /**
     * Scans the queue sheet and recovers stalled PROCESSING records.
     * A PROCESSING record is considered stalled if Processing_Started_At is older than staleThresholdMinutes.
     * Recovered records are set to RETRY with Retry_Count incremented.
     * Worker_ID, Processing_Started_At, and ACK are cleared.
     * Recovery_Time and Recovery_Reason are written to document the recovery event.
     *
     * @param {string} queueSheetName
     * @param {number} [staleThresholdMinutes=10]
     * @returns {Promise<Object>} { recovered: number, details: Array }
     */
    async recoverStalledQueue(queueSheetName = 'Message_Queue', staleThresholdMinutes = 10) {
        if (!this.isConnected || !this.sheets) {
            throw new Error('GoogleSheetService is not connected. Call connect() first.');
        }

        // Ensure all required headers exist (adds Recovery_Time, Recovery_Reason if missing)
        const headerMap = await this.ensureQueueHeaders(queueSheetName);

        // Read all rows
        const resp = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${queueSheetName}!A1:Z`
        });

        const rows = resp.data.values || [];
        if (rows.length <= 1) return { recovered: 0, details: [] };

        const staleThresholdMs = staleThresholdMinutes * 60 * 1000;
        const now = Date.now();
        const recoveryTime = new Date().toISOString();
        const recoveryReason = `Stalled PROCESSING record: Processing_Started_At older than ${staleThresholdMinutes} minutes. Auto-recovered on startup.`;

        const colStatus = headerMap['Status'] !== undefined ? headerMap['Status'] : 12;
        const colRetry = headerMap['Retry_Count'] !== undefined ? headerMap['Retry_Count'] : 13;
        const colProcStart = headerMap['Processing_Started_At'];
        const colWorker = headerMap['Worker_ID'];
        const colAck = headerMap['ACK'];
        const colQueueId = headerMap['Queue_ID'] !== undefined ? headerMap['Queue_ID'] : 0;
        const colRecoveryTime = headerMap['Recovery_Time'];
        const colRecoveryReason = headerMap['Recovery_Reason'];

        const batchUpdates = [];
        const recoveredDetails = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const rowNumber = i + 1;
            const status = String(row[colStatus] || '').trim().toUpperCase();

            if (status !== 'PROCESSING') continue;

            // Check age of Processing_Started_At
            const procStartRaw = colProcStart !== undefined ? String(row[colProcStart] || '').trim() : '';
            if (!procStartRaw) {
                // No Processing_Started_At recorded — treat as stale
            } else {
                const procStartMs = new Date(procStartRaw).getTime();
                if (isNaN(procStartMs)) {
                    // Invalid timestamp — treat as stale
                } else if (now - procStartMs < staleThresholdMs) {
                    // Less than threshold minutes old — still active, skip
                    continue;
                }
            }

            // This row is stale PROCESSING — recover it
            const queueId = String(row[colQueueId] || '').trim();
            const currentRetry = parseInt(row[colRetry] || '0', 10);
            const nextRetry = isNaN(currentRetry) ? 1 : currentRetry + 1;

            // Build batch update for this row
            batchUpdates.push({
                range: `${queueSheetName}!${this.colIndexToLetter(colStatus)}${rowNumber}`,
                values: [['RETRY']]
            });
            batchUpdates.push({
                range: `${queueSheetName}!${this.colIndexToLetter(colRetry)}${rowNumber}`,
                values: [[nextRetry]]
            });
            if (colProcStart !== undefined) {
                batchUpdates.push({
                    range: `${queueSheetName}!${this.colIndexToLetter(colProcStart)}${rowNumber}`,
                    values: [['']]
                });
            }
            if (colWorker !== undefined) {
                batchUpdates.push({
                    range: `${queueSheetName}!${this.colIndexToLetter(colWorker)}${rowNumber}`,
                    values: [['']]
                });
            }
            if (colAck !== undefined) {
                batchUpdates.push({
                    range: `${queueSheetName}!${this.colIndexToLetter(colAck)}${rowNumber}`,
                    values: [['']]
                });
            }
            if (colRecoveryTime !== undefined) {
                batchUpdates.push({
                    range: `${queueSheetName}!${this.colIndexToLetter(colRecoveryTime)}${rowNumber}`,
                    values: [[recoveryTime]]
                });
            }
            if (colRecoveryReason !== undefined) {
                batchUpdates.push({
                    range: `${queueSheetName}!${this.colIndexToLetter(colRecoveryReason)}${rowNumber}`,
                    values: [[recoveryReason]]
                });
            }

            recoveredDetails.push({
                rowNumber,
                queueId: queueId || `row-${rowNumber}`,
                previousStatus: 'PROCESSING',
                newStatus: 'RETRY',
                retryCount: nextRetry,
                staleSince: procStartRaw || 'unknown'
            });
        }

        if (batchUpdates.length > 0) {
            await this.batchUpdate(batchUpdates);
        }

        return {
            recovered: recoveredDetails.length,
            details: recoveredDetails
        };
    }

    /**
     * Converts 0-indexed column integer to A-Z / AA-ZZ spreadsheet column letter.
     */
    colIndexToLetter(index) {
        let temp = '';
        let letter = '';
        let col = index + 1;
        while (col > 0) {
            temp = (col - 1) % 26;
            letter = String.fromCharCode(65 + temp) + letter;
            col = (col - (temp + 1)) / 26;
        }
        return letter;
    }

    /**
     * Disconnects and resets service state.
     */
    async disconnect() {
        this.sheets = null;
        this.isConnected = false;
    }
}

module.exports = GoogleSheetService;
