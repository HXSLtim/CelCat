const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VolcengineRealtimeProviderClient,
  buildLifecycleStartSessionPayload,
  buildVoiceChatShimSystemRole,
  buildVolcengineRealtimeHeaders,
  readVolcengineRealtimeConfig,
} = require('../dist/main-process/realtime/providerClient.js');
const {
  buildChatTextQueryFrame,
  buildFinishVoiceChatShimFrame,
  getRealtimeSessionLifecycle,
  buildSayHelloFrame,
  buildStartConnectionFrame,
  buildStartSessionFrame,
  buildStartVoiceChatShimFrame,
  buildTaskRequestFrame,
  parseRealtimeResponse,
} = require('../dist/main-process/realtime/protocol.js');

test('readVolcengineRealtimeConfig applies the expected defaults', () => {
  const config = readVolcengineRealtimeConfig({});

  assert.equal(config.address, 'wss://openspeech.bytedance.com');
  assert.equal(config.uri, '/api/v3/realtime/dialogue');
  assert.equal(config.resourceId, 'volc.speech.dialog');
  assert.equal(config.ttsFormat, 'pcm_s16le');
  assert.equal(config.ttsSampleRate, 24000);
});

test('VolcengineRealtimeProviderClient stays inert when realtime mode is not enabled', async () => {
  const client = new VolcengineRealtimeProviderClient({
    enabled: false,
    address: 'wss://openspeech.bytedance.com',
    uri: '/api/v3/realtime/dialogue',
    appId: '',
    appKey: '',
    accessToken: '',
    resourceId: 'volc.speech.dialog',
    uid: 'celcat-test',
    botName: '豆包',
    headersJson: '',
  });

  assert.equal(client.isEnabled(), false);
  await client.connect();
  await client.startSession();
  assert.equal(await client.generateReply('你好'), null);
});

test('buildVolcengineRealtimeHeaders includes required handshake headers', () => {
  const headers = buildVolcengineRealtimeHeaders({
    enabled: true,
    address: 'wss://openspeech.bytedance.com',
    uri: '/api/v3/realtime/dialogue',
    appId: 'app-id',
    appKey: 'app-key',
    accessToken: 'access-token',
    resourceId: 'volc.speech.dialog',
    uid: 'celcat-test',
    botName: '豆包',
    headersJson: '',
    appendEventName: 'input_audio_buffer.append',
    commitEventName: 'input_audio_buffer.commit',
  }, 'connect-id');

  assert.deepEqual(headers, {
    'X-Api-App-ID': 'app-id',
    'X-Api-App-Key': 'app-key',
    'X-Api-Access-Key': 'access-token',
    'X-Api-Resource-Id': 'volc.speech.dialog',
    'X-Api-Connect-Id': 'connect-id',
  });
});

test('protocol helpers build and parse binary realtime frames', () => {
  const startConnectionFrame = buildStartConnectionFrame();
  assert.equal(Buffer.isBuffer(startConnectionFrame), true);

  const sessionFrame = buildStartSessionFrame('session-1', {
    dialog: { bot_name: '豆包' },
  });
  assert.equal(Buffer.isBuffer(sessionFrame), true);

  const textFrame = buildChatTextQueryFrame('session-1', '你好');
  assert.equal(Buffer.isBuffer(textFrame), true);

  const helloFrame = buildSayHelloFrame('session-1', '你好');
  assert.equal(Buffer.isBuffer(helloFrame), true);

  const audioFrame = buildTaskRequestFrame('session-1', Buffer.from([1, 2, 3]));
  assert.equal(Buffer.isBuffer(audioFrame), true);

  const payload = Buffer.from(JSON.stringify({ text: 'hello' }), 'utf8');
  const compressed = require('node:zlib').gzipSync(payload);
  const serverFrame = Buffer.concat([
    Buffer.from([0x11, 0x94, 0x11, 0x00]),
    Buffer.from([0x00, 0x00, 0x01, 0xf5]),
    Buffer.from([0x00, 0x00, 0x00, 0x09]),
    Buffer.from('session-1', 'utf8'),
    Buffer.from([0x00, 0x00, 0x00, compressed.length]),
    compressed,
  ]);

  const parsed = parseRealtimeResponse(serverFrame);
  assert.equal(parsed.messageType, 'SERVER_FULL_RESPONSE');
  assert.equal(parsed.event, 501);
  assert.deepEqual(parsed.payload, { text: 'hello' });
});

