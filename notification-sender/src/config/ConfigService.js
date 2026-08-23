/**
 * ConfigService.js
 * @responsibility Single Source of Truth for configuration.
 * - Infrastructure credentials loaded strictly from .env.
 * - All runtime business configuration loaded from Dashboard columns C:H.
 * - Supports reload(sheetService) on every cycle for zero-restart live setting updates.
 */

const dotenv = require('dotenv');

class ConfigService {
    constructor() {
        this.infraConfig = null;
        this.runtimeConfig = null;
    }

    /**
     * Loads infrastructure credentials strictly from .env.
     */
    loadInfraConfig() {
        dotenv.config();

        const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT || '';

        this.infraConfig = {
            googleSheetId: process.env.GOOGLE_SHEET_ID || '',
            googleServiceAccountJson: serviceAccountJson
        };

        return this.infraConfig;
    }

    /**
     * Helper to parse boolean configuration values.
     */
    parseBoolean(val, fallback = false) {
        if (val === undefined || val === null || val === '') return fallback;
        if (typeof val === 'boolean') return val;
        const str = String(val).trim().toUpperCase();
        return str === 'TRUE' || str === '1' || str === 'YES';
    }

    /**
     * Reads Dashboard configuration and builds cached runtime configuration.
     * Can be invoked every cycle to reload settings dynamically.
     * @param {Object} sheetService Instance of GoogleSheetService
     */
    async reload(sheetService) {
        const rawMap = await sheetService.readConfiguration();

        this.runtimeConfig = {
            appName: String(rawMap['APP_NAME'] || 'Notification Sender').trim(),
            appEnv: String(rawMap['APP_ENV'] || 'development').trim(),
            logLevel: String(rawMap['LOG_LEVEL'] || 'INFO').trim().toUpperCase(),
            pollInterval: parseInt(rawMap['POLL_INTERVAL'] || rawMap['QUEUE_POLL_INTERVAL'], 10) || 10,
            maxRetry: parseInt(rawMap['MAX_RETRY'], 10) || 3,
            queueBatchSize: parseInt(rawMap['QUEUE_BATCH_SIZE'], 10) || 1,
            queueSheet: String(rawMap['QUEUE_SHEET'] || 'Message_Queue').trim(),
            sessionDir: String(rawMap['SESSION_DIR'] || rawMap['SESSION_PATH'] || '.session').trim(),
            defaultProvider: String(rawMap['DEFAULT_PROVIDER'] || rawMap['NOTIFICATION_PROVIDER'] || 'WHATSAPP_WEB').trim().toUpperCase(),
            whatsappEnabled: this.parseBoolean(rawMap['WHATSAPP_ENABLED'], true),
            telegramEnabled: this.parseBoolean(rawMap['TELEGRAM_ENABLED'], false),
            metaEnabled: this.parseBoolean(rawMap['META_ENABLED'], false),
            emailEnabled: this.parseBoolean(rawMap['EMAIL_ENABLED'], false),
            smsEnabled: this.parseBoolean(rawMap['SMS_ENABLED'], false),
            queueEnabled: this.parseBoolean(rawMap['QUEUE_ENABLED'], true),
            autoRetry: this.parseBoolean(rawMap['AUTO_RETRY'], true),
            autoClearSent: this.parseBoolean(rawMap['AUTO_CLEAR_SENT'], false),
            clearAfterDays: parseInt(rawMap['CLEAR_AFTER_DAYS'], 10) || 10,
            systemStatus: String(rawMap['SYSTEM_STATUS'] || 'STOP').trim().toUpperCase(),
            senderMode: String(rawMap['SENDER_MODE'] || 'PRODUCTION').trim().toUpperCase(),
            testMode: this.parseBoolean(rawMap['TEST_MODE'], false),
            senderStatus: String(rawMap['Sender_Status'] || '').trim(),
            autoShutdownEnabled: this.parseBoolean(rawMap['AUTO_SHUTDOWN_ENABLED'], false),
            autoShutdownDelayMinutes: parseInt(rawMap['AUTO_SHUTDOWN_DELAY_MINUTES'], 10) || 12,
            autoShutdownRunActive: this.parseBoolean(rawMap['AUTO_SHUTDOWN_RUN_ACTIVE'], false),
            autoShutdownRunId: String(rawMap['AUTO_SHUTDOWN_RUN_ID'] || '').trim(),
            autoShutdownRunPhase: String(rawMap['AUTO_SHUTDOWN_RUN_PHASE'] || 'IDLE').trim().toUpperCase(),
            autoShutdownRunQueueIds: String(rawMap['AUTO_SHUTDOWN_RUN_QUEUE_IDS'] || '[]').trim(),
            autoShutdownLastQueueId: String(rawMap['AUTO_SHUTDOWN_LAST_QUEUE_ID'] || '').trim(),
            autoShutdownFinalCheckAt: String(rawMap['AUTO_SHUTDOWN_FINAL_CHECK_AT'] || '').trim(),
            autoShutdownPendingUntil: String(rawMap['AUTO_SHUTDOWN_PENDING_UNTIL'] || '').trim(),
            autoShutdownRetryUsed: this.parseBoolean(rawMap['AUTO_SHUTDOWN_RETRY_USED'], false),
            autoShutdownCancelReason: String(rawMap['AUTO_SHUTDOWN_CANCEL_REASON'] || '').trim(),
            telegramBotToken: String(rawMap['TELEGRAM_BOT_TOKEN'] || '').trim(),
            telegramChatId: String(rawMap['TELEGRAM_CHAT_ID'] || '').trim(),
            whatsappSessionName: String(rawMap['WHATSAPP_SESSION_NAME'] || 'production').trim(),
            browserPath: String(rawMap['BROWSER_PATH'] || rawMap['PUPPETEER_EXECUTABLE_PATH'] || process.env.BROWSER_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '').trim(),
            testRecipientPhone: String(rawMap['TEST_RECIPIENT_PHONE'] || rawMap['TEST_PHONE'] || rawMap['RECIPIENT_PHONE'] || '').trim(),
            testMessage: String(rawMap['TEST_MESSAGE'] || 'Hello Masum\nThis is the first WhatsApp Web integration test.\nNotification Sender is connected successfully.').trim()
        };

        return this.runtimeConfig;
    }

