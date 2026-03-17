const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getPixiApplicationOptions,
} = require('../dist/renderer/pixiConfig.js');
const rendererBundle = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '..', 'dist', 'renderer', 'renderer.js'),
  'utf8',
);

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

test('renderer bundle installs the Pixi unsafe-eval compatibility patch before boot', () => {
  assert.match(
    rendererBundle,
    /unsafe_eval_1\.install\)\(PIXI\)|installPixiUnsafeEval\(PIXI\)/,
    'renderer.js should explicitly install the Pixi unsafe-eval patch',
  );
});
