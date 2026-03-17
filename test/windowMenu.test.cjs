const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getWindowMenuItems,
  getNextMenuOpenState,
} = require('../dist/renderer/windowMenu.js');

test('window menu exposes refit and close actions', () => {
  assert.deepEqual(getWindowMenuItems(), [
    { id: 'refit-model', label: '重新适配模型' },
    { id: 'open-control-panel', label: '打开控制面板' },
    { id: 'toggle-fullscreen', label: '进入全屏' },
    { id: 'close-window', label: '关闭窗口' },
  ]);
});

test('window menu switches fullscreen label based on current state', () => {
  assert.deepEqual(getWindowMenuItems({ isFullscreen: true }), [
    { id: 'refit-model', label: '重新适配模型' },
    { id: 'open-control-panel', label: '打开控制面板' },
    { id: 'toggle-fullscreen', label: '退出全屏' },
    { id: 'close-window', label: '关闭窗口' },
  ]);
});

test('menu state toggles open and closed predictably', () => {
  assert.equal(getNextMenuOpenState(false, 'toggle'), true);
  assert.equal(getNextMenuOpenState(true, 'toggle'), false);
  assert.equal(getNextMenuOpenState(true, 'close'), false);
  assert.equal(getNextMenuOpenState(false, 'close'), false);
});
