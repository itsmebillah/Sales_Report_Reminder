/**
 * @fileoverview DateUtils.js
 * @responsibility Shared utilities for calculating reporting deadlines natively using 
 * the configuration constraints and mapping dates to spreadsheet columns.
 */

const DateUtils = (() => {

    /**
     * Parses an arbitrary date input (Date object, string in formats like 'YYYY-MM-DD', 'DD-MMM-YYYY', 'DD/MM/YYYY', etc.)
     * safely taking timezone into account.
     * @param {Date|string|number} input
     * @param {string} [timezone]
     * @returns {Date|null}
     */
    const parseDateSafe = (input, timezone) => {
        if (!input) return null;
        if (input instanceof Date && !isNaN(input.getTime())) {
            return input;
        }
        const str = String(input).trim();
        if (!str || str === 'undefined' || str === 'null' || str === '#N/A') return null;

        // Try YYYY-MM-DD or YYYY/MM/DD
        const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
        if (ymd) {
            return new Date(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10));
        }

        // Try DD-MMM-YYYY (e.g. 06-Oct-2026)
        const dmmmy = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
        if (dmmmy) {
            const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
            const mIdx = months[dmmmy[2].toLowerCase()];
            if (mIdx !== undefined) {
                return new Date(parseInt(dmmmy[3], 10), mIdx, parseInt(dmmmy[1], 10));
            }
        }

        // Try DD/MM/YYYY or DD-MM-YYYY
        const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (dmy) {
            return new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
        }

        // Try standard Date constructor fallback
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
            return d;
        }

        return null;
    };

    /**
     * Calculates the target sales date by offsetting today with configured reporting days,
     * or by parsing an explicit custom date if provided.
     * @param {number|string} reportingDays 
     * @param {string} timezone e.g., 'Asia/Dhaka'
     * @param {Date|string} [customDate]
     * @returns {Date} 
     */
    const getTargetSalesDate = (reportingDays, timezone, customDate) => {
        const tz = timezone || 'Asia/Dhaka';
        if (customDate) {
            const parsed = parseDateSafe(customDate, tz);
            if (parsed) return parsed;
        }
        // Current time shifted to proper timezone config
        const nowStr = new Date().toLocaleString("en-US", { timeZone: tz });
        const target = new Date(nowStr);
        const days = (reportingDays !== undefined && reportingDays !== '' && !isNaN(parseInt(reportingDays, 10)))
            ? parseInt(reportingDays, 10)
            : 0;
        target.setDate(target.getDate() - days);
        return target;
    };

    /**
     * Computes the day integer (1-31) of a given date to map to column headers.
     * @param {Date} dateObj
     * @returns {number}
     */
    const getDayOfMonth = (dateObj) => {
        return dateObj.getDate();
    };

    /**
     * Calculates exactly when the reminder is eligible to be triggered based on lock offset.
     * @param {Date} reportingDate 
     * @param {number} lockOffsetDays 
     */
    const getReminderEligibilityDate = (reportingDate, lockOffsetDays) => {
        const reminder = new Date(reportingDate.getTime());
        reminder.setDate(reminder.getDate() + lockOffsetDays);
        return reminder;
    };

    /**
     * Single Source of Truth for Reporting Month calculation.
     * Days 1–4 (inclusive): Previous Month.
     * Day 5 until Month End: Current Month.
     * 
     * @param {Date} [refDate] Optional reference date object.
     * @param {string} [timezone] Timezone string (e.g. 'Asia/Dhaka').
     * @returns {Date} 1st day of the active reporting month.
     */
    const getReportingMonthDate = (refDate, timezone) => {
        const tz = timezone || 'Asia/Dhaka';
        const baseDate = refDate || new Date();
        const nowStr = baseDate.toLocaleString("en-US", { timeZone: tz });
        const localNow = new Date(nowStr);
        const day = localNow.getDate();

        if (day <= 4) {
            // Days 1 to 4 (inclusive): Previous Month
            return new Date(localNow.getFullYear(), localNow.getMonth() - 1, 1);
        } else {
            // Day 5 until Month End: Current Month
            return new Date(localNow.getFullYear(), localNow.getMonth(), 1);
        }
    };

    /**
     * Calculates the next calendar day relative to the given reference date (or current date) in the timezone.
     * @param {Date} [refDate] Optional reference date.
     * @param {string} [timezone] Timezone string e.g. 'Asia/Dhaka'.
     * @returns {Date}
     */
    const getNextDayDate = (refDate, timezone) => {
        const tz = timezone || 'Asia/Dhaka';
        const baseDate = refDate || new Date();
        const nowStr = baseDate.toLocaleString("en-US", { timeZone: tz });
        const localNow = new Date(nowStr);
        localNow.setDate(localNow.getDate() + 1);
        return localNow;
    };

    /**
     * Formats a date into a clean string for logging and WhatsApp messages.
     */
    const formatDate = (dateObj, timezone) => {
        return Utilities.formatDate(dateObj, timezone, "dd-MMM-yyyy");
    };

    return {
        parseDateSafe,
        getReportingMonthDate,
        getTargetSalesDate,
        getNextDayDate,
        getDayOfMonth,
        getReminderEligibilityDate,
        formatDate
    };
})();
