const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getWindowMenuItems,
  getNextMenuOpenState,
} = require('../dist/renderer/windowMenu.js');

test('window menu exposes refit and close actions', () => {
  assert.deepEqual(getWindowMenuItems(), [
    { id: 'refit-model', label: '重新适配模型' },
    { id: 'close-window', label: '关闭窗口' },
  ]);
});

test('menu state toggles open and closed predictably', () => {
  assert.equal(getNextMenuOpenState(false, 'toggle'), true);
  assert.equal(getNextMenuOpenState(true, 'toggle'), false);
  assert.equal(getNextMenuOpenState(true, 'close'), false);
  assert.equal(getNextMenuOpenState(false, 'close'), false);
});
