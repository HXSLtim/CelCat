const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('renderer shell exposes menu chrome and relies on direct long-press dragging', () => {
  const htmlPath = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.match(
    html,
    /id="menu-button"/,
    'index.html should include a menu button',
  );
  assert.match(
    html,
    /id="window-menu"/,
    'index.html should include a menu container',
  );
  assert.match(
    html,
    /id="live2d-canvas"/,
    'pet window should keep the Live2D canvas as the main interaction surface',
  );
  assert.match(
    html,
    /aria-label="打开窗口菜单"/,
    'menu button aria-label should be localized to Chinese',
  );
  assert.doesNotMatch(
    html,
    /id="drag-button"/,
    'pet window should no longer render a dedicated drag button',
  );
});

test('styles keep the menu clickable without a dedicated drag button', () => {
  const cssPath = path.join(__dirname, '..', 'src', 'renderer', 'styles', 'main.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.match(
    css,
    /#window-chrome[\s\S]*opacity:\s*0/,
    'window chrome should start hidden until the user hovers the window',
  );
  assert.match(
    css,
    /\.chrome-visible[\s\S]*opacity:\s*1/,
    'window chrome should become visible when the hover state is active',
  );
  assert.match(
    css,
    /#window-chrome::before[\s\S]*linear-gradient/,
    'window chrome should include a subtle atmospheric veil for immersion',
  );
  assert.match(
    css,
    /#menu-button[\s\S]*width:\s*40px/,
    'menu button should use a smaller footprint',
  );
  assert.match(
    css,
    /#menu-button[\s\S]*-webkit-app-region:\s*no-drag/,
    'menu button must stay clickable',
  );
  assert.match(
    css,
    /#window-menu[\s\S]*-webkit-app-region:\s*no-drag/,
    'menu panel must stay clickable',
  );
  assert.doesNotMatch(
    css,
    /#drag-button/,
    'renderer styles should no longer define a dedicated drag button',
  );
});
