const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const packageJson = require(path.join(__dirname, '..', 'package.json'));

test('pixi.js stays on major version 6 for pixi-live2d-display v0.4', () => {
  assert.match(
    packageJson.dependencies['pixi.js'],
    /^(\^|~)?6\./,
    'pixi-live2d-display v0.4 expects PixiJS v6, so pixi.js should stay on major version 6',
  );
});

test('@pixi/unsafe-eval stays aligned with PixiJS v6', () => {
  assert.match(
    packageJson.dependencies['@pixi/unsafe-eval'],
    /^(\^|~)?6\./,
    'the unsafe-eval compatibility module should stay on PixiJS v6 in this app',
  );
});
