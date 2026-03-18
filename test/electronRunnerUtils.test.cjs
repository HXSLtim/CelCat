const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getElectronLaunchArgs,
  sanitizeElectronEnv,
  shouldDisableGpuForElectron,
} = require('../scripts/electron-runner-utils.cjs');

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

test('sanitizeElectronEnv enables the Linux GPU compatibility flag by default', () => {
  const sanitizedEnv = sanitizeElectronEnv({
    PATH: '/usr/bin',
  }, 'linux');

  assert.equal(sanitizedEnv.CELCAT_DISABLE_GPU, '1');
});

test('shouldDisableGpuForElectron honors explicit env overrides', () => {
  assert.equal(shouldDisableGpuForElectron({ CELCAT_DISABLE_GPU: '1' }, 'win32'), true);
  assert.equal(shouldDisableGpuForElectron({ CELCAT_DISABLE_GPU: '0' }, 'linux'), false);
});

test('getElectronLaunchArgs prepends GPU-safe launch switches on Linux', () => {
  const launchArgs = getElectronLaunchArgs(['.', '--dev'], {}, 'linux');

  assert.deepEqual(
    launchArgs,
    ['--disable-gpu-compositing', '--disable-gpu', '.', '--dev'],
  );
});
