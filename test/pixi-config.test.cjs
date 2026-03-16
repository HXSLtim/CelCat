const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getPixiApplicationOptions,
} = require('../dist/renderer/pixi-config.js');

test('getPixiApplicationOptions enables auto density for crisp rendering', () => {
  const canvas = { id: 'live2d-canvas' };
  const options = getPixiApplicationOptions(canvas, 2);

  assert.equal(options.view, canvas);
  assert.equal(options.autoDensity, true);
  assert.equal(options.resolution, 2);
  assert.equal(options.backgroundAlpha, 0);
  assert.equal(options.width, 300);
  assert.equal(options.height, 400);
});
