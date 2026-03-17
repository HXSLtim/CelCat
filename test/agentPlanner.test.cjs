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

test('AgentPlanner feeds memory outcome signals into fallback planning', async () => {
  const calls = [];
  const planner = new AgentPlanner({
    enabled: false,
    provider: 'glm',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: 'glm5',
    apiKey: '',
  }, {
    getPlanningContext(query, kind) {
      calls.push({ query, kind });
      return {
        stablePreferences: ['偏好中文'],
        recentMemories: [
          {
            title: '上次工作区任务',
            kind: 'codex',
            sourceTranscript: '继续完善 agent workspace',
            compressedContext: 'Mission: 继续完善 agent workspace',
            resultSummary: '还有阻塞项待处理',
            updatedAt: new Date().toISOString(),
            outcomeStatus: 'needs_attention',
            outcomeConfidence: 0.48,
            blockers: ['Playwright skill 缺少明确 URL'],
            nextActions: ['先补目标 URL 再执行浏览器 skill'],
          },
        ],
        relevantMemories: [
          {
            title: '上次工作区任务',
            kind: 'codex',
            summary: '继续完善 agent workspace | Playwright skill 缺少明确 URL',
            score: 6,
          },
        ],
        longTermMemories: [],
        capabilitySignals: [
          {
            id: 'playwrightSkill',
            label: 'Playwright',
            type: 'skill',
            reliability: -0.4,
            successes: 0,
            warnings: 2,
            lastUsedAt: new Date().toISOString(),
            rationale: '最近更容易出现告警。',
          },
          {
            id: 'codingWorkflow',
            label: 'Coding Workflow',
            type: 'skill',
            reliability: 1.1,
            successes: 2,
            warnings: 0,
            lastUsedAt: new Date().toISOString(),
            rationale: '最近执行更稳定。',
          },
          {
            id: 'filesystem',
            label: 'Filesystem MCP',
            type: 'mcp',
            reliability: 0.7,
            successes: 1,
            warnings: 0,
            lastUsedAt: new Date().toISOString(),
            rationale: '最近执行更稳定。',
          },
        ],
      };
    },
  });

  const workspace = await planner.planTask({
    transcript: '继续优化 agentic 浏览器工作区',
    kind: 'codex',
    riskLevel: 'low',
    autoExecute: true,
  });

  assert.deepEqual(calls, [{
    query: '继续优化 agentic 浏览器工作区',
    kind: 'codex',
  }]);
  assert.equal(workspace.notes.some((note) => /阻塞项/.test(note)), true);
  assert.equal(workspace.notes.some((note) => /下一步/.test(note)), true);
  assert.equal(workspace.notes.some((note) => /更可靠的能力/.test(note)), true);
  assert.match(workspace.summary, /阻塞项|收敛成功|执行路径/);
  assert.match(workspace.steps[0]?.summary || '', /阻塞项/);
  assert.match(workspace.steps[2]?.summary || '', /目标 URL|继续/);
  assert.equal(workspace.skills[0]?.id, 'codingWorkflow');
  assert.match(workspace.skills[0]?.reason || '', /近期更稳定/);
});
