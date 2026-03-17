const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('renderer shell exposes a unified conversation status panel and task progress panel', () => {
  const htmlPath = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.doesNotMatch(html, /id="voice-status"/, 'index.html should no longer render a separate voice status panel');
  assert.match(html, /id="assistant-status"/, 'index.html should include a unified conversation status panel');
  assert.match(html, /id="task-status"/, 'index.html should include a background task status panel');
  assert.match(html, /id="workspace-panel"/, 'index.html should include a dedicated agent workspace panel');
});

test('styles keep the unified conversation and task status panels reactive without a microphone button', () => {
  const cssPath = path.join(__dirname, '..', 'src', 'renderer', 'styles', 'main.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.match(css, /#assistant-status[\s\S]*opacity:\s*0/, 'conversation status panel should stay hidden until needed');
  assert.match(css, /#assistant-status\.is-visible[\s\S]*opacity:\s*1/, 'conversation status panel should reveal itself when feedback exists');
  assert.match(css, /#task-status[\s\S]*bottom:\s*72px/, 'task status panel should stack above the conversation status');
  assert.match(css, /#workspace-panel[\s\S]*opacity:\s*0/, 'workspace panel should stay hidden until a task workspace is available');
});
