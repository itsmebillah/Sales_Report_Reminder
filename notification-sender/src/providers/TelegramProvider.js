/**
 * TelegramProvider.js
 * @responsibility Independent provider for sending Telegram notifications.
 * Accepts ONLY queueRecord and providerConfig.
 */

class TelegramProvider {
    async initialize(providerConfig) {
        // Placeholder
    }

    async send(queueRecord, providerConfig) {
        return { success: true, messageId: null };
    }
}

module.exports = TelegramProvider;
