const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getPixiApplicationOptions,
  getViewportSize,
} = require('../dist/renderer/pixiConfig.js');
const rendererBundle = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '..', 'dist', 'renderer', 'renderer.js'),
  'utf8',
);

test('getPixiApplicationOptions enables auto density for crisp rendering', () => {
  const canvas = { id: 'live2d-canvas' };
  const options = getPixiApplicationOptions(canvas, 2, {
    innerWidth: 1280,
    innerHeight: 720,
  });

  assert.equal(options.view, canvas);
  assert.equal(options.autoDensity, true);
  assert.equal(options.resolution, 2);
  assert.equal(options.backgroundAlpha, 0);
  assert.equal(options.width, 1280);
  assert.equal(options.height, 720);
});

test('getViewportSize falls back to the default companion size when viewport is unavailable', () => {
  assert.deepEqual(getViewportSize(), { width: 300, height: 400 });
  assert.deepEqual(getViewportSize({ innerWidth: 0, innerHeight: 0 }), { width: 300, height: 400 });
});

test('renderer bundle installs the Pixi unsafe-eval compatibility patch before boot', () => {
  assert.match(
    rendererBundle,
    /init_unsafe_eval\(\)|Unable to patch ShaderSystem, class not found\./,
    'renderer.js should explicitly install the Pixi unsafe-eval patch',
  );
});
