const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('renderer shell relies on direct long-press dragging without visible chrome buttons', () => {
  const htmlPath = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.match(
    html,
    /id="live2d-canvas"/,
    'pet window should keep the Live2D canvas as the main interaction surface',
  );
  assert.match(
    html,
    /id="assistant-status"/,
    'pet window should keep the unified status surface',
  );
  assert.doesNotMatch(
    html,
    /id="menu-button"/,
    'pet window should no longer render a visible menu button',
  );
  assert.doesNotMatch(
    html,
    /id="window-menu"/,
    'pet window should no longer render an in-window menu panel',
  );
  assert.doesNotMatch(
    html,
    /id="drag-button"/,
    'pet window should no longer render a dedicated drag button',
  );
});

test('styles keep the pet window minimal while preserving the status surface', () => {
  const cssPath = path.join(__dirname, '..', 'src', 'renderer', 'styles', 'main.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.match(
    css,
    /#assistant-status[\s\S]*pointer-events:\s*none/,
    'status bubble should not interfere with direct manipulation of the pet window',
  );
  assert.match(
    css,
    /#live2d-canvas[\s\S]*-webkit-app-region:\s*no-drag/,
    'canvas should remain interactive while long-press drag is handled in the renderer logic',
  );
  assert.doesNotMatch(
    css,
    /#window-chrome/,
    'renderer styles should no longer define window chrome',
  );
  assert.doesNotMatch(
    css,
    /#menu-button/,
    'renderer styles should no longer define a menu button',
  );
  assert.doesNotMatch(
    css,
    /#window-menu/,
    'renderer styles should no longer define an in-window menu panel',
  );
  assert.doesNotMatch(
    css,
    /#drag-button/,
    'renderer styles should no longer define a dedicated drag button',
  );
});
