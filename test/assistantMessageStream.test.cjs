const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mergeAssistantMessages,
  shouldContinueAssistantStream,
} = require('../dist/renderer/assistantMessageStream.js');

test('mergeAssistantMessages prefers the longer replacement when the next chunk contains the current text', () => {
  assert.equal(
    mergeAssistantMessages('你好', '你好呀，今天过得怎么样？'),
    '你好呀，今天过得怎么样？',
  );
});

test('mergeAssistantMessages appends only the non-overlapping suffix for streaming chunks', () => {
  assert.equal(
    mergeAssistantMessages('你好呀，今天', '今天过得怎么样？'),
    '你好呀，今天过得怎么样？',
  );
});

test('shouldContinueAssistantStream only keeps buffering within a short gap', () => {
  assert.equal(shouldContinueAssistantStream(1000, 1800, '你好'), true);
  assert.equal(shouldContinueAssistantStream(1000, 2501, '你好'), false);
  assert.equal(shouldContinueAssistantStream(1000, 1800, ''), false);
});
