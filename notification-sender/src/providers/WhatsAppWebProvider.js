/**
 * WhatsAppWebProvider.js
 * @responsibility WhatsApp Web Connection Layer powered by whatsapp-web.js and LocalAuth session management.
 * Exposes methods: initialize(), connect(), disconnect(), isConnected(), getConnectionInfo().
 * Handles events: qr, ready, authenticated, auth_failure, disconnected, loading_screen, change_state.
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const Logger = require('../utils/Logger');

class WhatsAppWebProvider {
    constructor() {
        this.client = null;
        this.providerConfig = null;
        this.connectedState = false;
        this.sessionInfo = {
            clientId: null,
            sessionPath: null,
            pushname: null,
            wid: null,
            connectedAt: null,
            lastEvent: null
        };
    }

    /**
     * Resolves the executable path for Puppeteer (detecting Brave, Chrome, Edge or environment override).
     * @param {string} [customPath] Optional explicit executable path
     * @returns {string} Resolved executable path
     */
    getBrowserExecutablePath(customPath) {
        // 1. Check explicit parameter, Settings BROWSER_PATH, or environment variables
        const envPath = customPath || process.env.BROWSER_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || process.env.BRAVE_PATH || process.env.CHROME_PATH;
        if (envPath) {
            if (fs.existsSync(envPath)) {
                Logger.info(`Using configured browser executable: ${envPath}`);
                return envPath;
            } else {
                Logger.warn(`Configured browser path does not exist: ${envPath}. Falling back to auto-detection.`);
            }
        }

        const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\' + (process.env.USERNAME || 'User') + '\\AppData\\Local';
        const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
        const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

        // 2. Candidate paths in order of preference (Brave -> Chrome -> Edge)
        const candidates = [
            // Brave candidates (Windows default locations)
            path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
            path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
            path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
            'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
            'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',

            // Google Chrome candidates
            path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',

            // Microsoft Edge fallback
            path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        ];

        for (const candidate of candidates) {
            if (candidate && fs.existsSync(candidate)) {
                Logger.info(`✓ Auto-detected Chromium browser executable: ${candidate}`);
                return candidate;
            }
        }

        // macOS / Linux standard paths if applicable
        const unixCandidates = [
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/usr/bin/brave-browser',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser'
        ];

        for (const candidate of unixCandidates) {
            if (fs.existsSync(candidate)) {
                Logger.info(`✓ Auto-detected Chromium browser executable: ${candidate}`);
                return candidate;
            }
        }

        Logger.error('✗ No compatible Chromium browser (Brave / Chrome / Edge) detected on system.');
        throw new Error(
            'No Chromium-based browser found on system. Please install Brave or Google Chrome, ' +
            'or set PUPPETEER_EXECUTABLE_PATH in your .env file.'
        );
    }

    /**
     * Cleans up stale Chromium singleton lock files left by previous crashed/terminated browser instances.
     * @param {string} sessionPath 
     * @param {string} clientId 
     */
    cleanStaleSessionLocks(sessionPath, clientId) {
        const fullSessionDir = path.resolve(sessionPath, `session-${clientId}`);
        if (!fs.existsSync(fullSessionDir)) return;

        const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'LOCK'];
        for (const lockFile of lockFiles) {
            const lockPath = path.join(fullSessionDir, lockFile);
            try {
                if (fs.existsSync(lockPath)) {
                    fs.unlinkSync(lockPath);
                    Logger.info(`Cleaned stale Chromium session lock file: ${lockPath}`);
                }
            } catch (err) {
                // Ignore if currently locked
            }
        }
    }

    /**
     * Initializes the WhatsApp Web client configuration & authentication.
     * @param {Object} providerConfig Config object from ConfigService containing sessionDir, whatsappSessionName, etc.
     */
    async initialize(providerConfig) {
        this.providerConfig = providerConfig || {};

        const sessionPath = this.providerConfig.sessionDir || '.session';
        const clientId = this.providerConfig.whatsappSessionName || 'production';
        const executablePath = this.getBrowserExecutablePath(this.providerConfig.executablePath);

        this.sessionInfo.clientId = clientId;
        this.sessionInfo.sessionPath = path.resolve(sessionPath);

        // Clean any leftover lock files from previous killed processes
        this.cleanStaleSessionLocks(sessionPath, clientId);

        Logger.info('Initializing WhatsAppWebProvider...', {
            sessionPath: this.sessionInfo.sessionPath,
            clientId: this.sessionInfo.clientId,
            executablePath: executablePath
        });

        const puppeteerOpts = {
            headless: true,
            executablePath: executablePath,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        };

        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: clientId,
                dataPath: sessionPath
            }),
            puppeteer: puppeteerOpts
        });

        this.attachEventListeners();
    }

    /**
     * Attaches handlers to all WhatsApp Web client lifecycle events in chronological order.
     */
    attachEventListeners() {
        if (!this.client) return;

        // 1. QR Code Event
        this.client.on('qr', (qr) => {
            this.sessionInfo.lastEvent = 'qr';
            Logger.info('==================================================');
            Logger.info('[EVENT: QR] WhatsApp Web QR Code Generated. Scan with phone:');
            Logger.info('==================================================');
            qrcode.generate(qr, { small: true });
        });

        // 2. Loading Screen Event
        this.client.on('loading_screen', (percent, message) => {
            this.sessionInfo.lastEvent = 'loading_screen';
            Logger.info(`[EVENT: LOADING_SCREEN] WhatsApp Web Loading: ${percent}% - ${message}`);
        });

        // 3. Authenticated Event (Note: Authenticated is NOT connected state)
        this.client.on('authenticated', () => {
            this.sessionInfo.lastEvent = 'authenticated';
            this.connectedState = false; // Strictly NOT connected yet until ready
            Logger.info('[EVENT: AUTHENTICATED] ✓ WhatsApp Web Authenticated successfully. Session saved locally. Awaiting READY event...');
        });

        // 4. Auth Failure Event
        this.client.on('auth_failure', (msg) => {
            this.sessionInfo.lastEvent = 'auth_failure';
            this.connectedState = false;
            Logger.error('[EVENT: AUTH_FAILURE] ✗ WhatsApp Web Authentication Failure:', msg);
        });

        // 5. Change State Event
        this.client.on('change_state', (state) => {
            this.sessionInfo.lastEvent = `change_state:${state}`;
            Logger.info('==================================================');
            Logger.info(`[EVENT: CHANGE_STATE] >>> Client State Changed to: "${state}" <<<`);
            Logger.info('==================================================');
        });

        // 6. Ready Event (Client is fully connected and ready for messaging)
        this.client.on('ready', () => {
            this.connectedState = true;
            this.sessionInfo.lastEvent = 'ready';
            this.sessionInfo.connectedAt = new Date().toISOString();

            if (this.client.info) {
                this.sessionInfo.pushname = this.client.info.pushname || 'N/A';
                this.sessionInfo.wid = this.client.info.wid ? this.client.info.wid._serialized : 'N/A';
            }

            Logger.info('==================================================');
            Logger.info('[EVENT: READY] ✓ WhatsApp Web Client is READY and CONNECTED.');
            Logger.info(`  Authenticated User : ${this.sessionInfo.pushname}`);
            Logger.info(`  WhatsApp ID        : ${this.sessionInfo.wid}`);
            Logger.info('==================================================');
        });

        // 7. Disconnected Event
        this.client.on('disconnected', (reason) => {
            this.connectedState = false;
            this.sessionInfo.lastEvent = 'disconnected';
            Logger.warn('[EVENT: DISCONNECTED] WhatsApp Web Client Disconnected:', reason);
        });
    }

    /**
     * Connects WhatsApp Web client session and resolves ONLY after the "ready" event fires.
     * @param {number} [timeoutMs=120000] Timeout in milliseconds waiting for ready state (default 120s).
     * @returns {Promise<boolean>} Resolves true when ready event fires.
     */
    async connect(timeoutMs = 120000) {
        if (!this.client) {
            throw new Error('WhatsAppWebProvider is not initialized. Call initialize() first.');
        }

        if (this.connectedState) {
            Logger.info('WhatsAppWebProvider is already connected and ready.');
            return true;
        }

        Logger.info(`Connecting WhatsApp Web Client session (awaiting ready event, timeout: ${timeoutMs / 1000}s)...`);

        const debugDir = path.resolve('debug');
        if (!fs.existsSync(debugDir)) {
            fs.mkdirSync(debugDir, { recursive: true });
        }

        return new Promise((resolve, reject) => {
            let timer = null;
            let diagInterval = null;

            const onReady = () => {
                cleanup();
                resolve(true);
            };

            const onAuthFailure = (err) => {
                cleanup();
                reject(new Error(`Authentication failure: ${err}`));
            };

            const onDisconnected = (reason) => {
                cleanup();
                reject(new Error(`WhatsApp Web client disconnected before ready state: ${reason}`));
            };

            const cleanup = () => {
                if (timer) clearTimeout(timer);
                if (diagInterval) clearInterval(diagInterval);
                if (this.client) {
                    this.client.off('ready', onReady);
                    this.client.off('auth_failure', onAuthFailure);
                    this.client.off('disconnected', onDisconnected);
                }
            };

            timer = setTimeout(() => {
                cleanup();
                if (!this.isConnected()) {
                    reject(new Error(`Connection timeout (${timeoutMs / 1000}s) waiting for WhatsApp Web Ready event.`));
                }
            }, timeoutMs);

            // Diagnostics timer: Every 5s logs browser status and url, and takes screenshot every 10s
            let diagTick = 0;
            diagInterval = setInterval(async () => {
                diagTick++;
                try {
                    const hasBrowser = Boolean(this.client && this.client.pupBrowser);
                    const hasPage = Boolean(this.client && this.client.pupPage);
                    let isBrowserAlive = false;
                    let currentUrl = 'N/A';

                    if (hasBrowser) {
                        try { isBrowserAlive = this.client.pupBrowser.isConnected(); } catch (e) {}
                    }
                    if (hasPage) {
                        try { currentUrl = await this.client.pupPage.url(); } catch (e) {}
                    }

                    // Check if ready state can be confirmed via client.info
                    if (this.client && this.client.info && this.client.info.wid) {
                        this.connectedState = true;
                        this.sessionInfo.pushname = this.client.info.pushname || 'N/A';
                        this.sessionInfo.wid = this.client.info.wid._serialized || 'N/A';
                        Logger.info('[DIAGNOSTICS] ✓ Confirmed ready state via client.info!');
                        onReady();
                        return;
                    }

                    Logger.info(`[DIAGNOSTICS t+${diagTick * 5}s] ConnectedState: ${this.connectedState} | BrowserAlive: ${isBrowserAlive} | pupBrowser: ${hasBrowser} | pupPage: ${hasPage} | URL: "${currentUrl}"`);

                    // Every 10s (every 2 ticks), take a debug screenshot if pupPage exists
                    if (hasPage && diagTick % 2 === 0) {
                        try {
                            const ssFileName = `whatsapp_debug_${Date.now()}.png`;
                            const ssPath = path.join(debugDir, ssFileName);
                            await this.client.pupPage.screenshot({ path: ssPath });
                            Logger.info(`📸 Debug Screenshot captured: ${ssPath}`);
                        } catch (ssErr) {
                            Logger.warn(`Screenshot capture notice: ${ssErr.message}`);
                        }
                    }
                } catch (err) {
                    Logger.warn(`Diagnostics interval error: ${err.message}`);
                }
            }, 5000);

            // Register promise handlers for ready / failure events
            this.client.once('ready', onReady);
            this.client.once('auth_failure', onAuthFailure);
            this.client.once('disconnected', onDisconnected);

            // Start client initialization
            this.client.initialize().catch((err) => {
                cleanup();
                reject(err);
            });
        });
    }

    /**
     * Disconnects and destroys the active client session.
     */
    async disconnect() {
        if (this.client) {
            try {
                await this.client.destroy();
                this.connectedState = false;
                Logger.info('WhatsApp Web Client destroyed and disconnected cleanly.');
            } catch (err) {
                Logger.warn('Error during WhatsApp Web disconnect:', err.message);
            }
        }
    }

    /**
     * Returns whether the client is currently connected and ready.
     * @returns {boolean}
     */
    isConnected() {
        return this.connectedState;
    }

    /**
     * Returns complete connection status and session information.
     * @returns {Object}
     */
    getConnectionInfo() {
        return {
            connected: this.connectedState,
            clientId: this.sessionInfo.clientId,
            sessionPath: this.sessionInfo.sessionPath,
            pushname: this.sessionInfo.pushname,
            wid: this.sessionInfo.wid,
            connectedAt: this.sessionInfo.connectedAt,
            lastEvent: this.sessionInfo.lastEvent
        };
    }

    /**
     * Helper to format raw phone numbers into WhatsApp JID format (number@c.us).
     * @param {string} phone 
     * @returns {string} Formatted JID
     */
    formatJid(phone) {
        if (!phone) throw new Error('Recipient phone number is required.');
        let digits = String(phone).replace(/\D/g, '');

        if (digits.startsWith('01') && digits.length === 11) {
            digits = '88' + digits;
        }

        if (digits.length < 10) {
            throw new Error(`Invalid phone number length (${digits.length} digits): ${phone}`);
        }

        return `${digits}@c.us`;
    }

    /**
     * Helper description for WhatsApp message ACK delivery codes.
     * @param {number} ack 
     * @returns {string}
     */
    getAckDescription(ack) {
        switch (ack) {
            case -1: return 'ERROR (Failed to send)';
            case 0: return 'PENDING / CLOCK (Created locally, not sent to server)';
            case 1: return 'SENT / SINGLE CHECK (Delivered to WhatsApp server)';
            case 2: return 'RECEIVED / DOUBLE CHECK (Delivered to recipient device)';
            case 3: return 'READ / BLUE CHECK (Read by recipient)';
            case 4: return 'PLAYED (Audio played)';
            default: return `UNKNOWN (${ack})`;
        }
    }

    /**
     * Sends a WhatsApp text message to the specified recipient using server-validated number resolution (getNumberId).
     * Monitors ACK state for up to 30 seconds to ensure message reaches WhatsApp servers (ACK >= 1).
     * @param {Object} queueRecord Record containing recipientPhone and message text.
     * @param {Object} [providerConfig] Optional provider configuration.
     * @returns {Promise<Object>} Object containing success, messageId, timestamp, and delivery metadata.
     */
    async send(queueRecord, providerConfig) {
        if (!this.isConnected() || !this.client) {
            throw new Error('WhatsAppWebProvider is not connected or client is uninitialized.');
        }

        const phone = queueRecord.recipientPhone || queueRecord.phone || queueRecord.to;
        const message = queueRecord.message || queueRecord.text || queueRecord.body;

        if (!phone) {
            throw new Error('Recipient phone number is missing in queue record.');
        }
        if (!message) {
            throw new Error('Message content is missing in queue record.');
        }

        let cleanDigits = String(phone).replace(/\D/g, '');
        if (cleanDigits.startsWith('01') && cleanDigits.length === 11) {
            cleanDigits = '88' + cleanDigits;
        }

        Logger.info(`Resolving WhatsApp ID (getNumberId) for phone: ${phone} (digits: ${cleanDigits})...`);

        // 1. Resolve recipient via WhatsApp Web server
        const numberId = await this.client.getNumberId(cleanDigits);

        Logger.info('==================================================');
        Logger.info('[RECIPIENT RESOLUTION] getNumberId() Result:');
        console.log(JSON.stringify(numberId, null, 2));
        Logger.info('==================================================');

        // 2. Validate recipient WhatsApp registration
        if (!numberId) {
            const errorMsg = `Recipient phone number (${phone} -> ${cleanDigits}) is NOT registered on WhatsApp or could not be resolved by WhatsApp Web server.`;
            Logger.error(`✗ RECIPIENT RESOLUTION FAILED: ${errorMsg}`);
            return {
                success: false,
                messageId: null,
                timestamp: new Date().toISOString(),
                error: errorMsg
            };
        }

        // 3. Build the send JID using @c.us (whatsapp-web.js internally uses getChat() which requires @c.us format)
        //    getNumberId() may return @lid JIDs on newer WhatsApp accounts — sendMessage() cannot find the chat using @lid.
        //    We use getNumberId() ONLY to confirm the number is registered. The actual dispatch always uses digits@c.us.
        const sendJid = `${cleanDigits}@c.us`;
        Logger.info(`✓ Recipient confirmed registered on WhatsApp.`);
        Logger.info(`  getNumberId() resolved : ${numberId._serialized} (server: ${numberId.server})`);
        Logger.info(`  sendMessage() target   : ${sendJid} (@c.us required by whatsapp-web.js getChat() internals)`);

        try {
            // 4. Dispatch message using @c.us JID (required by whatsapp-web.js getChat() lookup)
            const sentMessage = await this.client.sendMessage(sendJid, message);

            Logger.info('==================================================');
            Logger.info('[DELIVERY DIAGNOSTICS] Initial response from client.sendMessage():');
            Logger.info(`  typeof sentMessage : ${typeof sentMessage}`);
            Logger.info(`  Object.keys        : ${JSON.stringify(sentMessage ? Object.keys(sentMessage) : [])}`);
            Logger.info('--- FULL sentMessage OBJECT (console.dir) ---');
            console.dir(sentMessage, { depth: null, colors: true });
            Logger.info('==================================================');

            let messageId = null;
            if (sentMessage) {
                if (typeof sentMessage.id === 'string') {
                    messageId = sentMessage.id;
                } else if (sentMessage.id && typeof sentMessage.id._serialized === 'string') {
                    messageId = sentMessage.id._serialized;
                } else if (sentMessage.id && typeof sentMessage.id.id === 'string') {
                    messageId = sentMessage.id.id;
                } else if (sentMessage._serialized) {
                    messageId = sentMessage._serialized;
                } else {
                    messageId = `msg_gen_${Date.now()}`;
                }
            }

            let currentAck = (sentMessage && sentMessage.ack !== undefined) ? sentMessage.ack : 0;
            const timestamp = new Date().toISOString();

            // 5. Register real-time ACK event listener
            const ackListener = (msg, ack) => {
                const eventMsgId = msg && msg.id ? (msg.id._serialized || msg.id.id || msg.id) : null;
                if (eventMsgId && messageId) {
                    if (eventMsgId === messageId || String(eventMsgId).includes(String(messageId)) || String(messageId).includes(String(eventMsgId))) {
                        currentAck = ack;
                        Logger.info(`[ACK EVENT UPDATE] Message ACK changed to: ${ack} (${this.getAckDescription(ack)})`);
                    }
                }
            };
            this.client.on('message_ack', ackListener);

            Logger.info('==================================================');
            Logger.info(`[DELIVERY MONITOR] Monitoring ACK status for up to 30 seconds (Target ACK >= 1)...`);
            Logger.info('==================================================');

            // 6. Monitor ACK status every 1 second for up to 30 seconds (or until ACK >= 1)
            let secondsPassed = 0;
            while (secondsPassed < 30 && currentAck < 1) {
                await new Promise((r) => setTimeout(r, 1000));
                secondsPassed++;

                let clientState = 'N/A';
                let isBrowserAlive = false;

                try {
                    if (this.client) clientState = await this.client.getState();
                } catch (e) {}

                try {
                    if (this.client && this.client.pupBrowser) {
                        isBrowserAlive = this.client.pupBrowser.isConnected();
                    }
                } catch (e) {}

                // Active in-page memory check via Puppeteer to ensure ACK state is accurately fetched
                try {
                    if (this.client && this.client.pupPage && isBrowserAlive) {
                        const browserAck = await this.client.pupPage.evaluate(async (msgIdStr) => {
                            try {
                                const Msg = window.require('WAWebCollections').Msg;
                                const msgObj = Msg.get(msgIdStr) || (await Msg.getMessagesById([msgIdStr]))?.messages?.[0];
                                return msgObj ? msgObj.ack : null;
                            } catch (e) {
                                return null;
                            }
                        }, messageId);

                        if (browserAck !== null && browserAck !== undefined && browserAck > currentAck) {
                            currentAck = browserAck;
                            Logger.info(`[BROWSER MEMORY ACK CHECK] Query returned ACK: ${browserAck} (${this.getAckDescription(browserAck)})`);
                        }
                    }
                } catch (e) {}

                Logger.info(`[DELIVERY MONITOR +${secondsPassed}s] ACK: ${currentAck} (${this.getAckDescription(currentAck)}) | ClientState: "${clientState}" | BrowserAlive: ${isBrowserAlive}`);

                if (currentAck >= 1) {
                    Logger.info(`==================================================`);
                    Logger.info(`✓ ACK REACHED ${currentAck} (${this.getAckDescription(currentAck)})! Message transmitted to WhatsApp servers.`);
                    Logger.info(`==================================================`);
                    break;
                }
            }

            this.client.off('message_ack', ackListener);

            if (currentAck < 1) {
                const timeoutMsg = `Delivery timeout: ACK remained at ${currentAck} (0 = PENDING/CLOCK) after 30 seconds. Message was created locally but not acknowledged by WhatsApp servers.`;
                Logger.warn(`⚠️ ${timeoutMsg}`);
                return {
                    success: false,
                    messageId: messageId,
                    ack: currentAck,
                    ackDescription: this.getAckDescription(currentAck),
                    targetJid: sendJid,
                    resolvedJid: numberId._serialized,
                    timestamp: timestamp,
                    error: timeoutMsg,
                    rawResponse: sentMessage
                };
            }

            return {
                success: true,
                messageId: messageId,
                ack: currentAck,
                ackDescription: this.getAckDescription(currentAck),
                targetJid: sendJid,
                resolvedJid: numberId._serialized,
                timestamp: timestamp,
                rawResponse: sentMessage
            };
        } catch (err) {
            Logger.error(`✗ Failed to send WhatsApp message to ${sendJid}:`, err.message);
            return {
                success: false,
                messageId: null,
                timestamp: new Date().toISOString(),
                error: err.message
            };
        }
    }
}

module.exports = WhatsAppWebProvider;
