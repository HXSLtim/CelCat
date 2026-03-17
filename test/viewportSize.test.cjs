const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getLogicalViewportSize,
} = require('../dist/renderer/live2d/viewport.js');

test('getLogicalViewportSize prefers the logical Pixi screen size over backing canvas pixels', () => {
  const viewport = getLogicalViewportSize({
    screen: { width: 300, height: 400 },
    view: { width: 600, height: 800 },
  });

  assert.deepEqual(viewport, {
    width: 300,
    height: 400,
  });
});

test('getLogicalViewportSize falls back to view size when screen is unavailable', () => {
  const viewport = getLogicalViewportSize({
    view: { width: 300, height: 400 },
  });

  assert.deepEqual(viewport, {
    width: 300,
    height: 400,
  });
});
