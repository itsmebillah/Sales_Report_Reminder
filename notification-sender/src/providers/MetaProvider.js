/**
 * MetaProvider.js
 * @responsibility Independent provider placeholder for WhatsApp Cloud API.
 */

class MetaProvider {
    async initialize(providerConfig) {}

    async send(queueRecord, providerConfig) {
        return { success: true, messageId: null };
    }
}

module.exports = MetaProvider;
