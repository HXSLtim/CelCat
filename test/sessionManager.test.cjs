const test = require('node:test');
const assert = require('node:assert/strict');

const { SessionManager } = require('../dist/main-process/realtime/sessionManager.js');

test('SessionManager emits transcript and assistant events during audio submission', async () => {
  const emittedEvents = [];
  const sessionManager = new SessionManager({
    transcribeAudio: async () => ({ text: '你好' }),
    orchestrator: {
      async handleTranscript(transcript) {
        return {
          relatedTask: null,
          events: [
            {
              type: 'assistant-message',
              text: `收到：${transcript}`,
            },
          ],
        };
      },
    },
    companionProvider: {
      setEventSink() {},
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReply() {
        return null;
      },
      async syncCompanionIdentity() {},
      isEnabled() {
        return false;
      },
    },
    emitEvent(event) {
      emittedEvents.push(event);
    },
  });

  await sessionManager.startSession();
  await sessionManager.submitUserAudio({
    audioBuffer: new ArrayBuffer(8),
    mimeType: 'audio/webm',
  });

  assert.equal(emittedEvents.some((event) => event.type === 'transcript'), true);
  assert.equal(emittedEvents.some((event) => event.type === 'assistant-message'), true);
  assert.equal(sessionManager.getSnapshot().status, 'listening');
});

test('SessionManager uses the companion provider for lightweight conversation turns', async () => {
  const emittedEvents = [];
  const sessionManager = new SessionManager({
    transcribeAudio: async () => ({ text: '陪我聊聊' }),
    orchestrator: {
      async handleTranscript(transcript) {
        return {
          relatedTask: null,
          companionRequest: {
            prompt: transcript,
            fallbackText: '本地回退回复',
          },
          events: [],
        };
      },
    },
    companionProvider: {
      setEventSink() {},
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReplyPayload() {
        return {
          message: '来自实时模型的回复',
          toolCall: null,
        };
      },
      async generateReply() {
        return '来自实时模型的回复';
      },
      async syncCompanionIdentity() {},
      isEnabled() {
        return true;
      },
    },
    emitEvent(event) {
      emittedEvents.push(event);
    },
  });

  await sessionManager.startSession();
  await sessionManager.submitUserAudio({
    audioBuffer: new ArrayBuffer(8),
    mimeType: 'audio/webm',
  });

  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && event.text === '来自实时模型的回复'),
    true,
  );
});

test('SessionManager executes structured provider tool calls returned by generateReplyPayload', async () => {
  const emittedEvents = [];
  const sessionManager = new SessionManager({
    transcribeAudio: async () => ({ text: '帮我打开浏览器' }),
    orchestrator: {
      async handleTranscript(transcript) {
        return {
          relatedTask: null,
          companionRequest: {
            prompt: transcript,
            fallbackText: '本地回退回复',
          },
          events: [],
        };
      },
    },
    companionProvider: {
      setEventSink() {},
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReplyPayload() {
        return {
          message: null,
          toolCall: {
            name: 'openBrowser',
            arguments: {
              query: 'CelCat',
            },
          },
        };
      },
      async generateReply() {
        return null;
      },
      async executeToolCall(toolCall) {
        return {
          toolName: toolCall.name,
          assistantMessage: '好的，我已经把打开浏览器交给后台 agent 了。',
          relatedTaskId: 'task-browser',
          syncCompanionIdentity: null,
        };
      },
      async syncCompanionIdentity() {},
      isEnabled() {
        return true;
      },
    },
    emitEvent(event) {
      emittedEvents.push(event);
    },
  });

  await sessionManager.startSession();
  await sessionManager.submitUserAudio({
    audioBuffer: new ArrayBuffer(8),
    mimeType: 'audio/webm',
  });

  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && event.text === '好的，我已经把打开浏览器交给后台 agent 了。'),
    true,
  );
  assert.equal(sessionManager.getSnapshot().activeTaskId, 'task-browser');
});