    /**
     * Gets infrastructure credentials.
     */
    getInfra(key) {
        if (!this.infraConfig) {
            this.loadInfraConfig();
        }
        return this.infraConfig[key];
    }

    /**
     * Gets cached runtime setting.
     */
    getRuntime(key) {
        if (!this.runtimeConfig) {
            throw new Error('Runtime config not loaded. Call reload(sheetService) first.');
        }
        return this.runtimeConfig[key];
    }

    /**
     * Helper to extract clean provider-specific configuration.
     * @param {string} providerName 
     */
    getProviderConfig(providerName) {
        if (!this.runtimeConfig) {
            throw new Error('Runtime config not loaded.');
        }
        const name = String(providerName || '').toUpperCase();
        return {
            sessionDir: this.runtimeConfig.sessionDir,
            whatsappSessionName: this.runtimeConfig.whatsappSessionName,
            executablePath: this.runtimeConfig.browserPath,
            telegramBotToken: this.runtimeConfig.telegramBotToken,
            telegramChatId: this.runtimeConfig.telegramChatId,
            testMode: this.runtimeConfig.testMode,
            providerName: name
        };
    }

    /**
     * Checks if a given provider is enabled in current runtime config.
     * @param {string} providerName 
     */
    isProviderEnabled(providerName) {
        if (!this.runtimeConfig) return false;
        const name = String(providerName || '').toUpperCase();
        if (name === 'WHATSAPP_WEB' || name === 'WHATSAPP') return this.runtimeConfig.whatsappEnabled;
        if (name === 'TELEGRAM') return this.runtimeConfig.telegramEnabled;
        if (name === 'META_API' || name === 'META') return this.runtimeConfig.metaEnabled;
        if (name === 'EMAIL') return this.runtimeConfig.emailEnabled;
        if (name === 'SMS') return this.runtimeConfig.smsEnabled;
        return true;
    }
}

module.exports = new ConfigService();
