const test = require('node:test');
const assert = require('node:assert/strict');

const {
  inferAssistantExpression,
  inferAssistantExpressionDetail,
} = require('../dist/renderer/assistantExpression.js');

test('inferAssistantExpression maps excited replies to the excited expression', () => {
  assert.equal(inferAssistantExpression('太好了！这次真的成功啦！'), 'excited');
});

test('inferAssistantExpression maps question-heavy replies to the confused expression', () => {
  assert.equal(inferAssistantExpression('你是说什么情况呀？我有点没明白。'), 'confused');
});

test('inferAssistantExpression maps gentle embarrassed replies to the shy expression', () => {
  assert.equal(inferAssistantExpression('嘿嘿，有点不好意思被你发现了。'), 'shy');
});

test('inferAssistantExpression falls back to a friendly happy expression', () => {
  assert.equal(inferAssistantExpression('好的，我会继续陪着你。'), 'happy');
});

test('inferAssistantExpressionDetail reports angry cues and a non-trivial confidence', () => {
  const inference = inferAssistantExpressionDetail('我生气起来可是很吓人的！哼！');

  assert.equal(inference.name, 'angry');
  assert.equal(inference.matchedCues.includes('explicit-angry') || inference.matchedCues.includes('angry-phrase'), true);
  assert.equal(inference.confidence >= 0.5, true);
});
