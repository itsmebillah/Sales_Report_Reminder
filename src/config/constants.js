const HIERARCHY_COLUMNS = Object.freeze({
    RSM_ID: 0,
    RSM_NAME: 1,
    TSO_ID: 2,
    TSO_NAME: 3,
    SR_ID: 4,
    SR_NAME: 5
});

const EXPECTED_HIERARCHY_HEADERS = Object.freeze([
    'RSM ID', 'RSM Name', 'TSO ID', 'TSO Name', 'SR ID', 'SR Name'
]);

const ConfigLoader = (() => {
    let cachedConfig = null;

    const load = () => {
        if (cachedConfig) return cachedConfig;

        const ss = SpreadsheetApp.getActiveSpreadsheet();
        if (!ss) throw new Error("No active spreadsheet found.");

        const sheet = ss.getSheetByName("Settings");
        if (!sheet) throw new Error("Settings sheet is missing. Please run EnvironmentSetup.init().");

        const data = sheet.getDataRange().getValues();
        const config = {};

        // Start at row 1 to skip header
        for (let i = 1; i < data.length; i++) {
            const key = data[i][0];
            const value = data[i][1];
            if (key) {
                config[key] = value;
            }
        }

        cachedConfig = config;
        return cachedConfig;
    };

    return { load };
})();
