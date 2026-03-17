const test = require('node:test');
const assert = require('node:assert/strict');

const { synthesizeWorkspaceOutcome } = require('../dist/main-process/agent/workspaceOutcomeSynthesizer.js');

test('synthesizeWorkspaceOutcome reports blockers and lowers confidence when warnings exist', () => {
  const outcome = synthesizeWorkspaceOutcome({
    mission: '检查告警任务',
    summary: '处理告警',
    model: 'glm:glm5',
    mode: 'executing',
    requiresConfirmation: false,
    notes: [],
    skills: [],
    mcps: [],
    steps: [
      { id: 'step1', title: '运行命令', summary: '执行终端动作', status: 'completed' },
      { id: 'step2', title: '继续处理', summary: '等待下一步', status: 'pending' },
    ],
    artifacts: [
      {
        id: 'terminalSnapshot',
        label: 'Terminal Snapshot',
        content: '当前未触发实际命令执行；如需运行构建或测试，可在自动执行打开后继续推进。',
        tone: 'warning',
      },
    ],
    compressedContext: '',
    memoryRefs: [],
  });

  assert.equal(outcome.status, 'needs_attention');
  assert.equal(outcome.blockers.length > 0, true);
  assert.equal(outcome.confidence < 0.6, true);
  assert.equal(outcome.nextActions.some((item) => /处理阻塞项/.test(item)), true);
});

test('synthesizeWorkspaceOutcome reports ready state for completed work without blockers', () => {
  const outcome = synthesizeWorkspaceOutcome({
    mission: '完成任务',
    summary: '所有步骤结束',
    model: 'glm:glm5',
    mode: 'completed',
    requiresConfirmation: false,
    notes: [],
    skills: [],
    mcps: [],
    steps: [
      { id: 'step1', title: '读取工程', summary: '完成', status: 'completed' },
      { id: 'step2', title: '执行验证', summary: '完成', status: 'completed' },
    ],
    artifacts: [
      {
        id: 'terminalTest',
        label: 'Terminal test',
        content: 'All checks passed successfully.',
        tone: 'success',
      },
    ],
    compressedContext: '',
    memoryRefs: [],
  });

  assert.equal(outcome.status, 'ready');
  assert.equal(outcome.blockers.length, 0);
  assert.equal(outcome.confidence > 0.7, true);
  assert.equal(outcome.highlights.some((item) => /读取工程 已完成|All checks passed/.test(item)), true);
});
