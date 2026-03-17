const test = require('node:test');
const assert = require('node:assert/strict');

const { AgentPlanner } = require('../dist/main-process/agent/agentPlanner.js');

test('AgentPlanner falls back to a local workspace when the model is disabled', async () => {
  const planner = new AgentPlanner({
    enabled: false,
    provider: 'glm',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: 'glm5',
    apiKey: '',
  });

  const workspace = await planner.planTask({
    transcript: '帮我给桌宠做一个全屏工作区，并适配 skill 和 mcp',
    kind: 'codex',
    riskLevel: 'low',
    autoExecute: true,
  });

  assert.match(workspace.summary, /工作区|agent/i);
  assert.equal(workspace.skills.length > 0, true);
  assert.equal(workspace.mcps.length > 0, true);
  assert.equal(workspace.steps.length >= 3, true);
  assert.equal(workspace.skills.some((skill) => skill.id === 'codingWorkflow'), true);
  assert.equal(workspace.steps[0]?.id, 'step1');
});
