const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('renderer shell exposes voice controls and transcript status', () => {
  const htmlPath = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.match(html, /id="voice-button"/, 'index.html should expose a speech-recognition button');
  assert.match(html, /id="voice-status"/, 'index.html should include a status panel for recognition feedback');
  assert.match(html, /id="voice-device-select"/, 'index.html should expose a microphone device selector');
});

test('styles include immersive voice button and speech status panel states', () => {
  const cssPath = path.join(__dirname, '..', 'src', 'renderer', 'styles', 'main.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.match(css, /#voice-button[\s\S]*width:\s*40px/, 'voice button should share the immersive compact chrome sizing');
  assert.match(css, /#voice-button\.is-listening[\s\S]*box-shadow/, 'voice button should visibly react while listening');
  assert.match(css, /#voice-status[\s\S]*opacity:\s*0/, 'voice status panel should stay hidden until needed');
  assert.match(css, /#voice-status\.is-visible[\s\S]*opacity:\s*1/, 'voice status panel should reveal itself when speech feedback exists');
});
