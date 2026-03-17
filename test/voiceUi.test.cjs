const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('renderer shell exposes only the unified companion status panel in the pet window', () => {
  const htmlPath = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.doesNotMatch(html, /id="voice-status"/, 'index.html should no longer render a separate voice status panel');
  assert.match(html, /id="assistant-status"/, 'index.html should include a unified conversation status panel');
  assert.doesNotMatch(html, /id="task-status"/, 'pet window should not include a background task status panel');
  assert.doesNotMatch(html, /id="workspace-panel"/, 'pet window should not include a dedicated agent workspace panel');
});

test('styles keep the unified conversation status panel reactive without task chrome', () => {
  const cssPath = path.join(__dirname, '..', 'src', 'renderer', 'styles', 'main.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.match(css, /#assistant-status[\s\S]*opacity:\s*0/, 'conversation status panel should stay hidden until needed');
  assert.match(css, /#assistant-status\.is-visible[\s\S]*opacity:\s*1/, 'conversation status panel should reveal itself when feedback exists');
});
