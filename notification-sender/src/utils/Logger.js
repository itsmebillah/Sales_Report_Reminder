/**
 * Logger.js
 * @responsibility Logging utility supporting INFO, WARN, ERROR, DEBUG levels with console and log file output.
 */

const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
        this.currentLevel = process.env.LOG_LEVEL || 'INFO';
        this.logFilePath = process.env.LOG_FILE_PATH || './logs/app.log';
    }

    formatMessage(level, message, meta = '') {
        const timestamp = new Date().toISOString();
        const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] [${level}] ${message}${metaStr}`;
    }

    log(level, message, meta) {
        if ((this.levels[level] || 0) < (this.levels[this.currentLevel] || 0)) {
            return;
        }
        const formatted = this.formatMessage(level, message, meta);
        console.log(formatted);
        this.writeToFile(formatted);
    }

    info(message, meta) { this.log('INFO', message, meta); }
    warn(message, meta) { this.log('WARN', message, meta); }
    error(message, meta) { this.log('ERROR', message, meta); }
    debug(message, meta) { this.log('DEBUG', message, meta); }

    writeToFile(formattedMessage) {
        try {
            const dir = path.dirname(this.logFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.appendFileSync(this.logFilePath, formattedMessage + '\n');
        } catch (err) {
            // Ignore file output errors in placeholder phase
        }
    }
}

module.exports = new Logger();