test('realtime session lifecycle exposes a voiceChat shim strategy without changing frame compatibility yet', () => {
  const lifecycle = getRealtimeSessionLifecycle('voiceChatShim');

  assert.equal(lifecycle.protocolFamily, 'dialogue-websocket');
  assert.equal(lifecycle.startEventLabel, 'StartVoiceChat');
  assert.equal(lifecycle.finishEventLabel, 'FinishVoiceChat');
  assert.equal(lifecycle.buildStartFrame, buildStartVoiceChatShimFrame);
  assert.equal(lifecycle.buildFinishFrame, buildFinishVoiceChatShimFrame);
  assert.equal(Buffer.isBuffer(lifecycle.buildStartFrame('session-1', { dialog: { bot_name: '豆包' } })), true);
});

test('realtime session lifecycle exposes a native voiceChat strategy placeholder', () => {
  const lifecycle = getRealtimeSessionLifecycle('voiceChatNative');

  assert.equal(lifecycle.protocolFamily, 'native-voicechat-openapi');
  assert.equal(lifecycle.startEventLabel, 'StartVoiceChat');
  assert.equal(lifecycle.finishEventLabel, 'FinishVoiceChat');
  assert.throws(
    () => lifecycle.buildStartFrame('session-1', { session: { botName: '豆包' } }),
    /Native StartVoiceChat frame builder is not implemented yet/,
  );
});

test('buildLifecycleStartSessionPayload keeps dialogue mode on the legacy session schema', () => {
  const payload = buildLifecycleStartSessionPayload({
    lifecycleMode: 'dialogue',
    config: {
      enabled: true,
      address: 'wss://openspeech.bytedance.com',
      uri: '/api/v3/realtime/dialogue',
      appId: 'app-id',
      appKey: 'app-key',
      accessToken: 'access-token',
      resourceId: 'volc.speech.dialog',
      uid: 'celcat-test',
      botName: '豆包',
      headersJson: '',
      appendEventName: 'input_audio_buffer.append',
      commitEventName: 'input_audio_buffer.commit',
      systemRole: '你是测试助手。',
      speakingStyle: '简洁',
      speaker: 'speaker',
      ttsFormat: 'pcm_s16le',
      ttsSampleRate: 24000,
    },
  });

  assert.equal(payload.dialog.bot_name, '豆包');
  assert.match(payload.dialog.system_role, /你是测试助手/);
  assert.equal(payload.dialog.extra.input_mod, 'audio');
});

