const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getWindowChromeState,
} = require('../dist/renderer/windowChrome.js');

test('window chrome stays hidden until the pointer enters', () => {
  const state = getWindowChromeState({
    hovering: false,
    menuOpen: false,
  });

  assert.deepEqual(state, {
    visible: false,
    className: '',
  });
});

test('window chrome becomes visible on hover or while the menu is open', () => {
  assert.deepEqual(
    getWindowChromeState({ hovering: true, menuOpen: false }),
    { visible: true, className: 'chrome-visible' },
  );

  assert.deepEqual(
    getWindowChromeState({ hovering: false, menuOpen: true }),
    { visible: true, className: 'chrome-visible' },
  );
});
