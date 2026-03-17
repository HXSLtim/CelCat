const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ControlPanelServer } = require('../dist/main-process/control-panel/controlPanelServer.js');

test('ControlPanelServer serves state and task mutation endpoints over localhost', async () => {
  const staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-control-panel-'));
  fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><title>Control Panel</title>');
  fs.writeFileSync(path.join(staticRoot, 'styles.css'), 'body{color:black;}');

  const tasks = [
    {
      id: 'task-1',
      kind: 'tool',
      title: '后台工具任务',
      status: 'waiting_user',
      progressSummary: '等待用户确认',
      internalDetail: 'waiting',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      autoExecute: false,
      riskLevel: 'medium',
      sourceTranscript: '帮我打开浏览器',
      workspace: {
        mission: '打开浏览器',
        summary: '任务已规划',
        model: 'glm-5.4',
        mode: 'planning',
        requiresConfirmation: true,
        notes: [],
        skills: [],
        mcps: [],
        steps: [],
        artifacts: [],
        compressedContext: '',
        memoryRefs: [],
      },
    },
  ];

  const approvals = [];
  const cancellations = [];
  const server = new ControlPanelServer({
    staticRoot,
    taskStore: {
      list() {
        return tasks;
      },
      get(taskId) {
        return tasks.find((task) => task.id === taskId) || null;
      },
      getLatestActive() {
        return tasks[0] || null;
      },
    },
    getSessionSnapshot() {
      return {
        status: 'listening',
        connected: true,
        lastTranscript: '你好',
        lastAssistantMessage: '你好呀',
        activeTaskId: 'task-1',
        error: '',
      };
    },
    getSettings() {
      return { autoExecute: false };
    },
    getCapabilities() {
      return [];
    },
    approveTask(taskId) {
      approvals.push(taskId);
      return tasks.find((task) => task.id === taskId) || null;
    },
    cancelTask(taskId) {
      cancellations.push(taskId);
      return tasks.find((task) => task.id === taskId) || null;
    },
    port: 0,
  });

  const url = await server.start();

  const stateResponse = await fetch(`${url}/api/state`);
  const payload = await stateResponse.json();
  assert.equal(stateResponse.status, 200);
  assert.equal(payload.latestTask.id, 'task-1');
  assert.equal(payload.session.lastTranscript, '你好');

  const approveResponse = await fetch(`${url}/api/tasks/task-1/approve`, {
    method: 'POST',
  });
  assert.equal(approveResponse.status, 200);
  assert.deepEqual(approvals, ['task-1']);

  const cancelResponse = await fetch(`${url}/api/tasks/task-1/cancel`, {
    method: 'POST',
  });
  assert.equal(cancelResponse.status, 200);
  assert.deepEqual(cancellations, ['task-1']);

  const htmlResponse = await fetch(url);
  const html = await htmlResponse.text();
  assert.equal(htmlResponse.status, 200);
  assert.match(html, /Control Panel/);

  await server.stop();
});
