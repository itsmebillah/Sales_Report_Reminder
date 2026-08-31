const { execFile } = require('child_process');

/**
 * Initiates a normal Windows shutdown. Tests inject a mock instead of calling this.
 */
function executeWindowsShutdown() {
    return new Promise((resolve, reject) => {
        if (process.platform !== 'win32') {
            reject(new Error('Windows shutdown is only supported on win32.'));
            return;
        }

        execFile('shutdown.exe', ['/s', '/t', '0', '/f'], { windowsHide: true }, error => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

module.exports = executeWindowsShutdown;