test('buildLifecycleStartSessionPayload folds voiceChat blueprint context into the dialogue-compatible shim payload', () => {
  const payload = buildLifecycleStartSessionPayload({
    lifecycleMode: 'voiceChatShim',
    config: {
      enabled: true,
      address: 'wss://openspeech.bytedance.com',
      uri: '/api/v3/realtime/dialogue',
      appId: 'app-id',
      appKey: 'app-key',
      accessToken: 'access-token',
      resourceId: 'volc.speech.dialog',
      uid: 'celcat-test',
      botName: '小影',
      headersJson: '',
      appendEventName: 'input_audio_buffer.append',
      commitEventName: 'input_audio_buffer.commit',
      systemRole: '你是一个温柔的中文桌宠。',
      speakingStyle: '简洁',
      speaker: 'speaker',
      ttsFormat: 'pcm_s16le',
      ttsSampleRate: 24000,
    },
    botNameOverride: '豆包',
    voiceChatStartConfig: {
      systemMessages: ['你现在对用户自称“豆包”。', '优先用 Function Calling 处理执行型任务。'],
      functions: [
        {
          name: 'openBrowser',
          description: '打开浏览器并访问目标网页',
          inputSchema: { type: 'object' },
        },
      ],
      mcps: [
        {
          id: 'playwright',
          label: 'Playwright',
          description: '浏览器自动化',
        },
      ],
      memory: {
        stablePreferences: ['偏好中文、直接执行。'],
        relevantMemories: ['用户经常要求打开浏览器。'],
        longTermMemories: [],
      },
      activeTaskSummary: '打开浏览器：处理中',
    },
  });

  assert.equal(payload.dialog.bot_name, '豆包');
  assert.equal(payload.dialog.extra.compatibility_mode, 'voiceChatShim');
  assert.deepEqual(payload.dialog.extra.celcat_voice_chat.function_names, ['openBrowser']);
  assert.deepEqual(payload.dialog.extra.celcat_voice_chat.mcp_ids, ['playwright']);
  assert.match(payload.dialog.system_role, /Function Calling/);
  assert.match(payload.dialog.system_role, /openBrowser/);
  assert.match(payload.dialog.system_role, /Playwright/);
  assert.match(payload.dialog.system_role, /偏好中文、直接执行/);
  assert.match(payload.dialog.system_role, /打开浏览器：处理中/);
  assert.match(payload.dialog.system_role, /\[\[CELCAT_TOOL name=/);
  assert.match(payload.dialog.system_role, /不要口头拒绝/);
});

test('buildVoiceChatShimSystemRole preserves the active display name in shim mode', () => {
  const systemRole = buildVoiceChatShimSystemRole({
    config: {
      enabled: true,
      address: 'wss://openspeech.bytedance.com',
      uri: '/api/v3/realtime/dialogue',
      appId: 'app-id',
      appKey: 'app-key',
      accessToken: 'access-token',
      resourceId: 'volc.speech.dialog',
      uid: 'celcat-test',
      botName: '小影',
      headersJson: '',
      appendEventName: 'input_audio_buffer.append',
      commitEventName: 'input_audio_buffer.commit',
      systemRole: '你是一个温柔的中文桌宠。',
      speakingStyle: '简洁',
      speaker: 'speaker',
      ttsFormat: 'pcm_s16le',
      ttsSampleRate: 24000,
    },
    botName: '豆包',
    voiceChatStartConfig: {
      systemMessages: [],
      functions: [],
      mcps: [],
      memory: {
        stablePreferences: [],
        relevantMemories: [],
        longTermMemories: [],
      },
      activeTaskSummary: null,
    },
  });

  assert.match(systemRole, /你的当前名字是“豆包”/);
});

test('buildLifecycleStartSessionPayload exposes a native StartVoiceChat payload placeholder', () => {
  const payload = buildLifecycleStartSessionPayload({
    lifecycleMode: 'voiceChatNative',
    config: {
      enabled: true,
      address: 'wss://openspeech.bytedance.com',
      uri: '/api/v3/realtime/dialogue',
      appId: 'app-id',
      appKey: 'app-key',
      accessToken: 'access-token',
      resourceId: 'volc.speech.dialog',
      uid: 'celcat-test',
      botName: '豆包',
      headersJson: '',
      appendEventName: 'input_audio_buffer.append',
      commitEventName: 'input_audio_buffer.commit',
      systemRole: '你是一个温柔的中文桌宠。',
      speakingStyle: '简洁',
      speaker: 'speaker',
      ttsFormat: 'pcm_s16le',
      ttsSampleRate: 24000,
    },
    voiceChatStartConfig: {
      systemMessages: ['你现在对用户自称“豆包”。'],
      functions: [{
        name: 'openBrowser',
        description: '打开浏览器',
        inputSchema: { type: 'object' },
      }],
      mcps: [{
        id: 'playwright',
        label: 'Playwright',
        description: '浏览器自动化',
      }],
      memory: {
        stablePreferences: ['偏好中文、直接执行。'],
        relevantMemories: [],
        longTermMemories: [],
      },
      activeTaskSummary: '后台工具任务：处理中',
    },
  });

  assert.equal(payload.transport.mode, 'voiceChatNative');
  assert.equal(payload.session.startEvent, 'StartVoiceChat');
  assert.equal(payload.llm.tools[0].name, 'openBrowser');
  assert.equal(payload.llm.mcps[0].id, 'playwright');
  assert.equal(payload.memory.stablePreferences[0], '偏好中文、直接执行。');
});

test('VolcengineRealtimeProviderClient concatenates assistant text deltas instead of replacing them', () => {
  const emittedEvents = [];
  const client = new VolcengineRealtimeProviderClient({
    enabled: true,
    address: 'wss://openspeech.bytedance.com',
    uri: '/api/v3/realtime/dialogue',
    appId: 'app-id',
    appKey: 'app-key',
    accessToken: 'access-token',
    resourceId: 'volc.speech.dialog',
    uid: 'celcat-test',
    botName: '豆包',
    headersJson: '',
    appendEventName: 'input_audio_buffer.append',
    commitEventName: 'input_audio_buffer.commit',
    systemRole: 'test',
    speakingStyle: 'test',
    speaker: 'speaker',
    ttsFormat: 'pcm_s16le',
    ttsSampleRate: 24000,
  });

  client.setEventSink((event) => {
    emittedEvents.push(event);
  });

  client.bufferAssistantText('你', false);
  client.bufferAssistantText('好', false);
  client.bufferAssistantText('！', true);

  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && event.text === '你好！'),
    true,
  );
  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && event.text === '你好' && event.isFinal === false),
    true,
  );
  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && event.text === '你好！' && event.isFinal === true),
    true,
  );
});

