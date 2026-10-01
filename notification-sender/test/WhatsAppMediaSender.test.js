const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const WhatsAppWebProvider = require('../src/providers/WhatsAppWebProvider');

test('WhatsAppWebProvider.resolveMessageMedia resolves local files on disk', async () => {
    const provider = new WhatsAppWebProvider();
    const pkgPath = path.resolve(__dirname, '../package.json');
    assert.equal(fs.existsSync(pkgPath), true);

    const media = await provider.resolveMessageMedia(pkgPath, 'DOCUMENT');
    assert.ok(media);
    assert.equal(typeof media.data, 'string');
    assert.ok(media.data.length > 0);
    assert.equal(media.filename, 'package.json');
});

test('WhatsAppWebProvider.resolveMessageMedia returns null for empty source', async () => {
    const provider = new WhatsAppWebProvider();
    const media = await provider.resolveMessageMedia('', 'IMAGE');
    assert.equal(media, null);
});

test('WhatsAppWebProvider.isExpectedOutgoingMessage matches media and text captions', () => {
    const provider = new WhatsAppWebProvider();
    const mockMessage = {
        fromMe: true,
        to: '8801915966721@c.us',
        id: { _serialized: 'true_8801915966721@c.us_3EB0123456789' },
        hasMedia: true,
        body: 'Sales Report attached'
    };

    const isMatch = provider.isExpectedOutgoingMessage(
        mockMessage,
        ['8801915966721@c.us'],
        'Sales Report attached',
        true
    );
    assert.equal(isMatch, true);
});
