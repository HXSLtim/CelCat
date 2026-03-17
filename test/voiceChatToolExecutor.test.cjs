const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VoiceChatToolExecutor,
  parseVoiceChatToolCall,
} = require('../dist/main-process/realtime/voiceChatToolExecutor.js');
const { VolcengineVoiceChatProviderClient } = require('../dist/main-process/realtime/voiceChatProvider.js');

test('parseVoiceChatToolCall parses compatibility tool directives', () => {
  const parsed = parseVoiceChatToolCall('[[CELCAT_TOOL name=renameCompanion]]{"displayName":"小影"}');

  assert.deepEqual(parsed, {
    name: 'renameCompanion',
    arguments: {
      displayName: '小影',
    },
  });
});

test('VoiceChatToolExecutor maps rename and agent calls into orchestrator system APIs', async () => {
  const calls = [];
  let currentIdentity = { displayName: 'CelCat' };
  const executor = new VoiceChatToolExecutor({
    startAgentTaskFromSystem(input) {
      calls.push({ type: 'startAgentTask', input });
      return {
        relatedTask: { id: 'task-1' },
        events: [
          {
            type: 'assistant-message',
            text: '好的，我已经把这件事放到后台处理中。',
          },
        ],
      };
    },
    renameCompanionFromSystem(displayName) {
      calls.push({ type: 'renameCompanion', displayName });
      currentIdentity = { displayName };
      return {
        relatedTask: null,
        events: [
          {
            type: 'assistant-message',
            text: `记住啦，我以后就叫${displayName}。`,
          },
        ],
      };
    },
    getCompanionIdentity() {
      return currentIdentity;
    },
  });

  const renameResult = await executor.executeToolCallFromText(
    '[[CELCAT_TOOL name=renameCompanion]]{"displayName":"小影"}',
  );
  const browserResult = await executor.executeToolCallFromText(
    '[[CELCAT_TOOL name=openBrowser]]{"query":"CelCat agentic"}',
  );

  assert.equal(renameResult.syncCompanionIdentity, '小影');
  assert.equal(browserResult.relatedTaskId, 'task-1');
  assert.deepEqual(calls, [
    { type: 'renameCompanion', displayName: '小影' },
    {
      type: 'startAgentTask',
      input: {
        transcript: '打开浏览器并搜索 CelCat agentic',
        kind: 'tool',
      },
    },
  ]);
});

test('VolcengineVoiceChatProviderClient keeps compatibility tool calls intact in plain generateReply mode', async () => {
  const provider = new VolcengineVoiceChatProviderClient(
    {
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReply() {
        return '[[CELCAT_TOOL name=renameCompanion]]{"displayName":"小影"}';
      },
      async appendInputAudioFrame() {},
      async commitInputAudio() {},
      isEnabled() {
        return true;
      },
      setEventSink() {},
      async syncCompanionIdentity() {},
    },
    new VoiceChatToolExecutor({
      startAgentTaskFromSystem() {
        return null;
      },
      renameCompanionFromSystem(displayName) {
        return {
          relatedTask: null,
          events: [
            {
              type: 'assistant-message',
              text: `记住啦，我以后就叫${displayName}。`,
            },
          ],
        };
      },
      getCompanionIdentity() {
        return {
          displayName: '小影',
        };
      },
    }),
  );

  const reply = await provider.generateReply('用户说以后叫你小影');

  assert.equal(reply, '[[CELCAT_TOOL name=renameCompanion]]{"displayName":"小影"}');
});

test('VolcengineVoiceChatProviderClient exposes structured reply payloads for compatibility tool calls', async () => {
  const provider = new VolcengineVoiceChatProviderClient(
    {
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReply() {
        return '[[CELCAT_TOOL name=openBrowser]]{"query":"CelCat"}';
      },
      async appendInputAudioFrame() {},
      async commitInputAudio() {},
      isEnabled() {
        return true;
      },
      setEventSink() {},
      async syncCompanionIdentity() {},
    },
    new VoiceChatToolExecutor({
      startAgentTaskFromSystem() {
        return {
          relatedTask: { id: 'task-1' },
          events: [],
        };
      },
      renameCompanionFromSystem() {
        return null;
      },
      getCompanionIdentity() {
        return {
          displayName: 'CelCat',
        };
      },
    }),
  );

  const payload = await provider.generateReplyPayload('帮我打开浏览器');

  assert.equal(payload.message, null);
  assert.deepEqual(payload.toolCall, {
    name: 'openBrowser',
    arguments: {
      query: 'CelCat',
    },
    rawText: '[[CELCAT_TOOL name=openBrowser]]{"query":"CelCat"}',
  });
});

test('VolcengineVoiceChatProviderClient does not sync identity inside executeToolCall', async () => {
  const calls = [];
  const provider = new VolcengineVoiceChatProviderClient(
    {
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReply() {
        return null;
      },
      async appendInputAudioFrame() {},
      async commitInputAudio() {},
      isEnabled() {
        return true;
      },
      setEventSink() {},
      async syncCompanionIdentity(identity) {
        calls.push(identity.displayName);
      },
    },
    new VoiceChatToolExecutor({
      startAgentTaskFromSystem() {
        return null;
      },
      renameCompanionFromSystem(displayName) {
        return {
          relatedTask: null,
          events: [
            {
              type: 'assistant-message',
              text: `记住啦，我以后就叫${displayName}。`,
            },
          ],
        };
      },
      getCompanionIdentity() {
        return {
          displayName: '小影',
        };
      },
    }),
  );

  const result = await provider.executeToolCall({
    name: 'renameCompanion',
    arguments: {
      displayName: '小影',
    },
  });

  assert.equal(result?.syncCompanionIdentity, '小影');
  assert.deepEqual(calls, []);
});
