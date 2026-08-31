/**
 * @fileoverview DateUtils.js
 * @responsibility Shared utilities for calculating reporting deadlines natively using 
 * the configuration constraints and mapping dates to spreadsheet columns.
 */

const DateUtils = (() => {

    /**
     * Calculates the target sales date by offsetting today with configured reporting days.
     * @param {number} reportingDays 
     * @param {string} timezone e.g., 'Asia/Dhaka'
     * @returns {Date} 
     */
    const getTargetSalesDate = (reportingDays, timezone) => {
        // Current time shifted to proper timezone config
        const nowStr = new Date().toLocaleString("en-US", { timeZone: timezone });
        const target = new Date(nowStr);
        target.setDate(target.getDate() - reportingDays);
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
        getReportingMonthDate,
        getTargetSalesDate,
        getNextDayDate,
        getDayOfMonth,
        getReminderEligibilityDate,
        formatDate
    };
})();
