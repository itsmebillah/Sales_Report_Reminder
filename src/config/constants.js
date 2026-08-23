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

        let repository = ConfigurationService.readMap();
        if (Object.keys(repository.map).length === 0) {
            ConfigurationService.ensureDefaults();
            repository = ConfigurationService.readMap();
        }
        const config = {};

        const { map } = repository;
        Object.keys(map).forEach(key => { config[key] = map[key].value; });

        cachedConfig = config;
        return cachedConfig;
    };

    const invalidate = () => { cachedConfig = null; };

    return { load, invalidate };
})();
