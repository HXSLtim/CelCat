const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEmotionParameterOffsets } = require('../dist/renderer/live2d/emotionMotion.js');

test('buildEmotionParameterOffsets adds lively facial cues for happy emotion', () => {
  const offsets = buildEmotionParameterOffsets('happy', 0.8, 320);
  const ids = offsets.map((offset) => offset.id);

  assert.equal(ids.includes('ParamCheek'), true);
  assert.equal(ids.includes('ParamEyeLSmile'), true);
  assert.equal(ids.includes('ParamMouthUp'), true);
});

test('buildEmotionParameterOffsets adds mouth and posture cues for angry emotion', () => {
  const offsets = buildEmotionParameterOffsets('angry', 0.9, 500);
  const ids = offsets.map((offset) => offset.id);

  assert.equal(ids.includes('ParamMouthAngry'), true);
  assert.equal(ids.includes('ParamMouthAngryLine'), true);
  assert.equal(ids.includes('ParamBodyAngleX'), true);
});
