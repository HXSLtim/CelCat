const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('compiled renderer bundle no longer contains ESM export syntax', () => {
  const bundlePath = path.join(__dirname, '..', 'dist', 'renderer', 'renderer.js');
  const bundle = fs.readFileSync(bundlePath, 'utf8');

  assert.doesNotMatch(
    bundle,
    /\bexport\s*\{\s*\}/,
    'renderer.js should be runnable in Electron without browser ESM parsing errors',
  );
});

test('build output includes the Mao model assets', () => {
  const modelPath = path.join(__dirname, '..', 'dist', 'assets', 'models', 'Mao', 'Mao.model3.json');
  assert.ok(
    fs.existsSync(modelPath),
    'build should copy the Live2D model assets into dist/assets',
  );
});
