const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readAgentModelConfig,
  getSafeAgentModelMeta,
} = require('../dist/main-process/agent/agentModelConfig.js');

test('readAgentModelConfig applies GLM Coding Plan defaults', () => {
  const config = readAgentModelConfig({});

  assert.equal(config.provider, 'glm');
  assert.equal(config.baseUrl, 'https://open.bigmodel.cn/api/coding/paas/v4');
  assert.equal(config.model, 'glm-5');
  assert.equal(config.enabled, false);
});

test('getSafeAgentModelMeta excludes the agent api key', () => {
  const config = readAgentModelConfig({
    AGENT_PROVIDER: 'glm',
    AGENT_BASE_URL: 'https://open.bigmodel.cn/api/coding/paas/v4',
    AGENT_MODEL: 'glm5',
    AGENT_API_KEY: 'super-secret',
  });

  assert.deepEqual(getSafeAgentModelMeta(config), {
    enabled: true,
    provider: 'glm',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: 'glm-5',
  });
});