test('SessionManager routes companion handoff directives into agent task events instead of surfacing raw tokens', async () => {
  const emittedEvents = [];
  const sessionManager = new SessionManager({
    transcribeAudio: async () => ({ text: '帮我搜一下最新的桌宠设计趋势' }),
    orchestrator: {
      async handleTranscript(transcript) {
        return {
          relatedTask: null,
          companionRequest: {
            prompt: transcript,
            fallbackText: '本地回退回复',
          },
          events: [],
        };
      },
      resolveCompanionReply(transcript, reply) {
        if (reply.startsWith('[[CELCAT_AGENT kind=tool]]')) {
          return {
            relatedTask: { id: 'task-1' },
            companionRequest: null,
            events: [
              {
                type: 'assistant-message',
                text: `已转交后台 agent：${transcript}`,
                relatedTaskId: 'task-1',
              },
            ],
          };
        }
        return null;
      },
    },
    companionProvider: {
      setEventSink() {},
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReply() {
        return '[[CELCAT_AGENT kind=tool]]帮用户搜索并整理最新的桌宠设计趋势';
      },
      async syncCompanionIdentity() {},
      isEnabled() {
        return true;
      },
    },
    emitEvent(event) {
      emittedEvents.push(event);
    },
  });

  await sessionManager.startSession();
  await sessionManager.submitUserAudio({
    audioBuffer: new ArrayBuffer(8),
    mimeType: 'audio/webm',
  });

  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && event.text === '已转交后台 agent：帮我搜一下最新的桌宠设计趋势'),
    true,
  );
  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && /\[\[CELCAT_AGENT/.test(event.text)),
    false,
  );
  assert.equal(sessionManager.getSnapshot().activeTaskId, 'task-1');
});

test('SessionManager syncs the current companion identity into the realtime provider before starting', async () => {
  let syncedName = null;

  const sessionManager = new SessionManager({
    transcribeAudio: async () => ({ text: '你好' }),
    orchestrator: {
      async handleTranscript() {
        return {
          relatedTask: null,
          companionRequest: null,
          events: [],
        };
      },
      getCompanionIdentity() {
        return {
          displayName: '小影',
        };
      },
    },
    companionProvider: {
      setEventSink() {},
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReply() {
        return null;
      },
      async syncCompanionIdentity(identity) {
        syncedName = identity.displayName;
      },
      isEnabled() {
        return true;
      },
    },
    emitEvent() {},
  });

  await sessionManager.startSession();

  assert.equal(syncedName, '小影');
});

test('SessionManager defers local rename identity sync until after the rename message is emitted', async () => {
  const callOrder = [];
  let currentIdentity = {
    displayName: 'CelCat',
  };

  const sessionManager = new SessionManager({
    transcribeAudio: async () => ({ text: '以后叫你小影' }),
    orchestrator: {
      async handleTranscript() {
        currentIdentity = {
          displayName: '小影',
        };
        return {
          relatedTask: null,
          companionRequest: null,
          events: [
            {
              type: 'assistant-message',
              text: '记住啦，我以后就叫小影。',
            },
          ],
        };
      },
      getCompanionIdentity() {
        return currentIdentity;
      },
    },
    companionProvider: {
      setEventSink() {},
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReply() {
        return null;
      },
      async syncCompanionIdentity(identity) {
        callOrder.push(`sync:${identity.displayName}`);
      },
      isEnabled() {
        return true;
      },
    },
    estimateSpeechDelayMs() {
      return 0;
    },
    emitEvent(event) {
      if (event.type === 'assistant-message') {
        callOrder.push(`emit:${event.text}`);
      }
    },
  });

  await sessionManager.startSession();
  callOrder.length = 0;

  await sessionManager.submitUserTranscript('以后叫你小影');
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.deepEqual(callOrder, [
    'emit:记住啦，我以后就叫小影。',
    'sync:小影',
  ]);
});

test('SessionManager falls back to the local companion reply when realtime provider reply fails', async () => {
  const emittedEvents = [];
  const sessionManager = new SessionManager({
    transcribeAudio: async () => ({ text: '陪我聊聊' }),
    orchestrator: {
      async handleTranscript(transcript) {
        return {
          relatedTask: null,
          companionRequest: {
            prompt: transcript,
            fallbackText: '本地回退回复',
          },
          events: [],
        };
      },
    },
    companionProvider: {
      setEventSink() {},
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReply() {
        throw new Error('provider timeout');
      },
      async syncCompanionIdentity() {},
      isEnabled() {
        return true;
      },
    },
    emitEvent(event) {
      emittedEvents.push(event);
    },
  });

  await sessionManager.startSession();
  await sessionManager.submitUserAudio({
    audioBuffer: new ArrayBuffer(8),
    mimeType: 'audio/webm',
  });

  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && event.text === '本地回退回复'),
    true,
  );
});

