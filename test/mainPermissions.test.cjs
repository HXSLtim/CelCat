const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldGrantPermissionRequest,
  shouldGrantPermissionCheck,
} = require('../dist/main-process/permissions.js');

const TRUSTED_RENDERER_URL = 'file:///app/dist/renderer/index.html';
const UNTRUSTED_RENDERER_URL = 'https://example.com/renderer/index.html';

test('shouldGrantPermissionRequest allows audio media capture for this app', () => {
  assert.equal(
    shouldGrantPermissionRequest('media', {
      mediaTypes: ['audio'],
      requestingUrl: TRUSTED_RENDERER_URL,
      isMainFrame: true,
    }),
    true,
  );
});

test('shouldGrantPermissionRequest rejects unrelated permissions', () => {
  assert.equal(
    shouldGrantPermissionRequest('notifications', {
      requestingUrl: TRUSTED_RENDERER_URL,
      isMainFrame: true,
    }),
    false,
  );
  assert.equal(
    shouldGrantPermissionRequest('media', {
      mediaTypes: ['video'],
      requestingUrl: TRUSTED_RENDERER_URL,
      isMainFrame: true,
    }),
    false,
  );
  assert.equal(
    shouldGrantPermissionRequest('media', {
      mediaTypes: ['audio'],
      requestingUrl: UNTRUSTED_RENDERER_URL,
      isMainFrame: true,
    }),
    false,
  );
  assert.equal(
    shouldGrantPermissionRequest('media', {
      mediaTypes: ['audio'],
      requestingUrl: TRUSTED_RENDERER_URL,
      isMainFrame: false,
    }),
    false,
  );
});

test('shouldGrantPermissionCheck only allows audio media origins', () => {
  assert.equal(
    shouldGrantPermissionCheck('media', {
      mediaType: 'audio',
      requestingUrl: TRUSTED_RENDERER_URL,
    }),
    true,
  );
  assert.equal(
    shouldGrantPermissionCheck('media', {
      mediaType: 'video',
      requestingUrl: TRUSTED_RENDERER_URL,
    }),
    false,
  );
  assert.equal(
    shouldGrantPermissionCheck('media', {
      mediaType: 'audio',
      requestingUrl: UNTRUSTED_RENDERER_URL,
    }),
    false,
  );
});
