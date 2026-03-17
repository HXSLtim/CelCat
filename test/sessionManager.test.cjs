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
      async generateReply() {
        return '来自实时模型的回复';
      },
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
