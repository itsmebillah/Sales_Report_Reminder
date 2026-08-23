/**
 * @fileoverview VisibilityService.js
 * @responsibility Manages 'Office User Mode' sheet visibility. Automatically hides system sheets 
 * and archived Attendance sheets while keeping operational sheets (Dashboard, Attendance, Logs) visible.
 */

const VisibilityService = (() => {

    /**
     * Hides system sheets and archive sheets when AUTO_HIDE_SYSTEM_SHEETS is enabled.
     */
    const applyOfficeUserModeVisibility = () => {
        try {
            const config = ConfigLoader.load();
            const autoHide = String(config['AUTO_HIDE_SYSTEM_SHEETS']).toUpperCase() === 'TRUE';
            if (!autoHide) return;

            const ss = SpreadsheetApp.getActiveSpreadsheet();
            if (!ss) return;

            const systemSheets = ['Sales', 'Hierarchy', 'Contact list', 'Reminder_System'];
            const allSheets = ss.getSheets();

            for (let i = 0; i < allSheets.length; i++) {
                const sheet = allSheets[i];
                const name = sheet.getName();

                const isSystemSheet = systemSheets.includes(name);
                const isArchiveSheet = /^Attendance_\d{4}_\d{2}$/i.test(name);

                if (isSystemSheet || isArchiveSheet) {
                    if (!sheet.isSheetHidden()) {
                        sheet.hideSheet();
                    }
                }
            }
        } catch (err) {
            console.log("VisibilityService encountered an error: " + err);
        }
    };

    return { applyOfficeUserModeVisibility };
})();
