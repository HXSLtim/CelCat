const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidWindowPosition,
} = require('../dist/renderer/windowDrag.js');

test('isValidWindowPosition accepts finite coordinates', () => {
  assert.equal(isValidWindowPosition({ x: 120, y: 45 }), true);
});

test('isValidWindowPosition rejects NaN and infinity', () => {
  assert.equal(isValidWindowPosition({ x: Number.NaN, y: 45 }), false);
  assert.equal(isValidWindowPosition({ x: 120, y: Number.POSITIVE_INFINITY }), false);
});
