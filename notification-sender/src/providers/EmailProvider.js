/**
 * EmailProvider.js
 * @responsibility Independent provider placeholder for Email notifications.
 */

class EmailProvider {
    async initialize(providerConfig) {}

    async send(queueRecord, providerConfig) {
        return { success: true, messageId: null };
    }
}

module.exports = EmailProvider;