test('SessionManager forwards provider events into the session event stream', async () => {
  const emittedEvents = [];
  let eventSink = null;

  const sessionManager = new SessionManager({
    transcribeAudio: async () => ({ text: '你好' }),
    orchestrator: {
      async handleTranscript() {
        return {
          relatedTask: null,
          companionRequest: null,
          events: [],
        };
      },
    },
    companionProvider: {
      setEventSink(listener) {
        eventSink = listener;
      },
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReply() {
        return null;
      },
      async syncCompanionIdentity() {},
      async appendInputAudioFrame() {},
      async commitInputAudio() {},
      isEnabled() {
        return true;
      },
    },
    emitEvent(event) {
      emittedEvents.push(event);
    },
  });

  await sessionManager.startSession();
  eventSink({ type: 'assistant-message', text: '来自 provider 的回复' });
  eventSink({
    type: 'assistant-audio',
    pcmBase64: 'AQI=',
    sampleRate: 24000,
    channels: 1,
    format: 'pcm_s16le',
  });

  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && event.text === '来自 provider 的回复'),
    true,
  );
  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-audio' && event.format === 'pcm_s16le'),
    true,
  );
});

test('SessionManager keeps speaking state during partial provider assistant text and settles on final text', async () => {
  const emittedEvents = [];
  let eventSink = null;

  const sessionManager = new SessionManager({
    transcribeAudio: async () => ({ text: '你好' }),
    orchestrator: {
      async handleTranscript() {
        return {
          relatedTask: null,
          companionRequest: null,
          events: [],
        };
      },
    },
    companionProvider: {
      setEventSink(listener) {
        eventSink = listener;
      },
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReply() {
        return null;
      },
      async syncCompanionIdentity() {},
      async appendInputAudioFrame() {},
      async commitInputAudio() {},
      isEnabled() {
        return true;
      },
    },
    emitEvent(event) {
      emittedEvents.push(event);
    },
  });

  await sessionManager.startSession();
  eventSink({ type: 'assistant-message', text: '我生气', isFinal: false });
  assert.equal(sessionManager.getSnapshot().status, 'speaking');

  eventSink({ type: 'assistant-message', text: '我生气起来可是很吓人的！哼！', isFinal: true });
  assert.equal(sessionManager.getSnapshot().status, 'listening');
  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && event.text === '我生气' && event.isFinal === false),
    true,
  );
  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && event.text === '我生气起来可是很吓人的！哼！' && event.isFinal === true),
    true,
  );
});

test('SessionManager stays in browser-only mode when realtime provider is disabled', async () => {
  let forwardedAudioFrames = 0;
  let committedAudioBuffers = 0;

  const sessionManager = new SessionManager({
    transcribeAudio: async () => ({ text: '你好' }),
    orchestrator: {
      async handleTranscript() {
        return {
          relatedTask: null,
          companionRequest: null,
          events: [],
        };
      },
    },
    companionProvider: {
      setEventSink() {},
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReply() {
        return null;
      },
      async syncCompanionIdentity() {},
      async appendInputAudioFrame() {
        forwardedAudioFrames += 1;
      },
      async commitInputAudio() {
        committedAudioBuffers += 1;
      },
      isEnabled() {
        return false;
      },
    },
    emitEvent() {},
  });

  const snapshot = await sessionManager.startSession();
  await sessionManager.appendInputAudioFrame({
    pcmBase64: 'abc',
    sampleRate: 16000,
    channels: 1,
  });
  await sessionManager.commitInputAudio();

  assert.equal(snapshot.connected, false);
  assert.equal(snapshot.status, 'listening');
  assert.equal(forwardedAudioFrames, 0);
  assert.equal(committedAudioBuffers, 0);
});

