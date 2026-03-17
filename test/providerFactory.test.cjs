const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readCompanionProviderModeConfig,
} = require('../dist/main-process/realtime/providerMode.js');
const {
  createCompanionProviderForMode,
} = require('../dist/main-process/realtime/providerFactory.js');
const {
  getVoiceChatToolDefinitions,
} = require('../dist/main-process/realtime/voiceChatToolRegistry.js');

test('readCompanionProviderModeConfig defaults to voiceChat mode', () => {
  const config = readCompanionProviderModeConfig({});
  assert.equal(config.mode, 'voiceChat');
});

test('readCompanionProviderModeConfig accepts voiceChat aliases', () => {
  assert.equal(readCompanionProviderModeConfig({
    VOLCENGINE_REALTIME_PROVIDER_MODE: 'voiceChat',
  }).mode, 'voiceChat');
  assert.equal(readCompanionProviderModeConfig({
    VOLCENGINE_REALTIME_PROVIDER_MODE: 'voice-chat',
  }).mode, 'voiceChat');
});

test('createCompanionProviderForMode creates the voiceChat compatibility provider', () => {
  const provider = createCompanionProviderForMode({ mode: 'voiceChat' });
  assert.equal(typeof provider.connect, 'function');
  assert.equal(typeof provider.generateReply, 'function');
  assert.equal(typeof provider.syncCompanionIdentity, 'function');
});

test('createCompanionProviderForMode accepts a runtime orchestrator for voiceChat tool execution', () => {
  const provider = createCompanionProviderForMode(
    { mode: 'voiceChat' },
    {
      orchestrator: {
        startAgentTaskFromSystem() {
          return null;
        },
        renameCompanionFromSystem() {
          return null;
        },
        getCompanionIdentity() {
          return {
            displayName: 'CelCat',
          };
        },
        getVoiceChatSessionContext() {
          return {
            companionIdentity: {
              displayName: 'CelCat',
              identityNotes: ['你会持续保持身份认知。'],
            },
            memoryContext: {
              stablePreferences: ['偏好中文'],
              recentMemories: [],
              relevantMemories: [],
              longTermMemories: [],
              capabilitySignals: [],
            },
            latestTask: null,
          };
        },
      },
    },
  );
  assert.equal(typeof provider.generateReply, 'function');
  assert.equal(typeof provider.generateReplyPayload, 'function');
});

test('voiceChat tool registry exposes migration tool definitions', () => {
  const definitions = getVoiceChatToolDefinitions();
  assert.equal(definitions.some((definition) => definition.id === 'startAgentTask'), true);
  assert.equal(definitions.some((definition) => definition.id === 'renameCompanion'), true);
  assert.equal(definitions.some((definition) => definition.id === 'openBrowser'), true);
});
