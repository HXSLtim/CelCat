const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readVolcengineVoiceChatTransportConfig,
  VolcengineVoiceChatTransportClient,
} = require('../dist/main-process/realtime/voiceChatTransportClient.js');

test('readVolcengineVoiceChatTransportConfig prefers dedicated voiceChat env vars', () => {
  const config = readVolcengineVoiceChatTransportConfig({
    VOLCENGINE_REALTIME_ENABLED: 'false',
    VOLCENGINE_REALTIME_ADDRESS: 'wss://legacy.example.com',
    VOLCENGINE_REALTIME_URI: '/legacy',
    VOLCENGINE_APP_ID: 'legacy-app',
    VOLCENGINE_ACCESS_KEY: 'legacy-key',
    VOLCENGINE_RESOURCE_ID: 'legacy-resource',
    VOLCENGINE_VOICECHAT_ENABLED: 'true',
    VOLCENGINE_VOICECHAT_ADDRESS: 'wss://voicechat.example.com',
    VOLCENGINE_VOICECHAT_URI: '/voicechat',
    VOLCENGINE_VOICECHAT_APP_ID: 'voicechat-app',
    VOLCENGINE_VOICECHAT_ACCESS_KEY: 'voicechat-key',
    VOLCENGINE_VOICECHAT_RESOURCE_ID: 'voicechat-resource',
    VOLCENGINE_VOICECHAT_START_EVENT: 'StartVoiceChat',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.address, 'wss://voicechat.example.com');
  assert.equal(config.uri, '/voicechat');
  assert.equal(config.appId, 'voicechat-app');
  assert.equal(config.accessToken, 'voicechat-key');
  assert.equal(config.resourceId, 'voicechat-resource');
  assert.equal(config.transportMode, 'shim');
  assert.equal(config.protocolFamily, 'dialogue-websocket');
  assert.equal(config.lifecycleMode, 'voiceChatShim');
  assert.equal(config.startEventName, 'StartVoiceChat');
  assert.equal(config.transportLabel, 'voiceChat');
});

test('readVolcengineVoiceChatTransportConfig falls back to shim when native transport is requested but unsupported', () => {
  const config = readVolcengineVoiceChatTransportConfig({
    VOLCENGINE_VOICECHAT_TRANSPORT_MODE: 'native',
  });

  assert.equal(config.requestedTransportMode, 'native');
  assert.equal(config.nativeTransportSupported, false);
  assert.equal(config.transportMode, 'shim');
  assert.equal(config.protocolFamily, 'dialogue-websocket');
  assert.equal(config.lifecycleMode, 'voiceChatShim');
});

test('VolcengineVoiceChatTransportClient forwards provider lifecycle to the wrapped base client', async () => {
  const calls = [];
  const transport = new VolcengineVoiceChatTransportClient(
    {
      setTransportLifecycleMode(mode) {
        calls.push(['setTransportLifecycleMode', mode]);
      },
      setVoiceChatStartConfig(config) {
        calls.push(['setVoiceChatStartConfig', config?.functions.length ?? 0]);
      },
      setSessionSystemRole(systemRole) {
        calls.push(['setSessionSystemRole', typeof systemRole === 'string' && systemRole.length > 0]);
      },
      async connect() {
        calls.push('connect');
      },
      async disconnect() {
        calls.push('disconnect');
      },
      async startSession() {
        calls.push('startSession');
      },
      async generateReply(input) {
        calls.push(['generateReply', input]);
        return '你好';
      },
      async appendInputAudioFrame() {
        calls.push('append');
      },
      async commitInputAudio() {
        calls.push('commit');
      },
      isEnabled() {
        return true;
      },
      setEventSink() {},
      async syncCompanionIdentity() {
        calls.push('syncIdentity');
      },
    },
    readVolcengineVoiceChatTransportConfig({}),
  );

  transport.setSessionBlueprint({
    generatedAt: new Date().toISOString(),
    transport: {
      providerMode: 'voiceChat',
      lifecycle: 'startVoiceChat-compatible',
      migrationTarget: 'StartVoiceChat + Function Calling + MCP + Memory',
    },
    assistant: {
      displayName: 'CelCat',
      identityNotes: [],
      systemPrompt: 'test',
    },
    memory: {
      stablePreferences: [],
      relevantMemories: [],
      longTermMemories: [],
    },
    capabilities: {
      tools: [{
        id: 'openBrowser',
        description: '打开浏览器',
        inputSchema: { type: 'object' },
      }],
      mcpServers: [],
    },
    nativeSessionConfig: {
      systemMessages: ['test'],
      functions: [{
        name: 'openBrowser',
        description: '打开浏览器',
        inputSchema: { type: 'object' },
      }],
      mcps: [],
      memory: {
        stablePreferences: [],
        relevantMemories: [],
        longTermMemories: [],
      },
      activeTaskSummary: null,
    },
    activeTask: null,
  });
  await transport.connect();
  await transport.startSession();
  assert.equal(await transport.generateReply('你好'), '你好');

  assert.deepEqual(calls, [
    ['setTransportLifecycleMode', 'voiceChatShim'],
    ['setVoiceChatStartConfig', 1],
    ['setSessionSystemRole', true],
    'connect',
    'startSession',
    ['generateReply', '你好'],
  ]);
});

test('VolcengineVoiceChatTransportClient falls back to shim lifecycle when native transport is requested but unsupported', () => {
  const calls = [];
  const transport = new VolcengineVoiceChatTransportClient(
    {
      setTransportLifecycleMode(mode) {
        calls.push(['setTransportLifecycleMode', mode]);
      },
      setVoiceChatStartConfig() {},
      setSessionSystemRole() {},
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
      async syncCompanionIdentity() {},
    },
    readVolcengineVoiceChatTransportConfig({
      VOLCENGINE_VOICECHAT_TRANSPORT_MODE: 'native',
    }),
  );

  transport.setSessionBlueprint({
    generatedAt: new Date().toISOString(),
    transport: {
      providerMode: 'voiceChat',
      lifecycle: 'startVoiceChat-compatible',
      migrationTarget: 'StartVoiceChat + Function Calling + MCP + Memory',
    },
    assistant: {
      displayName: 'CelCat',
      identityNotes: [],
      systemPrompt: 'test',
    },
    memory: {
      stablePreferences: [],
      relevantMemories: [],
      longTermMemories: [],
    },
    capabilities: {
      tools: [],
      mcpServers: [],
    },
    nativeSessionConfig: {
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
    activeTask: null,
  });

  assert.deepEqual(calls, [
    ['setTransportLifecycleMode', 'voiceChatShim'],
  ]);
});
