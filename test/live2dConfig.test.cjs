const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_MODEL_NAME,
  getModelJsonPath,
  getModelLoadOptions,
} = require('../dist/renderer/live2d/modelConfig.js');

test('model config points at the bundled Mao model by default', () => {
  assert.equal(DEFAULT_MODEL_NAME, 'Mao');
  assert.equal(getModelJsonPath(), '../assets/models/Mao/Mao.model3.json');
});

test('model loading disables pixi-live2d-display auto interaction', () => {
  assert.deepEqual(getModelLoadOptions(), {
    autoInteract: false,
  });
});
