/**
 * @fileoverview BroadcastService.js
 * @responsibility WhatsApp Broadcast Dashboard module.
 * Provides a dedicated broadcast dashboard for sending custom template messages
 * to selected recipients with variable interpolation ({{name}}, {{designation}}, {{id}}),
 * visual statistics, recipient synchronization, and queue integration.
 */

const BroadcastService = (() => {
    const SHEET_NAME = 'Broadcast_Dashboard';

    // Color Palette: Clean, modern Day Mode (Light Theme)
    const THEME = {
        SHEET_BG: '#F1F5F9',         // Clean slate light background
        HEADER_DARK: '#1E40AF',      // Executive Royal Blue main title bar
        CARD_HEADER: '#1E293B',      // Dark slate section headers
        SUB_HEADER_BG: '#E2E8F0',    // Light grey column sub-headers
        METRIC_LABEL: '#475569',     // Slate text for labels
        METRIC_BG: '#FFFFFF',        // Pure white metric card background
        METRIC_ACCENT: '#0369A1',    // Vibrant Deep Blue for stats
        WHITE: '#FFFFFF',
        DARK_TEXT: '#0F172A',        // Crisp dark text for day mode
        BORDER_LIGHT: '#CBD5E1',     // Soft clean border
        DRAFT_BG: '#FFFFFF',         // White message drafting box
        DRAFT_TEXT: '#0F172A',
        HINT_BG: '#FEF3C7',          // Warm amber note card
        HINT_TEXT: '#92400E',        // Dark amber text
        INFO_BG: '#E0F2FE',          // Light sky blue instruction box
        INFO_TEXT: '#0369A1',        // Navy blue text
        BTN_PREVIEW: '#2563EB',      // Blue
        BTN_SEND_SELECTED: '#16A34A',// Green
        BTN_SEND_ALL: '#EA580C',     // Orange
        BTN_REFRESH: '#475569',      // Slate
        BTN_CLEAR: '#7C3AED',        // Purple
        BTN_SELECT_ALL: '#0D9488',   // Teal
        ROW_LIGHT_1: '#FFFFFF',      // White table row
        ROW_LIGHT_2: '#F8FAFC',      // Soft off-white table row
        ROW_TEXT: '#0F172A'
    };

    /**
     * Sanitizes and standardizes phone number to Bangladesh format (8801XXXXXXXXX).
     */
    const standardizePhone = (raw) => {
        if (!raw || raw === '#N/A' || raw === 'undefined' || raw === 'null') return '';
        let digits = String(raw).replace(/\D/g, '');
        if (digits.startsWith('8801') && digits.length === 13) {
            return digits;
        }
        if (digits.startsWith('01') && digits.length === 11) {
            return '880' + digits.substring(1);
        }
        if (digits.startsWith('1') && digits.length === 10) {
            return '880' + digits;
        }
        return digits;
    };

    const isValidBdPhone = (phone) => {
        const std = standardizePhone(phone);
        return /^8801[3-9]\d{8}$/.test(std);
    };

    /**
     * Automatically removes any obsolete Notice/Broadcast legacy tabs from the spreadsheet.
     */
    const cleanupObsoleteNoticeTabs = () => {
        try {
            const ss = SpreadsheetApp.getActiveSpreadsheet();
            if (!ss) return;
            const obsoleteNames = [
                'WA Notice Dashboard', 'Notice_Dashboard', 'Notice Dashboard', 
                'Notice System', 'Notice_Log', 'Notice Log', 'Notice_Logs'
            ];
            obsoleteNames.forEach(name => {
                const sheet = ss.getSheetByName(name);
                if (sheet) {
                    ss.deleteSheet(sheet);
                    console.log(`Deleted obsolete sheet: ${name}`);
                }
            });
        } catch (e) {
            console.log('Obsolete tab cleanup skipped: ' + e);
        }
    };

    /**
     * Gets or creates the Broadcast_Dashboard sheet.
     */
    const getOrCreateSheet = (ss) => {
        const spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
        let sheet = spreadsheet.getSheetByName(SHEET_NAME);
        if (!sheet) {
            sheet = spreadsheet.insertSheet(SHEET_NAME);
        }
        return sheet;
    };

    /**
     * Safely unmerges existing merged ranges in controlled areas before re-merging,
     * preventing "Exception: You must select all cells in a merged range to merge or unmerge them."
     */
    const unmergeControlledAreas = (sheet) => {
        try {
            const mergedRanges = sheet.getMergedRanges();
            for (let i = 0; i < mergedRanges.length; i++) {
                const mr = mergedRanges[i];
                const startRow = mr.getRow();
                const startCol = mr.getColumn();
                const endCol = mr.getLastColumn();

                // Unmerge any merged ranges in Left and Middle panels (Cols A:Q, Rows 1..40)
                // or Top Right Header (Row 1, Cols R:V).
                // We MUST NEVER unmerge or touch R2:U (Cols 18..21, Row >= 2) or X1.
                const isLeftMiddle = (startCol <= 17 && startRow <= 40);
                const isTopRightHeader = (startRow === 1 && startCol >= 18 && endCol <= 22);
                const isAttachmentBox = (startRow >= 4 && startRow <= 8 && startCol >= 24 && endCol <= 26);

                if (isLeftMiddle || isTopRightHeader || isAttachmentBox) {
                    try {
                        mr.breakApart();
                    } catch (e) {}
                }
            }
        } catch (e) {
            console.log('Unmerge error: ' + e);
        }
    };

    /**
     * Safely merges a range by first breaking apart any overlapping merges.
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
     * @param {string} a1Notation
     * @returns {GoogleAppsScript.Spreadsheet.Range}
     */
    const safeMerge = (sheet, a1Notation) => {
        return SheetService.safeMerge(sheet, a1Notation);
    };

    /**
     * Initializes and formats the Broadcast_Dashboard tab layout in Day Mode.
     */
    const initBroadcastSheet = () => {
        cleanupObsoleteNoticeTabs();
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let sheet = getOrCreateSheet(ss);

        // Preserve existing user inputs (Draft and Media Link) BEFORE unmerging
        const preservedDraft = String(sheet.getRange('H2').getValue() || '').trim();
        const preservedMediaUrl = String(sheet.getRange('H19').getValue() || sheet.getRange('X5').getValue() || '').trim();

        // Break apart any previous conflicting merged ranges in controlled areas
        unmergeControlledAreas(sheet);

        // Setup base column widths
        sheet.setColumnWidth(1, 30);  // A
        sheet.setColumnWidth(2, 60);  // B
        sheet.setColumnWidth(3, 75);  // C
        sheet.setColumnWidth(4, 75);  // D
        sheet.setColumnWidth(5, 75);  // E
        sheet.setColumnWidth(6, 75);  // F
        sheet.setColumnWidth(7, 75);  // G
        sheet.setColumnWidth(8, 60);  // H
        sheet.setColumnWidth(9, 60);  // I
        sheet.setColumnWidth(10, 60); // J
        sheet.setColumnWidth(11, 60); // K
        sheet.setColumnWidth(12, 60); // L
        sheet.setColumnWidth(13, 60); // M
        sheet.setColumnWidth(14, 60); // N
        sheet.setColumnWidth(15, 60); // O
        sheet.setColumnWidth(16, 60); // P
        sheet.setColumnWidth(17, 30); // Q
        sheet.setColumnWidth(18, 90); // R - ID
        sheet.setColumnWidth(19, 170); // S - Name
        sheet.setColumnWidth(20, 110); // T - Designation
        sheet.setColumnWidth(21, 130); // U - Contact No
        sheet.setColumnWidth(22, 70);  // V - Send?

        // 1. Overall Background (Day Mode for Left and Middle Panels)
        sheet.getRange('A1:Q25')
             .setBackground(THEME.SHEET_BG)
             .setFontColor(THEME.DARK_TEXT)
             .setFontFamily('Segoe UI');

        // ── TOP HEADER (Row 1) ────────────────────────────────────────────────
        safeMerge(sheet, 'A1:G1')
             .setValue('WHATSAPP BROADCAST DASHBOARD')
             .setBackground(THEME.HEADER_DARK)
             .setFontColor(THEME.WHITE)
             .setFontSize(13)
             .setFontWeight('bold')
             .setVerticalAlignment('middle')
             .setHorizontalAlignment('left');

        // ── SECTION 1: CONTACT STATISTICS (Rows 2-7) ──────────────────────────
        safeMerge(sheet, 'B2:E2')
             .setValue('CONTACT STATISTICS')
             .setBackground(THEME.CARD_HEADER)
             .setFontColor(THEME.WHITE)
             .setFontSize(10)
             .setFontWeight('bold')
             .setVerticalAlignment('middle');

        sheet.getRange('B3:E3').setValues([['Total', 'Valid', 'Invalid', 'Selected']])
             .setBackground(THEME.SUB_HEADER_BG)
             .setFontColor(THEME.METRIC_LABEL)
             .setFontSize(9)
             .setFontWeight('bold')
             .setHorizontalAlignment('center');

        // Metric values in B4:E4
        sheet.getRange('B4:E4').setValues([['0', '0', '0', '0']])
             .setBackground(THEME.METRIC_BG)
             .setFontColor(THEME.METRIC_ACCENT)
             .setFontSize(16)
             .setFontWeight('bold')
             .setHorizontalAlignment('center')
             .setVerticalAlignment('middle');

        // Status / Char count card in B5:E7
        safeMerge(sheet, 'B5:E7')
             .setValue('Ready\n0 characters')
             .setBackground(THEME.METRIC_BG)
             .setFontColor(THEME.DARK_TEXT)
             .setFontSize(10)
             .setFontWeight('bold')
             .setVerticalAlignment('middle')
             .setHorizontalAlignment('center')
             .setWrap(true);

        // ── SECTION 2: BROADCAST QUEUE STATUS (Rows 8-10) ────────────────────
        safeMerge(sheet, 'B8:G8')
             .setValue('BROADCAST QUEUE STATUS')
             .setBackground(THEME.CARD_HEADER)
             .setFontColor(THEME.WHITE)
             .setFontSize(10)
             .setFontWeight('bold')
             .setVerticalAlignment('middle');

        sheet.getRange('B9:G9').setValues([['Pending', 'Processing', 'Sent', 'Retry', 'Failed', 'Total']])
             .setBackground(THEME.SUB_HEADER_BG)
             .setFontColor(THEME.METRIC_LABEL)
             .setFontSize(9)
             .setFontWeight('bold')
             .setHorizontalAlignment('center');

        sheet.getRange('B10:G10').setValues([['0', '0', '0', '0', '0', '0']])
             .setBackground(THEME.METRIC_BG)
             .setFontColor(THEME.METRIC_ACCENT)
             .setFontSize(15)
             .setFontWeight('bold')
             .setHorizontalAlignment('center')
             .setVerticalAlignment('middle');

        // ── SECTION 3: BROADCAST CONTROLS (Rows 11-13) ───────────────────────
        safeMerge(sheet, 'B11:G11')
             .setValue('CONTROLS · WhatsApp Broadcast → Dashboard Controls')
             .setBackground(THEME.CARD_HEADER)
             .setFontColor(THEME.WHITE)
             .setFontSize(10)
             .setFontWeight('bold')
             .setVerticalAlignment('middle');

        // Buttons Row 12
        safeMerge(sheet, 'B12:C12')
             .setValue('Preview Message')
             .setBackground(THEME.BTN_PREVIEW)
             .setFontColor(THEME.WHITE)
             .setFontSize(10)
             .setFontWeight('bold')
             .setHorizontalAlignment('center')
             .setVerticalAlignment('middle');

        safeMerge(sheet, 'D12:E12')
             .setValue('Send to Selected')
             .setBackground(THEME.BTN_SEND_SELECTED)
             .setFontColor(THEME.WHITE)
             .setFontSize(10)
             .setFontWeight('bold')
             .setHorizontalAlignment('center')
             .setVerticalAlignment('middle');

        safeMerge(sheet, 'F12:G12')
             .setValue('Send to All')
             .setBackground(THEME.BTN_SEND_ALL)
             .setFontColor(THEME.WHITE)
             .setFontSize(10)
             .setFontWeight('bold')
             .setHorizontalAlignment('center')
             .setVerticalAlignment('middle');

        // Buttons Row 13
        safeMerge(sheet, 'B13:C13')
             .setValue('Refresh Dashboard')
             .setBackground(THEME.BTN_REFRESH)
             .setFontColor(THEME.WHITE)
             .setFontSize(10)
             .setFontWeight('bold')
             .setHorizontalAlignment('center')
             .setVerticalAlignment('middle');

        safeMerge(sheet, 'D13:E13')
             .setValue('Clear Selection')
             .setBackground(THEME.BTN_CLEAR)
             .setFontColor(THEME.WHITE)
             .setFontSize(10)
             .setFontWeight('bold')
             .setHorizontalAlignment('center')
             .setVerticalAlignment('middle');

        safeMerge(sheet, 'F13:G13')
             .setValue('Select All Valid')
             .setBackground(THEME.BTN_SELECT_ALL)
             .setFontColor(THEME.WHITE)
             .setFontSize(10)
             .setFontWeight('bold')
             .setHorizontalAlignment('center')
             .setVerticalAlignment('middle');

        // ── SECTION 4: RECENT BROADCAST ACTIVITY (Rows 15+) ──────────────────
        safeMerge(sheet, 'B15:G15')
             .setValue('RECENT BROADCAST ACTIVITY')
             .setBackground(THEME.CARD_HEADER)
             .setFontColor(THEME.WHITE)
             .setFontSize(10)
             .setFontWeight('bold')
             .setVerticalAlignment('middle');

        sheet.getRange('B16:G16').setValues([['Time', 'ID', 'Name', 'Phone', 'Status', 'Error']])
             .setBackground(THEME.SUB_HEADER_BG)
             .setFontColor(THEME.METRIC_LABEL)
             .setFontSize(9)
             .setFontWeight('bold')
             .setHorizontalAlignment('center');

        // Placeholder rows for activity in Day Mode
        const emptyActivity = [];
        const activityBgs = [];
        for (let r = 0; r < 8; r++) {
            emptyActivity.push(['', '', '', '', '', '']);
            const bg = (r % 2 === 0) ? THEME.ROW_LIGHT_1 : THEME.ROW_LIGHT_2;
            activityBgs.push([bg, bg, bg, bg, bg, bg]);
        }
        sheet.getRange('B17:G24').setValues(emptyActivity)
             .setBackgrounds(activityBgs)
             .setFontColor(THEME.ROW_TEXT)
             .setFontSize(9)
             .setHorizontalAlignment('center');

        // ── MIDDLE SECTION: MESSAGE DRAFT (Columns H:P starting at Row 1) ────
        safeMerge(sheet, 'H1:P1')
             .setValue('📝 MESSAGE DRAFT')
             .setBackground(THEME.CARD_HEADER)
             .setFontColor(THEME.WHITE)
             .setFontSize(10)
             .setFontWeight('bold')
             .setVerticalAlignment('middle');

        const defaultDraft = preservedDraft || `Hello {{name}},\n\nThis is a controlled TEST message from the new WhatsApp Broadcast System.\n\nIf you receive this message, the Sheet → Queue → Worker → WhatsApp pipeline is working correctly.\n\nRegards,\nMIS Team`;

        safeMerge(sheet, 'H2:P17')
             .setValue(defaultDraft)
             .setBackground(THEME.DRAFT_BG)
             .setFontColor(THEME.DRAFT_TEXT)
             .setFontSize(10)
             .setFontFamily('Consolas')
             .setVerticalAlignment('top')
             .setHorizontalAlignment('left')
             .setWrap(true);

        // Attachment / Media URL input box
        safeMerge(sheet, 'H18:P18')
             .setValue('📎 ATTACHMENT / MEDIA URL (Optional: Image / Video / Audio / Document Link)')
             .setBackground(THEME.CARD_HEADER)
             .setFontColor(THEME.WHITE)
             .setFontSize(9)
             .setFontWeight('bold')
             .setVerticalAlignment('middle');

        safeMerge(sheet, 'H19:P19')
             .setValue(preservedMediaUrl || '')
             .setBackground(preservedMediaUrl ? '#F0FDF4' : THEME.DRAFT_BG)
             .setFontColor(THEME.DRAFT_TEXT)
             .setFontSize(9)
             .setFontFamily('Consolas')
             .setVerticalAlignment('middle')
             .setHorizontalAlignment('left');

        safeMerge(sheet, 'H20:P21')
             .setValue('⚡ Supported variables: {{name}}, {{designation}}, {{id}} — Replaced dynamically per recipient.')
             .setBackground(THEME.HINT_BG)
             .setFontColor(THEME.HINT_TEXT)
             .setFontSize(9)
             .setFontWeight('bold')
             .setVerticalAlignment('middle')
             .setHorizontalAlignment('left')
             .setWrap(true);

        safeMerge(sheet, 'H22:P24')
             .setValue('Edit message/attachment above, select recipients on the right, then use the Broadcast Controls buttons.')
             .setBackground(THEME.INFO_BG)
             .setFontColor(THEME.INFO_TEXT)
             .setFontSize(10)
             .setVerticalAlignment('middle')
             .setHorizontalAlignment('left')
             .setWrap(true);

        // ── RIGHT SECTION: RECIPIENT CONTACT LIST (Columns R:V starting at Row 1) ─
        // Only set header Row 1 and Column V2 (Send?). NEVER touch R2:U or X1!
        safeMerge(sheet, 'R1:V1')
             .setValue('RECIPIENT CONTACT LIST · Check Send?')
             .setBackground(THEME.CARD_HEADER)
             .setFontColor(THEME.WHITE)
             .setFontSize(10)
             .setFontWeight('bold')
             .setVerticalAlignment('middle');

        sheet.getRange('V2').setValue('Send?')
             .setBackground(THEME.SUB_HEADER_BG)
             .setFontColor(THEME.METRIC_LABEL)
             .setFontSize(10)
             .setFontWeight('bold')
             .setHorizontalAlignment('center');

        // Apply Checkbox data validation to Column V (Send?) only, without touching R2:U or X1
        const maxDataRow = Math.max(sheet.getLastRow(), 50);
        if (maxDataRow >= 3) {
            const checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
            sheet.getRange(3, 22, maxDataRow - 2, 1).setDataValidation(checkboxRule);
        }

        // ── ATTACHMENT / MEDIA INPUT BOX (Columns X:Z Rows 4-6) ─────────────
        sheet.setColumnWidth(23, 20);  // W spacer
        sheet.setColumnWidth(24, 160); // X
        sheet.setColumnWidth(25, 160); // Y
        sheet.setColumnWidth(26, 160); // Z

        safeMerge(sheet, 'X4:Z4')
             .setValue('📎 ATTACHMENT / MEDIA LINK')
             .setBackground(THEME.CARD_HEADER)
             .setFontColor(THEME.WHITE)
             .setFontSize(10)
             .setFontWeight('bold')
             .setVerticalAlignment('middle')
             .setHorizontalAlignment('left');

        safeMerge(sheet, 'X5:Z5')
             .setValue(preservedMediaUrl || '')
             .setBackground(preservedMediaUrl ? '#F0FDF4' : THEME.DRAFT_BG)
             .setFontColor(THEME.DRAFT_TEXT)
             .setFontSize(9)
             .setFontFamily('Consolas')
             .setVerticalAlignment('middle')
             .setHorizontalAlignment('left')
             .setWrap(false);

        safeMerge(sheet, 'X6:Z6')
             .setValue('Paste local file path (e.g. C:\\path\\image.png) or Google Drive link in X5.')
             .setBackground(THEME.INFO_BG)
             .setFontColor(THEME.INFO_TEXT)
             .setFontSize(8)
             .setVerticalAlignment('middle')
             .setHorizontalAlignment('left')
             .setWrap(true);

        // Refresh stats based on formula results in R:U
        refreshDashboard();
    };

    /**
     * Preserves manual user entries in R:U. Only updates checkboxes in Column V if needed.
     */
    const loadRecipients = () => {
        // Left intentionally non-destructive so user manual data in R2:U is never overwritten
        refreshDashboard();
    };

    /**
     * Reads all recipient rows from the sheet starting at Row 3.
     */
    const getRecipientsFromSheet = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = getOrCreateSheet(ss);
        const lastRow = sheet.getLastRow();
        if (lastRow < 3) return [];

        const data = sheet.getRange(3, 18, lastRow - 2, 5).getValues();
        const list = [];
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const id = String(row[0] || '').trim();
            const name = String(row[1] || '').trim();
            const designation = String(row[2] || '').trim();
            const phone = String(row[3] || '').trim();
            const send = Boolean(row[4]);
            if (id || name || phone) {
                list.push({
                    rowIndex: i + 3,
                    id,
                    name,
                    designation,
                    phone,
                    send,
                    isValidPhone: isValidBdPhone(phone)
                });
            }
        }
        return list;
    };

    /**
     * Ticks checkboxes for all contacts with valid phone numbers.
     */
    const selectAllValid = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = getOrCreateSheet(ss);
        const recipients = getRecipientsFromSheet();
        if (recipients.length === 0) return;

        const updates = recipients.map(r => [r.isValidPhone]);
        sheet.getRange(3, 22, updates.length, 1).setValues(updates);
        refreshDashboard();
        SpreadsheetApp.getActiveSpreadsheet().toast('Selected all valid recipient contacts.', 'Broadcast', 3);
    };

    /**
     * Clears all checkboxes in the recipient table.
     */
    const clearSelection = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = getOrCreateSheet(ss);
        const recipients = getRecipientsFromSheet();
        if (recipients.length === 0) return;

        const updates = recipients.map(() => [false]);
        sheet.getRange(3, 22, updates.length, 1).setValues(updates);
        refreshDashboard();
        SpreadsheetApp.getActiveSpreadsheet().toast('Cleared recipient selection.', 'Broadcast', 3);
    };

    /**
     * Reads message draft from cell H2.
     */
    const getMessageDraft = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = getOrCreateSheet(ss);
        return String(sheet.getRange('H2').getValue() || '').trim();
    };

    /**
     * Reads media/attachment URL from cell H19 (or fallback X5).
     */
    const getMediaUrl = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = getOrCreateSheet(ss);
        const h19 = String(sheet.getRange('H19').getValue() || '').trim();
        if (h19) return h19.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim();
        const x5 = String(sheet.getRange('X5').getValue() || '').trim();
        if (x5) return x5.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim();
        return '';
    };

    /**
     * Auto-detects media type from URL extension or link pattern.
     */
    const detectMediaType = (url) => {
        if (!url) return '';
        const clean = url.toLowerCase().split('?')[0];
        if (clean.match(/\.(jpg|jpeg|png|webp|gif)$/i)) return 'IMAGE';
        if (clean.match(/\.(mp4|3gp|mov|avi|mkv)$/i)) return 'VIDEO';
        if (clean.match(/\.(ogg|opus|voice)$/i)) return 'VOICE';
        if (clean.match(/\.(mp3|wav|m4a|aac)$/i)) return 'AUDIO';
        if (clean.match(/\.(pdf|doc|docx|xls|xlsx|txt|csv)$/i)) return 'DOCUMENT';
        if (url.includes('drive.google.com')) return 'DOCUMENT';
        return 'FILE';
    };

    /**
     * Replaces template variables in the message for a specific recipient.
     */
    const formatMessageForRecipient = (template, recipient) => {
        let msg = template;
        msg = msg.replace(/\{\{name\}\}/gi, recipient.name || '');
        msg = msg.replace(/\{\{designation\}\}/gi, recipient.designation || '');
        msg = msg.replace(/\{\{id\}\}/gi, recipient.id || '');
        return msg;
    };

    /**
     * Previews the personalized message for the first selected contact with media info.
     */
    const previewMessage = () => {
        const draft = getMessageDraft();
        const mediaUrl = getMediaUrl();
        const mediaType = detectMediaType(mediaUrl);

        if (!draft && !mediaUrl) {
            SpreadsheetApp.getUi().alert('Preview Message', 'Message draft and media attachment are both empty. Please enter a message or media link.', SpreadsheetApp.getUi().ButtonSet.OK);
            return;
        }

        const recipients = getRecipientsFromSheet();
        const selected = recipients.filter(r => r.send);
        const target = selected.length > 0 ? selected[0] : (recipients.length > 0 ? recipients[0] : { id: 'TEST-001', name: 'Masum', designation: 'Test Recipient', phone: '01915966721' });

        const personalized = formatMessageForRecipient(draft || '', target);
        const targetPhone = standardizePhone(target.phone);

        const mediaBadgeHtml = mediaUrl ? `
            <div style="background:#E0F2FE; border:1px solid #7DD3FC; color:#0369A1; padding:8px 12px; border-radius:6px; margin-bottom:10px; font-size:12px;">
                <strong>📎 Attachment (${mediaType}):</strong> <a href="${mediaUrl}" target="_blank" style="color:#0284C7; word-break:break-all;">${mediaUrl}</a>
            </div>` : '';

        const html = HtmlService.createHtmlOutput(`
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 16px; background: #F8FAFC; color: #0F172A; }
                    .card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
                    .label { font-size: 11px; color: #64748B; text-transform: uppercase; font-weight: bold; }
                    .val { font-size: 14px; font-weight: 600; color: #0369A1; margin-bottom: 8px; }
                    .preview-box { background: #FFFFFF; border: 1px solid #CBD5E1; color: #0F172A; padding: 14px; border-radius: 8px; white-space: pre-wrap; font-size: 13px; line-height: 1.5; font-family: Consolas, monospace; }
                    .footer { text-align: right; margin-top: 14px; }
                    button { background: #2563EB; color: white; border: none; padding: 8px 18px; border-radius: 4px; font-weight: bold; cursor: pointer; }
                    button:hover { background: #1D4ED8; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="label">Previewing for Recipient</div>
                    <div class="val">${target.name} (${target.designation}) · ${target.id} · ${targetPhone || 'No Phone'}</div>
                    <div class="label">Total Selected: ${selected.length} recipient(s)</div>
                </div>
                ${mediaBadgeHtml}
                <div class="label" style="margin-bottom: 6px;">Personalized Message Preview</div>
                <div class="preview-box">${personalized.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                <div class="footer">
                    <button onclick="google.script.host.close()">Close Preview</button>
                </div>
            </body>
            </html>
        `).setWidth(480).setHeight(450);

        SpreadsheetApp.getUi().showModalDialog(html, '📨 Message & Media Preview');
    };

    /**
     * Enqueues custom messages (with optional media attachments) to Message_Queue.
     * @param {boolean} sendAll If true, sends to all valid contacts regardless of checkbox.
     */
    const sendBroadcast = (sendAll = false) => {
        const draft = getMessageDraft();
        const mediaUrl = getMediaUrl();
        const mediaType = detectMediaType(mediaUrl);

        if (!draft && !mediaUrl) {
            SpreadsheetApp.getUi().alert('Broadcast Sender', 'Please enter a message or an attachment URL before sending.', SpreadsheetApp.getUi().ButtonSet.OK);
            return;
        }

        const recipients = getRecipientsFromSheet();
        const targets = recipients.filter(r => (sendAll ? r.isValidPhone : r.send));

        if (targets.length === 0) {
            SpreadsheetApp.getUi().alert('Broadcast Sender', sendAll ? 'No recipients with valid phone numbers found.' : 'No recipients selected. Please tick the "Send?" checkbox for the contacts you wish to message.', SpreadsheetApp.getUi().ButtonSet.OK);
            return;
        }

        const ui = SpreadsheetApp.getUi();
        const mediaNote = mediaUrl ? `\nAttachment: Yes (${mediaType})\nFile: ${mediaUrl}` : '\nAttachment: None (Text only)';
        const promptText = `Are you sure you want to send this broadcast message to ${targets.length} recipient(s)?${mediaNote}\n\nProvider: WhatsApp\nWorker will automatically dispatch queued messages.`;
        const response = ui.alert('Confirm Broadcast Send', promptText, ui.ButtonSet.YES_NO);
        if (response !== ui.Button.YES) {
            return;
        }

        // Ensure headers exist in Message_Queue
        SheetService.ensureMessageQueueHeaders(['RSM_ID', 'RSM_Name', 'Idempotency_Key', 'Media_Url', 'Media_Type']);

        const config = (typeof ConfigLoader !== 'undefined' && ConfigLoader.load) ? ConfigLoader.load() : {};
        const isTestMode = String(config['TEST_MODE']).toUpperCase() === 'TRUE' || String(config['SENDER_MODE']).toUpperCase() === 'TEST';
        const overridePhone = String(config['TEST_RECIPIENT_PHONE'] || config['OVERRIDE_PHONE'] || config['TEST_PHONE'] || '').trim();
        const provider = config['NOTIFICATION_PROVIDER'] || 'WhatsApp';
        const timestamp = new Date();
        const tz = config['Timezone'] || 'Asia/Dhaka';
        const formattedDate = Utilities.formatDate(timestamp, tz, 'dd-MMM-yyyy');

        const queueRows = [];
        const activityRows = [];

        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            const stdPhone = standardizePhone(target.phone);
            const finalPhone = (isTestMode && overridePhone) ? standardizePhone(overridePhone) : stdPhone;
            const messageBody = formatMessageForRecipient(draft, target);
            const queueId = Utilities.getUuid();
            const idempotencyKey = `BROADCAST|${timestamp.getTime()}|${target.id}|${i}`;

            // Queue Schema matching Message_Queue
            // Queue_ID, Timestamp, Provider, Recipient_Name, Recipient_Phone, Recipient_Type, 
            // TSO_ID, TSO_Name, Sales_Date, Pending_SR_Count, Pending_SR_List, 
            // Message_Body, Status, Retry_Count, Created_At, Sent_At, Error_Message,
            // Message_ID, ACK, Processing_Started_At, Worker_ID, Recovery_Time, Recovery_Reason,
            // RSM_ID, RSM_Name, Idempotency_Key, Media_Url, Media_Type
            queueRows.push([
                queueId, timestamp, provider, target.name, finalPhone, 'BROADCAST',
                target.id, target.name, formattedDate, 0, '',
                messageBody, 'PENDING', 0, timestamp, '', '', '', '', '', '', '', '',
                '', '', idempotencyKey, mediaUrl, mediaType
            ]);

            activityRows.push([
                Utilities.formatDate(timestamp, tz, 'HH:mm:ss\ndd-MMM'),
                target.id,
                target.name,
                finalPhone,
                'QUEUED',
                mediaUrl ? `Media: ${mediaType}` : ''
            ]);

            // Audit log
            try {
                SheetService.writeLog([
                    new Date(), 'N/A', 'N/A', target.id, target.name, target.id,
                    target.name, '', '', formattedDate, 'BROADCAST', finalPhone, 'QUEUED', mediaUrl ? `Broadcast (${mediaType})` : 'Custom Broadcast'
                ]);
            } catch (e) {}
        }

        // Write to Message_Queue
        SheetService.writeMessageQueue(queueRows);

        // Start / Wake Notification Sender
        try {
            if (typeof NotificationControlService !== 'undefined' && NotificationControlService.startSender) {
                NotificationControlService.startSender();
            }
        } catch (e) {
            console.log('Error starting sender: ' + e);
        }

        // Update Recent Activity on Broadcast_Dashboard
        updateRecentActivity(activityRows);

        // Clear Selection
        if (!sendAll) {
            clearSelection();
        }

        // Refresh stats
        refreshDashboard();

        ui.alert('Broadcast Sent', `Successfully enqueued ${targets.length} broadcast message(s) to Message_Queue.\nNotification Sender has been activated.`, ui.ButtonSet.OK);
    };

    /**
     * Updates the Recent Broadcast Activity table in Broadcast_Dashboard (Rows 17-24).
     */
    const updateRecentActivity = (newRows) => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = getOrCreateSheet(ss);

        // Read current recent activity
        const currentData = sheet.getRange('B17:G24').getValues();
        const combined = [...newRows, ...currentData].slice(0, 8);

        while (combined.length < 8) {
            combined.push(['', '', '', '', '', '']);
        }

        const activityBgs = [];
        for (let r = 0; r < combined.length; r++) {
            const bg = (r % 2 === 0) ? THEME.ROW_LIGHT_1 : THEME.ROW_LIGHT_2;
            activityBgs.push([bg, bg, bg, bg, bg, bg]);
        }

        sheet.getRange('B17:G24').setValues(combined)
             .setBackgrounds(activityBgs)
             .setFontColor(THEME.ROW_TEXT)
             .setFontSize(9)
             .setHorizontalAlignment('center');
    };

    /**
     * Refreshes stats, queue counters, character count, and draft status.
     */
    const refreshDashboard = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getSheetByName(SHEET_NAME);
        if (!sheet) return;

        // 1. Contact Stats
        const recipients = getRecipientsFromSheet();
        const total = recipients.length;
        const valid = recipients.filter(r => r.isValidPhone).length;
        const invalid = total - valid;
        const selected = recipients.filter(r => r.send).length;

        sheet.getRange('B4:E4').setValues([[total, valid, invalid, selected]]);

        // 2. Draft & Char count
        const draft = getMessageDraft();
        const charCount = draft.length;
        sheet.getRange('B5:E7').setValue(`Ready · ${charCount} chars\nSelected: ${selected}`);

        // 3. Queue counts from Message_Queue
        try {
            const queueSheet = ss.getSheetByName('Message_Queue');
            let pending = 0, processing = 0, sent = 0, retry = 0, failed = 0, queueTotal = 0;
            if (queueSheet && queueSheet.getLastRow() > 1) {
                const data = queueSheet.getDataRange().getValues();
                const headers = data[0] || [];
                const statusIdx = headers.indexOf('Status');
                const typeIdx = headers.indexOf('Recipient_Type');

                for (let i = 1; i < data.length; i++) {
                    const row = data[i];
                    const recType = typeIdx >= 0 ? String(row[typeIdx] || '').toUpperCase() : '';
                    if (recType === 'BROADCAST') {
                        queueTotal++;
                        const s = statusIdx >= 0 ? String(row[statusIdx] || '').toUpperCase() : '';
                        if (s === 'PENDING') pending++;
                        else if (s === 'PROCESSING') processing++;
                        else if (s === 'SENT') sent++;
                        else if (s === 'RETRY') retry++;
                        else if (s === 'FAILED') failed++;
                    }
                }
            }
            sheet.getRange('B10:G10').setValues([[pending, processing, sent, retry, failed, queueTotal]]);
        } catch (e) {
            console.log('Error refreshing queue status: ' + e);
        }
    };

    /**
     * Handles clicks or onEdit triggers on the Broadcast_Dashboard.
     */
    const handleDashboardEdit = (e) => {
        if (!e || !e.range) return;
        const sheet = e.range.getSheet();
        if (sheet.getName() !== SHEET_NAME) return;

        const row = e.range.getRow();
        const col = e.range.getColumn();

        // Checkbox edit in Recipient List (Col V = 22, Row >= 3)
        if (col === 22 && row >= 3) {
            refreshDashboard();
            return;
        }

        // Draft message edit in H2:P19
        if (row >= 2 && row <= 19 && col >= 8 && col <= 16) {
            refreshDashboard();
            return;
        }

        // Action Buttons Row 12
        if (row === 12) {
            if (col >= 2 && col <= 3) {
                previewMessage();
            } else if (col >= 4 && col <= 5) {
                sendBroadcast(false);
            } else if (col >= 6 && col <= 7) {
                sendBroadcast(true);
            }
        }
        // Action Buttons Row 13
        else if (row === 13) {
            if (col >= 2 && col <= 3) {
                refreshDashboard();
                SpreadsheetApp.getActiveSpreadsheet().toast('Broadcast Dashboard refreshed.', 'Broadcast', 3);
            } else if (col >= 4 && col <= 5) {
                clearSelection();
            } else if (col >= 6 && col <= 7) {
                selectAllValid();
            }
        }
    };

    /**
     * Uploads a base64-encoded media file directly to Google Drive and sets the attachment URL in H19.
     * @param {string} base64Data Base64 string of file content
     * @param {string} fileName Original file name
     * @param {string} mimeType File MIME type
     * @returns {Object} Result object with url, fileName, and mediaType
     */
    const uploadMediaFile = (base64Data, fileName, mimeType) => {
        if (!base64Data || !fileName) {
            throw new Error('File data or filename is missing.');
        }

        const decoded = Utilities.base64Decode(base64Data);
        const blob = Utilities.newBlob(decoded, mimeType || 'application/octet-stream', fileName);

        // Find or create 'WhatsApp_Broadcast_Media' folder in Drive
        let folder;
        const folders = DriveApp.getFoldersByName('WhatsApp_Broadcast_Media');
        if (folders.hasNext()) {
            folder = folders.next();
        } else {
            folder = DriveApp.createFolder('WhatsApp_Broadcast_Media');
        }

        const file = folder.createFile(blob);
        try {
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (e) {
            console.log('Sharing permission set warning: ' + e);
        }

        const fileUrl = file.getUrl();
        const mediaType = detectMediaType(fileName);

        // Set cells H19 and X5 in Broadcast_Dashboard
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = getOrCreateSheet(ss);
        sheet.getRange('H19').setValue(fileUrl);
        sheet.getRange('X5').setValue(fileUrl);

        refreshDashboard();

        try {
            ss.toast('📎 Attached: ' + fileName + ' (' + mediaType + ')', 'Broadcast Attachment', 6);
        } catch (e) {}

        return {
            success: true,
            url: fileUrl,
            fileName: fileName,
            mediaType: mediaType
        };
    };

    /**
     * Clears the attachment URL from Broadcast_Dashboard cells X5 and H19.
     */
    const clearAttachment = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = getOrCreateSheet(ss);
        sheet.getRange('X5').setValue('');
        sheet.getRange('H19').setValue('');
        refreshDashboard();
        SpreadsheetApp.getActiveSpreadsheet().toast('Attachment cleared from Broadcast Dashboard.', 'Broadcast', 3);
    };

    return {
        initBroadcastSheet,
        loadRecipients,
        selectAllValid,
        clearSelection,
        previewMessage,
        sendBroadcast,
        refreshDashboard,
        handleDashboardEdit,
        getRecipientsFromSheet,
        cleanupObsoleteNoticeTabs,
        uploadMediaFile,
        clearAttachment
    };
})();
