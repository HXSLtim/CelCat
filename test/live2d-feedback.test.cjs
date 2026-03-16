const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computePointerFocus,
  createTapReaction,
  isPointInsideBounds,
} = require('../dist/renderer/live2d/interaction-feedback.js');

test('computePointerFocus returns neutral values when the pointer is centered', () => {
  const bounds = { x: 100, y: 50, width: 200, height: 300 };
  const pointer = { x: 200, y: 200 };

  assert.deepEqual(computePointerFocus(bounds, pointer), {
    angleX: 0,
    angleY: 0,
    eyeX: 0,
    eyeY: 0,
  });
});

test('computePointerFocus clamps strong pointer offsets to stable limits', () => {
  const bounds = { x: 100, y: 50, width: 200, height: 300 };
  const pointer = { x: 500, y: -300 };

  assert.deepEqual(computePointerFocus(bounds, pointer), {
    angleX: 30,
    angleY: -30,
    eyeX: 1,
    eyeY: -1,
  });
});

test('createTapReaction produces directional squash and nudge values', () => {
  const bounds = { x: 100, y: 100, width: 200, height: 300 };
  const pointer = { x: 280, y: 150 };
  const reaction = createTapReaction(bounds, pointer, 0.5);

  assert.equal(reaction.scaleX > 0.5, true);
  assert.equal(reaction.scaleY < reaction.scaleX, true);
  assert.equal(reaction.shiftX > 0, true);
  assert.equal(reaction.shiftY < 0, true);
  assert.equal(Math.abs(reaction.rotation) > 0, true);
  assert.equal(reaction.flashAlpha > 0.2, true);
});

test('isPointInsideBounds only triggers feedback for in-model taps', () => {
  const bounds = { x: 100, y: 100, width: 200, height: 300 };

  assert.equal(isPointInsideBounds(bounds, { x: 150, y: 160 }), true);
  assert.equal(isPointInsideBounds(bounds, { x: 10, y: 10 }), false);
});
