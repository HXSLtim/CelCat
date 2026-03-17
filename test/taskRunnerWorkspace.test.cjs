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
});
