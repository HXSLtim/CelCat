const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('renderer shell includes visible drag and menu buttons', () => {
  const htmlPath = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.match(
    html,
    /id="drag-button"/,
    'index.html should include a visible drag button so the frameless window can be moved',
  );
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
    /class="[^"]*drag-icon[^"]*"/,
    'drag button should use an icon container',
  );
  assert.match(
    html,
    /aria-label="打开窗口菜单"/,
    'menu button aria-label should be localized to Chinese',
  );
  assert.doesNotMatch(
    html,
    /class="drag-label"/,
    'drag button should no longer render a persistent text label',
  );
});

test('styles keep the drag button interactive and menu clickable', () => {
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
    /#drag-button[\s\S]*cursor:\s*grab/,
    'drag button should advertise a draggable cursor',
  );
  assert.match(
    css,
    /#drag-button[\s\S]*width:\s*40px/,
    'drag button should use a smaller footprint',
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
});
