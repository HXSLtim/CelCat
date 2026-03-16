const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeModelLayout,
} = require('../dist/renderer/live2d/layout.js');

test('computeModelLayout scales down oversized models to fit the viewport', () => {
  const layout = computeModelLayout(
    { width: 300, height: 400 },
    { x: 0, y: 0, width: 2048, height: 2048 },
  );

  assert.ok(layout.scale > 0);
  assert.ok(layout.scale < 0.2);
  assert.equal(layout.positionX, 150);
  assert.equal(layout.positionY, 220);
  assert.equal(layout.pivotX, 1024);
  assert.equal(layout.pivotY, 1024);
});

test('computeModelLayout uses the real bounds center even when the model is offset', () => {
  const layout = computeModelLayout(
    { width: 300, height: 400 },
    { x: -120, y: -40, width: 600, height: 900 },
  );

  assert.equal(layout.pivotX, 180);
  assert.equal(layout.pivotY, 410);
  assert.equal(layout.positionX, 150);
  assert.equal(layout.positionY, 220);
  assert.ok(layout.scale > 0.3);
  assert.ok(layout.scale < 0.5);
});
