const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifestPath = path.join(__dirname, '..', 'sakuraInc Extension/Resources/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

test('manifest permissions are minimal and constrained', () => {
  assert.deepEqual(manifest.permissions, ['nativeMessaging']);
  assert.deepEqual(manifest.host_permissions, ['*://*.sakura-checker.jp/*']);
});
