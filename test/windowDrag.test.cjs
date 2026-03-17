const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDragSession,
  getWindowPositionForPointer,
} = require('../dist/renderer/windowDrag.js');

test('createDragSession stores the pointer offset from the window origin', () => {
  assert.deepEqual(
    createDragSession({ x: 400, y: 200 }, { x: 460, y: 245 }),
    { offsetX: 60, offsetY: 45 },
  );
});

test('getWindowPositionForPointer keeps the original grab offset while dragging', () => {
  const session = createDragSession({ x: 400, y: 200 }, { x: 460, y: 245 });

  assert.deepEqual(
    getWindowPositionForPointer(session, { x: 510, y: 300 }),
    { x: 450, y: 255 },
  );
});
