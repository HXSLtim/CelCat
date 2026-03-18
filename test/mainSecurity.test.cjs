const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'main.ts'),
  'utf8',
);

test('main window disables renderer Node access and enables isolation', () => {
  assert.match(mainSource, /nodeIntegration:\s*false/, 'main window should disable renderer nodeIntegration');
  assert.match(mainSource, /contextIsolation:\s*true/, 'main window should enable context isolation');
  assert.match(mainSource, /sandbox:\s*true/, 'main window should enable the Electron renderer sandbox');
});

test('main window denies renderer popup creation', () => {
  assert.match(
    mainSource,
    /setWindowOpenHandler\(\(\)\s*=>\s*\(\{\s*action:\s*'deny'\s*\}\)\)/,
    'main window should deny renderer-created popup windows',
  );
});

test('main process can disable hardware acceleration for unstable GPU environments', () => {
  assert.match(
    mainSource,
    /app\.disableHardwareAcceleration\(\)/,
    'main process should be able to disable hardware acceleration before ready',
  );
  assert.match(
    mainSource,
    /appendSwitch\('disable-gpu'\)/,
    'main process should append a disable-gpu Chromium switch when GPU acceleration is disabled',
  );
});
