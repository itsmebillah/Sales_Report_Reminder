/**
 * SMSProvider.js
 * @responsibility Independent provider placeholder for SMS notifications.
 */

class SMSProvider {
    async initialize(providerConfig) {}

    async send(queueRecord, providerConfig) {
        return { success: true, messageId: null };
    }
}

module.exports = SMSProvider;