test('SessionManager intercepts provider transcripts when local orchestrator takes over realtime control intents', async () => {
  const emittedEvents = [];
  let eventSink = null;

  const sessionManager = new SessionManager({
    transcribeAudio: async () => ({ text: '你好' }),
    orchestrator: {
      async handleTranscript() {
        return {
          relatedTask: null,
          companionRequest: null,
          events: [],
        };
      },
      async handleRealtimeProviderTranscript(transcript) {
        if (transcript === '帮我打开浏览器') {
          return {
            relatedTask: { id: 'task-browser' },
            companionRequest: null,
            events: [
              {
                type: 'assistant-message',
                text: '好的，我已经把这件事交给后台 agent 处理了。',
                relatedTaskId: 'task-browser',
              },
            ],
          };
        }
        return null;
      },
      getCompanionIdentity() {
        return {
          displayName: 'CelCat',
        };
      },
    },
    companionProvider: {
      setEventSink(listener) {
        eventSink = listener;
      },
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReply() {
        return null;
      },
      async syncCompanionIdentity() {},
      async appendInputAudioFrame() {},
      async commitInputAudio() {},
      isEnabled() {
        return true;
      },
    },
    emitEvent(event) {
      emittedEvents.push(event);
    },
  });

  await sessionManager.startSession();
  eventSink({ type: 'transcript', text: '帮我打开浏览器' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  eventSink({ type: 'assistant-message', text: '不好意思啊，我还不会打开浏览器呢。', isFinal: true });

  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && event.text === '好的，我已经把这件事交给后台 agent 处理了。'),
    true,
  );
  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && /不会打开浏览器/.test(event.text)),
    false,
  );
  assert.equal(sessionManager.getSnapshot().activeTaskId, 'task-browser');
});

test('SessionManager executes realtime provider tool-call events through the companion provider', async () => {
  const emittedEvents = [];
  let eventSink = null;

  const sessionManager = new SessionManager({
    transcribeAudio: async () => ({ text: '你好' }),
    orchestrator: {
      async handleTranscript() {
        return {
          relatedTask: null,
          companionRequest: null,
          events: [],
        };
      },
    },
    companionProvider: {
      setEventSink(listener) {
        eventSink = listener;
      },
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReply() {
        return null;
      },
      async executeToolCall(toolCall) {
        return {
          toolName: toolCall.name,
          assistantMessage: '记住啦，我以后就叫小影。',
          relatedTaskId: null,
          syncCompanionIdentity: '小影',
        };
      },
      async syncCompanionIdentity() {},
      async appendInputAudioFrame() {},
      async commitInputAudio() {},
      isEnabled() {
        return true;
      },
    },
    emitEvent(event) {
      emittedEvents.push(event);
    },
  });

  await sessionManager.startSession();
  eventSink({
    type: 'tool-call',
    toolName: 'renameCompanion',
    arguments: {
      displayName: '小影',
    },
    rawText: '[[CELCAT_TOOL name=renameCompanion]]{"displayName":"小影"}',
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && event.text === '记住啦，我以后就叫小影。'),
    true,
  );
});

test('SessionManager defers provider tool-call rename sync until after the assistant message is emitted', async () => {
  const callOrder = [];
  let eventSink = null;

  const sessionManager = new SessionManager({
    transcribeAudio: async () => ({ text: '你好' }),
    orchestrator: {
      async handleTranscript() {
        return {
          relatedTask: null,
          companionRequest: null,
          events: [],
        };
      },
    },
    companionProvider: {
      setEventSink(listener) {
        eventSink = listener;
      },
      async connect() {},
      async disconnect() {},
      async startSession() {},
      async generateReply() {
        return null;
      },
      async executeToolCall(toolCall) {
        return {
          toolName: toolCall.name,
          assistantMessage: '记住啦，我以后就叫小影。',
          relatedTaskId: null,
          syncCompanionIdentity: '小影',
        };
      },
      async syncCompanionIdentity(identity) {
        callOrder.push(`sync:${identity.displayName}`);
      },
      async appendInputAudioFrame() {},
      async commitInputAudio() {},
      isEnabled() {
        return true;
      },
    },
    estimateSpeechDelayMs() {
      return 0;
    },
    emitEvent(event) {
      if (event.type === 'assistant-message') {
        callOrder.push(`emit:${event.text}`);
      }
    },
  });

  await sessionManager.startSession();
  callOrder.length = 0;

  eventSink({
    type: 'tool-call',
    toolName: 'renameCompanion',
    arguments: {
      displayName: '小影',
    },
    rawText: '[[CELCAT_TOOL name=renameCompanion]]{"displayName":"小影"}',
  });
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.deepEqual(callOrder, [
    'emit:记住啦，我以后就叫小影。',
    'sync:小影',
  ]);
});
