const test = require('node:test');
const assert = require('node:assert/strict');

const { InMemoryTaskStore } = require('../dist/main-process/tasks/taskStore.js');
const { TaskRunner } = require('../dist/main-process/tasks/taskRunner.js');

test('TaskRunner persists an agent workspace and completes planned steps', async () => {
  const store = new InMemoryTaskStore();
  const runner = new TaskRunner(store, {
    async planTask() {
      return {
        mission: '给桌宠加入工作区',
        summary: '先建工作区，再执行，再总结。',
        model: 'glm:glm5',
        mode: 'planning',
        requiresConfirmation: false,
        notes: ['使用 agent workspace'],
        skills: [
          { id: 'codingWorkflow', label: 'Coding Workflow', type: 'skill', reason: '处理编码任务' },
        ],
        mcps: [
          { id: 'filesystem', label: 'Filesystem MCP', type: 'mcp', reason: '处理工作区文件' },
        ],
        artifacts: [],
        compressedContext: '',
        memoryRefs: [],
        steps: [
          { id: 'step1', title: '建立工作区', summary: '初始化 workspace', status: 'in_progress' },
          { id: 'step2', title: '执行任务', summary: '推进步骤', status: 'pending', capabilityType: 'mcp', capabilityId: 'filesystem' },
          { id: 'step3', title: '总结', summary: '输出结果', status: 'pending' },
        ],
      };
    },
  });

  const task = runner.startTask({
    kind: 'codex',
    transcript: '帮我做一个工作区',
    title: '后台编码任务',
    autoExecute: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 500));
  const inFlightTask = store.get(task.id);
  assert.equal(typeof inFlightTask?.workspace?.compressedContext, 'string');

  await new Promise((resolve) => setTimeout(resolve, 2600));

  const finalTask = store.get(task.id);
  assert.equal(finalTask?.status, 'completed');
  assert.equal(finalTask?.workspace?.mode, 'completed');
  assert.equal(finalTask?.workspace?.steps.every((step) => step.status === 'completed'), true);
  assert.equal(typeof finalTask?.workspace?.compressedContext, 'string');
  assert.equal(finalTask?.workspace?.outcome?.status, 'ready');
  assert.equal(typeof finalTask?.workspace?.outcome?.confidence, 'number');
  assert.match(finalTask?.resultSummary || '', /把握度|亮点：/);
});

test('TaskRunner records step observations and feeds them into later step summaries', async () => {
  const store = new InMemoryTaskStore();
  const runner = new TaskRunner(store, {
    async planTask() {
      return {
        mission: '观察反馈测试',
        summary: '执行后写回观察。',
        model: 'glm:glm5',
        mode: 'planning',
        requiresConfirmation: false,
        notes: [],
        skills: [],
        mcps: [
          { id: 'filesystem', label: 'Filesystem MCP', type: 'mcp', reason: '读取文件结构' },
        ],
        artifacts: [],
        compressedContext: '',
        memoryRefs: [],
        steps: [
          { id: 'step1', title: '读取工程', summary: '整理项目上下文', status: 'in_progress', capabilityType: 'mcp', capabilityId: 'filesystem' },
          { id: 'step2', title: '继续执行', summary: '根据上下文推进后续动作', status: 'pending' },
        ],
      };
    },
  });

  const task = runner.startTask({
    kind: 'codex',
    transcript: '继续完善 agentic 工作区',
    title: 'agent 执行观察',
    autoExecute: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 2400));

  const finalTask = store.get(task.id);
  assert.equal(finalTask?.status, 'completed');
  assert.equal(finalTask?.workspace?.notes.some((note) => /步骤观察（读取工程）/.test(note)), true);
  assert.match(finalTask?.workspace?.steps[1]?.summary || '', /上一步结果：/);
  assert.equal(finalTask?.workspace?.outcome?.status === 'in_progress' || finalTask?.workspace?.outcome?.status === 'ready', true);
});

test('TaskRunner appends a recovery step when the last capability step ends with a warning', async () => {
  const store = new InMemoryTaskStore();
  const runner = new TaskRunner(store, {
    async planTask() {
      return {
        mission: '告警恢复测试',
        summary: '末尾告警会触发恢复步骤。',
        model: 'glm:glm5',
        mode: 'planning',
        requiresConfirmation: false,
        notes: [],
        skills: [],
        mcps: [
          { id: 'terminal', label: 'Terminal MCP', type: 'mcp', reason: '运行命令' },
        ],
        artifacts: [],
        compressedContext: '',
        memoryRefs: [],
        steps: [
          { id: 'step1', title: '运行命令', summary: '尝试执行终端动作', status: 'in_progress', capabilityType: 'mcp', capabilityId: 'terminal' },
        ],
      };
    },
  });

  const task = runner.startTask({
    kind: 'tool',
    transcript: '帮我看看当前环境怎么样',
    title: '告警恢复任务',
    autoExecute: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 2400));

  const finalTask = store.get(task.id);
  assert.equal(finalTask?.status, 'waiting_user');
  assert.equal(finalTask?.workspace?.steps.length, 2);
  assert.match(finalTask?.workspace?.steps[1]?.title || '', /处理「运行命令」中的告警/);
  assert.equal(finalTask?.workspace?.steps[1]?.status, 'completed');
  assert.equal(finalTask?.workspace?.mode, 'blocked');
  assert.equal(finalTask?.workspace?.outcome?.status, 'needs_attention');
  assert.equal(finalTask?.workspace?.outcome?.blockers.length > 0, true);
});
