/**
 * QueueService.js
 * @responsibility Queue state manager coordinating with GoogleSheetService.
 * Exposes methods: readPendingQueue(), markProcessing(), markSent(), markFailed(), updateRetry().
 * Queue sheet name is passed dynamically from ConfigService.
 */

class QueueService {
    constructor(sheetService, configService) {
        this.sheetService = sheetService;
        this.configService = configService;
    }

    getQueueSheetName() {
        return this.configService.getRuntime('queueSheet') || 'Message_Queue';
    }

    async readPendingQueue() {
        const sheetName = this.getQueueSheetName();
        return await this.sheetService.readPendingQueue(sheetName);
    }

    async markProcessing(queueId, rowIndex) {
        const sheetName = this.getQueueSheetName();
        await this.sheetService.updateQueueStatus(sheetName, rowIndex, 'PROCESSING');
    }

    async markSent(queueId, rowIndex) {
        const sheetName = this.getQueueSheetName();
        await this.sheetService.updateQueueStatus(sheetName, rowIndex, 'SENT');
    }

    async markFailed(queueId, rowIndex, errorMessage) {
        const sheetName = this.getQueueSheetName();
        await this.sheetService.updateQueueStatus(sheetName, rowIndex, 'FAILED');
    }

    async updateRetry(queueId, rowIndex, retryCount) {
        const sheetName = this.getQueueSheetName();
        await this.sheetService.updateQueueStatus(sheetName, rowIndex, 'PENDING');
    }
}

module.exports = QueueService;
