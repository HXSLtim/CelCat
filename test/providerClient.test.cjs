const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VolcengineRealtimeProviderClient,
  buildVolcengineRealtimeHeaders,
  readVolcengineRealtimeConfig,
} = require('../dist/main-process/realtime/providerClient.js');
const {
  buildChatTextQueryFrame,
  buildSayHelloFrame,
  buildStartConnectionFrame,
  buildStartSessionFrame,
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
});
