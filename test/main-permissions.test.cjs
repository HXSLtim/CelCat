const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldGrantPermissionRequest,
  shouldGrantPermissionCheck,
} = require('../dist/main-process/permissions.js');

test('shouldGrantPermissionRequest allows audio media capture for this app', () => {
  assert.equal(
    shouldGrantPermissionRequest('media', { mediaTypes: ['audio'] }),
    true,
  );
});

test('shouldGrantPermissionRequest rejects unrelated permissions', () => {
  assert.equal(
    shouldGrantPermissionRequest('notifications', {}),
    false,
  );
  assert.equal(
    shouldGrantPermissionRequest('media', { mediaTypes: ['video'] }),
    false,
  );
});

test('shouldGrantPermissionCheck only allows audio media origins', () => {
  assert.equal(
    shouldGrantPermissionCheck('media', { mediaType: 'audio' }),
    true,
  );
  assert.equal(
    shouldGrantPermissionCheck('media', { mediaType: 'video' }),
    false,
  );
});
