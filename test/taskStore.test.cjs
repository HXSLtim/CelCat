const test = require('node:test');
const assert = require('node:assert/strict');

const { InMemoryTaskStore } = require('../dist/main-process/tasks/taskStore.js');

test('InMemoryTaskStore creates, updates, and returns the latest active task', () => {
  const store = new InMemoryTaskStore();
  const created = store.create({
    kind: 'claude',
    title: '后台分析任务',
    progressSummary: '准备中',
    internalDetail: 'queued',
    autoExecute: false,
    riskLevel: 'low',
    sourceTranscript: '帮我总结一下',
  });

  assert.equal(created.status, 'queued');
  assert.equal(store.get(created.id)?.title, '后台分析任务');

  const updated = store.setStatus(created.id, 'running', {
    progressSummary: '处理中',
  });

  assert.equal(updated?.status, 'running');
  assert.equal(store.getLatestActive()?.id, created.id);

  store.setStatus(created.id, 'completed', {
    progressSummary: '已完成',
  });

  assert.equal(store.getLatestActive(), null);
});
