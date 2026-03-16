const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeElectronEnv } = require('../scripts/electron-runner-utils.cjs');

test('sanitizeElectronEnv removes ELECTRON_RUN_AS_NODE without mutating the input', () => {
  const originalEnv = {
    ELECTRON_RUN_AS_NODE: '1',
    PATH: 'C:\\tools',
    NODE_ENV: 'development',
  };

  const sanitizedEnv = sanitizeElectronEnv(originalEnv);

  assert.equal(sanitizedEnv.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(sanitizedEnv.PATH, 'C:\\tools');
  assert.equal(sanitizedEnv.NODE_ENV, 'development');
  assert.equal(originalEnv.ELECTRON_RUN_AS_NODE, '1');
});
