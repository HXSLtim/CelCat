const test = require('node:test');
const assert = require('node:assert/strict');

const { replanWorkspaceAfterStep } = require('../dist/main-process/agent/agentWorkspaceReplanner.js');

test('replanWorkspaceAfterStep inserts a corrective step before remaining work after warnings', () => {
  const workspace = {
    mission: '告警后重规划',
    summary: '出现告警时插入纠偏步骤。',
    model: 'glm:glm5',
    mode: 'executing',
    requiresConfirmation: false,
    notes: [],
    skills: [
      { id: 'codingWorkflow', label: 'Coding Workflow', type: 'skill', reason: '处理编码任务' },
    ],
    mcps: [
      { id: 'terminal', label: 'Terminal MCP', type: 'mcp', reason: '运行命令' },
    ],
    steps: [
      { id: 'step1', title: '运行命令', summary: '尝试执行命令', status: 'in_progress', capabilityType: 'mcp', capabilityId: 'terminal' },
      { id: 'step2', title: '继续实现', summary: '推进后续编码工作', status: 'pending' },
    ],
    artifacts: [],
    compressedContext: '',
    memoryRefs: [],
  };

  const replanned = replanWorkspaceAfterStep({
    workspace,
    stepIndex: 0,
    executionResult: {
      observation: '运行命令：当前未触发实际命令执行',
      artifactTone: 'warning',
      progressSummary: '终端能力出现告警',
    },
  });

  assert.equal(replanned.notes.some((note) => /步骤观察（运行命令）/.test(note)), true);
  assert.equal(replanned.notes.some((note) => /计划调整（运行命令）/.test(note)), true);
  assert.equal(replanned.steps.length, 3);
  assert.equal(replanned.steps[1].id, 'stepReplan1');
  assert.equal(replanned.steps[1].capabilityType, 'skill');
  assert.equal(replanned.steps[1].capabilityId, 'codingWorkflow');
  assert.match(replanned.steps[2].summary, /重规划提示：/);
});

test('replanWorkspaceAfterStep assigns a suitable capability to the next step after success', () => {
  const workspace = {
    mission: '成功后补能力',
    summary: '承接上一步结果。',
    model: 'glm:glm5',
    mode: 'executing',
    requiresConfirmation: false,
    notes: [],
    skills: [
      { id: 'codingWorkflow', label: 'Coding Workflow', type: 'skill', reason: '处理编码任务' },
    ],
    mcps: [
      { id: 'terminal', label: 'Terminal MCP', type: 'mcp', reason: '运行命令' },
      { id: 'filesystem', label: 'Filesystem MCP', type: 'mcp', reason: '读取工程' },
    ],
    steps: [
      { id: 'step1', title: '读取工程', summary: '整理项目上下文', status: 'in_progress', capabilityType: 'mcp', capabilityId: 'filesystem' },
      { id: 'step2', title: '执行验证', summary: '运行测试并检查结果', status: 'pending' },
    ],
    artifacts: [],
    compressedContext: '',
    memoryRefs: [],
  };

  const replanned = replanWorkspaceAfterStep({
    workspace,
    stepIndex: 0,
    executionResult: {
      observation: '读取工程：已拿到 package.json 与脚本概览',
      artifactTone: 'info',
      progressSummary: '上下文已建立',
    },
  });

  assert.equal(replanned.notes.some((note) => /计划调整（执行验证）/.test(note)), true);
  assert.equal(replanned.steps[1].capabilityType, 'mcp');
  assert.equal(replanned.steps[1].capabilityId, 'terminal');
  assert.match(replanned.steps[1].summary, /上一步结果：/);
});
