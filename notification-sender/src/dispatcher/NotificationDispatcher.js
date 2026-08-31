/**
 * NotificationDispatcher.js
 * @responsibility Route normalized queue objects to targeted notification providers.
 * Receives ConfigService instance. Decoupled from Google Sheets and domain logic.
 */

class NotificationDispatcher {
    constructor(configService) {
        this.configService = configService;
        this.providers = new Map();
    }

    registerProvider(name, providerInstance) {
        this.providers.set(name.toUpperCase(), providerInstance);
    }

    async dispatch(queueRecord) {
        const defaultProvider = this.configService.getRuntime('defaultProvider') || 'WHATSAPP_WEB';
        const targetProviderName = (queueRecord.provider || defaultProvider).toUpperCase();

        // 1. Check if Provider is Enabled in ConfigService
        if (!this.configService.isProviderEnabled(targetProviderName)) {
            return {
                success: false,
                skipped: true,
                reason: `Provider ${targetProviderName} is disabled in Dashboard configuration.`
            };
        }

        const providerInstance = this.providers.get(targetProviderName);
        if (!providerInstance) {
            throw new Error(`Unregistered notification provider: ${targetProviderName}`);
        }

        // 2. Extract provider-specific configuration from ConfigService
        const providerConfig = this.configService.getProviderConfig(targetProviderName);

        // 3. Dispatch to provider with ONLY queueRecord and providerConfig
        return await providerInstance.send(queueRecord, providerConfig);
    }
}

module.exports = NotificationDispatcher;
