/**
 * @fileoverview Print-only view for the current Pending_TSO report.
 * Reads the report without changing source data, reminders, queues, or logs.
 */

const PendingTsoPrintService = (() => {
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

    const openPrintDialog = () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss ? ss.getSheetByName('Pending_TSO') : null;
        const data = sheet ? sheet.getDataRange().getDisplayValues() : [];
        const headers = data.length > 0 ? data[0] : [];
        const rows = data.slice(1).filter(row => row.some(value => String(value).trim() !== ''));
        const salesDateIndex = headers.findIndex(header => String(header).trim() === 'Sales_Date');
        const salesDates = [...new Set(rows
            .map(row => salesDateIndex >= 0 ? String(row[salesDateIndex]).trim() : '')
            .filter(Boolean))];
        const salesDate = salesDates.length === 1 ? salesDates[0] : (salesDates.length > 1 ? 'Multiple Sales Dates' : '');
        const title = rows.length > 0
            ? `Pending Sales Report of ${salesDate || 'Current Sales Date'}`
            : 'No Pending Sales Data Available';
        const orientation = headers.length > 6 ? 'landscape' : 'portrait';
        const reportHtml = rows.length > 0 ? buildTable(headers, rows) : '<p class="empty">No Pending Sales Data Available</p>';

        const html = `<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <style>
    @page { size: A4 ${orientation}; margin: 8mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; margin: 0; font-size: 10px; line-height: 1.35; }
    h1 { color: #17365d; font-size: 18px; line-height: 1.2; margin: 0 0 5px; text-align: center; }
    .subtitle { color: #64748b; font-size: 9px; line-height: 1.2; margin: 0 0 10px; text-align: center; }
    table { border-collapse: collapse; table-layout: fixed; width: 100%; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th, td { border: 1px solid #94a3b8; overflow-wrap: anywhere; padding: 4px 5px; text-align: left; vertical-align: top; }
    th { background: #17365d; color: #ffffff; font-size: 9px; font-weight: 700; line-height: 1.25; text-align: center; }
    td:nth-child(1), td:nth-child(2), td:nth-child(3), td:nth-child(5), td:nth-child(6), td:nth-child(8) { text-align: center; }
    td:nth-child(1), td:nth-child(2), td:nth-child(3), td:nth-child(5), td:nth-child(6), td:nth-child(8) { white-space: nowrap; }
    td:nth-child(9) { font-size: 9px; line-height: 1.35; white-space: normal; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .empty { border: 1px solid #cbd5e1; color: #475569; font-size: 14px; margin-top: 28px; padding: 20px; text-align: center; }
    .actions { margin: 14px 0 0; text-align: center; }
    button { background: #17365d; border: 0; border-radius: 4px; color: #ffffff; cursor: pointer; font-weight: 600; padding: 8px 16px; }
    @media print { .actions { display: none; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="subtitle">Generated from the current Pending_TSO report</p>
  ${reportHtml}
  <div class="actions"><button type="button" onclick="window.print()">Print Report</button></div>
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));</script>
</body>
</html>`;

        SpreadsheetApp.getUi().showModalDialog(
            HtmlService.createHtmlOutput(html).setWidth(1000).setHeight(700),
            'Print Pending TSO Report'
        );

        return { success: true, rows: rows.length, salesDate: salesDate || null, orientation: orientation };
    };

    return { openPrintDialog };
})();
