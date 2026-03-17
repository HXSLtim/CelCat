const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldHandleWatchPath } = require('../scripts/dev-watch-utils.cjs');

test('shouldHandleWatchPath watches source, scripts, and root config files', () => {
  assert.equal(shouldHandleWatchPath('src/renderer/renderer.ts'), true);
  assert.equal(shouldHandleWatchPath('src/assets/models/Mao/Mao.model3.json'), true);
  assert.equal(shouldHandleWatchPath('scripts/build.cjs'), true);
  assert.equal(shouldHandleWatchPath('package.json'), true);
  assert.equal(shouldHandleWatchPath('tsconfig.json'), true);
});

test('shouldHandleWatchPath ignores generated and external paths', () => {
  assert.equal(shouldHandleWatchPath('dist/main.js'), false);
  assert.equal(shouldHandleWatchPath('node_modules/pixi.js'), false);
  assert.equal(shouldHandleWatchPath('.git/index'), false);
  assert.equal(shouldHandleWatchPath('electron-dev.out.log'), false);
});
