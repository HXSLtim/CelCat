const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('renderer shell loads the Cubism runtime before booting the renderer bundle', () => {
  const htmlPath = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const runtimeMarker = 'live2dcubismcore.min.js';
  const bundleMarker = '<script src="./bootstrap.js"></script>';
  const cspMarker = 'Content-Security-Policy';

  assert.notStrictEqual(
    html.indexOf(runtimeMarker),
    -1,
    'index.html should load the Cubism runtime before starting the renderer',
  );
  assert.notStrictEqual(
    html.indexOf(bundleMarker),
    -1,
    'index.html should bootstrap the CommonJS renderer bundle with a local script',
  );
  assert.notStrictEqual(
    html.indexOf(cspMarker),
    -1,
    'index.html should declare a Content Security Policy',
  );
  assert.ok(
    html.indexOf(runtimeMarker) < html.indexOf(bundleMarker),
    'Cubism runtime must be loaded before the renderer bootstrap script',
  );
});
