const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseDotEnv,
  loadProjectEnvFiles,
} = require('../dist/main-process/config/envLoader.js');

test('parseDotEnv supports comments, export syntax, and quoted values', () => {
  const parsed = parseDotEnv(`
# comment
export FOO=bar
BAR="baz qux"
EMPTY=
MULTI_LINE="hello\\nworld"
`);

  assert.deepEqual(parsed, {
    FOO: 'bar',
    BAR: 'baz qux',
    EMPTY: '',
    MULTI_LINE: 'hello\nworld',
  });
});

test('loadProjectEnvFiles prefers explicit env values over .env files', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-env-loader-'));
  fs.writeFileSync(
    path.join(tempRoot, '.env'),
    'VOLCENGINE_REALTIME_ENABLED=true\nVOLCENGINE_APP_ID=from-file\n',
    'utf8',
  );

  const env = {
    VOLCENGINE_APP_ID: 'from-shell',
  };

  const loaded = loadProjectEnvFiles(tempRoot, env);

  assert.equal(env.VOLCENGINE_REALTIME_ENABLED, 'true');
  assert.equal(env.VOLCENGINE_APP_ID, 'from-shell');
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].keys.includes('VOLCENGINE_REALTIME_ENABLED'), true);
  assert.equal(loaded[0].keys.includes('VOLCENGINE_APP_ID'), false);
});
