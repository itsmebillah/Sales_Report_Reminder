/**
 * DateFormatter.js
 * Utility to format dates and timestamps in Bangladesh Standard Time (Asia/Dhaka, UTC+6).
 */

function formatBDDateTime(date = new Date()) {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return String(date);

    const options = {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    };
    const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(d);
    const p = {};
    parts.forEach(({ type, value }) => { p[type] = value; });
    const day = p.day;
    const month = p.month;
    const year = p.year;
    const hour = p.hour;
    const minute = p.minute;
    const second = p.second;
    const dayPeriod = (p.dayPeriod || '').toUpperCase();
    return `${day}-${month}-${year} ${hour}:${minute}:${second} ${dayPeriod}`.trim();
}

function getBDDateStr(date = new Date()) {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(d);
}

module.exports = {
    formatBDDateTime,
    getBDDateStr
};
