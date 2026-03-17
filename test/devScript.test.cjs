const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const packageJson = require(path.join(__dirname, '..', 'package.json'));

test('package scripts expose watch mode for development hot reload', () => {
  assert.equal(
    packageJson.scripts.dev,
    'node scripts/dev-watch.cjs',
  );
  assert.equal(
    packageJson.scripts['dev:once'],
    'npm run build && node scripts/run-electron.cjs --dev',
  );
});
