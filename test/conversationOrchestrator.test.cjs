const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { InMemoryTaskStore } = require('../dist/main-process/tasks/taskStore.js');
const { TaskRunner } = require('../dist/main-process/tasks/taskRunner.js');
const { UserSettingsStore } = require('../dist/main-process/config/userSettings.js');
const { ConversationOrchestrator } = require('../dist/main-process/orchestrator/conversationOrchestrator.js');

test('ConversationOrchestrator creates background tasks for heavy requests', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-settings-'));
  const taskStore = new InMemoryTaskStore();
  const taskRunner = new TaskRunner(taskStore);
  const settingsStore = new UserSettingsStore(tempDir);
  const orchestrator = new ConversationOrchestrator(taskStore, taskRunner, settingsStore);

  const result = await orchestrator.handleTranscript('帮我分析一下这个需求并给出方案');

  assert.equal(result.relatedTask?.status, 'running');
  assert.match(result.events[0].text, /后台处理/);
  assert.equal(taskStore.list().length, 1);
});

test('ConversationOrchestrator reports progress for the latest active task', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-settings-'));
  const taskStore = new InMemoryTaskStore();
  const taskRunner = new TaskRunner(taskStore);
  const settingsStore = new UserSettingsStore(tempDir);
  const orchestrator = new ConversationOrchestrator(taskStore, taskRunner, settingsStore);

  const task = taskRunner.startTask({
    kind: 'codex',
    transcript: '帮我改一下这个项目',
    title: '后台编码任务',
    autoExecute: false,
  });

  const result = await orchestrator.handleTranscript('现在进度怎么样');

  assert.equal(result.relatedTask?.id, task.id);
  assert.match(result.events[0].text, /目前的进度/);
});