test('VolcengineRealtimeProviderClient merges punctuation-only tails into the previous final assistant text', () => {
  const emittedEvents = [];
  const client = new VolcengineRealtimeProviderClient({
    enabled: true,
    address: 'wss://openspeech.bytedance.com',
    uri: '/api/v3/realtime/dialogue',
    appId: 'app-id',
    appKey: 'app-key',
    accessToken: 'access-token',
    resourceId: 'volc.speech.dialog',
    uid: 'celcat-test',
    botName: '豆包',
    headersJson: '',
    appendEventName: 'input_audio_buffer.append',
    commitEventName: 'input_audio_buffer.commit',
    systemRole: 'test',
    speakingStyle: 'test',
    speaker: 'speaker',
    ttsFormat: 'pcm_s16le',
    ttsSampleRate: 24000,
  });

  client.setEventSink((event) => {
    emittedEvents.push(event);
  });

  client.bufferAssistantText('听起来你好像不太高兴，可以跟我说说发生什么了吗', true);
  client.bufferAssistantText('？', true);

  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && event.text === '听起来你好像不太高兴，可以跟我说说发生什么了吗？' && event.isFinal === true),
    true,
  );
  assert.equal(
    emittedEvents.some((event) => event.type === 'assistant-message' && event.text === '？'),
    false,
  );
});

test('VolcengineRealtimeProviderClient suppresses realtime assistant text before the microphone stream is ready', () => {
  const client = new VolcengineRealtimeProviderClient({
    enabled: true,
    address: 'wss://openspeech.bytedance.com',
    uri: '/api/v3/realtime/dialogue',
    appId: 'app-id',
    appKey: 'app-key',
    accessToken: 'access-token',
    resourceId: 'volc.speech.dialog',
    uid: 'celcat-test',
    botName: '豆包',
    headersJson: '',
    appendEventName: 'input_audio_buffer.append',
    commitEventName: 'input_audio_buffer.commit',
    systemRole: 'test',
    speakingStyle: 'test',
    speaker: 'speaker',
    ttsFormat: 'pcm_s16le',
    ttsSampleRate: 24000,
  });

  assert.equal(client.shouldEmitRealtimeAssistantText(550), false);
  client.inputAudioReady = true;
  assert.equal(client.shouldEmitRealtimeAssistantText(550), true);
});
