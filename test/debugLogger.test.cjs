const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadDebugLoggerModule() {
  const modulePath = path.resolve(__dirname, '../dist/shared/debugLogger.js');
  delete require.cache[modulePath];
  return require(modulePath);
}

test('safeConsoleLog suppresses broken pipe console failures', () => {
  const originalConsoleLog = console.log;
  let attempts = 0;

  console.log = () => {
    attempts += 1;
    const error = new Error('broken pipe');
    error.code = 'EPIPE';
    throw error;
  };

  try {
    const { safeConsoleLog } = loadDebugLoggerModule();
    assert.doesNotThrow(() => {
      safeConsoleLog('first');
      safeConsoleLog('second');
    });
    assert.equal(attempts, 1);
  } finally {
    console.log = originalConsoleLog;
  }
});
