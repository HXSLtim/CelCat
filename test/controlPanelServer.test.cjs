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
  const memoryRoot = path.join(staticRoot, 'agentMemory');
  const taskMemoryDir = path.join(memoryRoot, 'taskMemories');
  fs.mkdirSync(taskMemoryDir, { recursive: true });
  fs.writeFileSync(path.join(memoryRoot, 'companionIdentity.json'), JSON.stringify({
    displayName: '豆包',
    identityNotes: ['自然陪伴型中文桌宠。', '优先用工具完成执行型任务。'],
    updatedAt: new Date().toISOString(),
  }, null, 2));
  fs.writeFileSync(path.join(memoryRoot, 'recentMemory.json'), JSON.stringify([
    {
      title: '后台工具任务',
      kind: 'tool',
      sourceTranscript: '帮我打开一下浏览器。',
      compressedContext: '使用工具打开浏览器。',
      resultSummary: '浏览器打开成功。',
      updatedAt: new Date().toISOString(),
      outcomeStatus: 'ready',
    },
  ], null, 2));
  fs.writeFileSync(path.join(memoryRoot, 'longTermMemory.json'), JSON.stringify([
    {
      category: 'preferences',
      title: '偏好中文',
      summary: '用户偏好中文、直接执行。',
      evidence: '多轮任务说明',
      updatedAt: new Date().toISOString(),
    },
  ], null, 2));
  fs.writeFileSync(path.join(memoryRoot, 'openClawStyleMemory.md'), [
    '# CelCat Agent Memory',
    '',
    '## Stable Preferences',
    '- 偏好中文、直接执行、减少来回确认。',
    '- 偏好桌宠风格体验：自然情绪、嘴型联动、全屏适配。',
    '',
  ].join('\n'));
  const taskDocPath = path.join(taskMemoryDir, '2026-03-18-task-1.md');
  fs.writeFileSync(taskDocPath, [
    '# 后台工具任务',
    '',
    '## Mission',
    '打开浏览器',
    '',
    '## Result',
    '浏览器打开成功。',
  ].join('\n'));

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
        steps: [
          {
            id: 'step-1',
            title: '启动浏览器',
            summary: '调用浏览器自动化能力打开默认浏览器。',
            status: 'in_progress',
          },
        ],
        artifacts: [],
        compressedContext: '',
        memoryRefs: [
          {
            id: 'memory-task-doc',
            label: '任务记忆',
            path: taskDocPath,
            summary: '记录了浏览器任务的执行结果。',
          },
          {
            id: 'memory-journal',
            label: '长期记忆',
            path: path.join(memoryRoot, 'openClawStyleMemory.md'),
            summary: '长期记忆文档',
          },
        ],
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
  assert.equal(payload.taskList[0].statusLabel, '等待确认');
  assert.equal(payload.dashboard.taskCounts.waitingUser, 1);
  assert.equal(payload.dashboard.companion.displayName, '豆包');
  assert.deepEqual(payload.memoryOverview.stablePreferences, [
    '偏好中文、直接执行、减少来回确认。',
    '偏好桌宠风格体验：自然情绪、嘴型联动、全屏适配。',
  ]);

  const dashboardResponse = await fetch(`${url}/api/dashboard`);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboardResponse.status, 200);
  assert.equal(dashboard.activeTask.id, 'task-1');
  assert.equal(dashboard.taskCounts.waitingUser, 1);
  assert.equal(dashboard.memoryDigest.recentWorkCount, 1);

  const memoryResponse = await fetch(`${url}/api/memory/overview`);
  const memory = await memoryResponse.json();
  assert.equal(memoryResponse.status, 200);
  assert.equal(memory.identity.displayName, '豆包');
  assert.equal(memory.recentWork[0].summary, '浏览器打开成功。');

  const tasksResponse = await fetch(`${url}/api/tasks`);
  const taskList = await tasksResponse.json();
  assert.equal(tasksResponse.status, 200);
  assert.equal(taskList[0].title, '后台工具任务');
  assert.equal(taskList[0].requiresConfirmation, true);

  const taskDetailResponse = await fetch(`${url}/api/tasks/task-1/detail`);
  const taskDetail = await taskDetailResponse.json();
  assert.equal(taskDetailResponse.status, 200);
  assert.equal(taskDetail.currentStage, '等待确认');
  assert.equal(taskDetail.relatedMemoryDocs.length, 2);
  assert.equal(taskDetail.relatedMemoryDocs[0].sourceTaskId, 'task-1');

  const memoryDocsResponse = await fetch(`${url}/api/memory/docs`);
  const memoryDocs = await memoryDocsResponse.json();
  assert.equal(memoryDocsResponse.status, 200);
  assert.equal(memoryDocs.length, 2);
  assert.equal(memoryDocs[0].label, '任务记忆');
  assert.equal(memoryDocs[0].contentType, 'markdown');
  assert.equal(memoryDocs[0].sourceKind, 'task_memory');

  const memoryDocDetailResponse = await fetch(`${url}/api/memory/docs/${encodeURIComponent(memoryDocs[0].id)}`);
  const memoryDocDetail = await memoryDocDetailResponse.json();
  assert.equal(memoryDocDetailResponse.status, 200);
  assert.equal(memoryDocDetail.contentType, 'markdown');
  assert.match(memoryDocDetail.content, /浏览器打开成功/);

  const timelineResponse = await fetch(`${url}/api/tasks/task-1/timeline`);
  const timeline = await timelineResponse.json();
  assert.equal(timelineResponse.status, 200);
  assert.equal(timeline.taskId, 'task-1');
  assert.equal(timeline.requiresConfirmation, true);
  assert.equal(timeline.timeline[0].label, '任务已创建');
  assert.equal(timeline.timeline[1].label, '启动浏览器');
  assert.equal(timeline.timeline[1].status, 'in_progress');

  const forbiddenApproveResponse = await fetch(`${url}/api/tasks/task-1/approve`, {
    method: 'POST',
  });
  assert.equal(forbiddenApproveResponse.status, 403);
  assert.deepEqual(approvals, []);

  const approveResponse = await fetch(`${url}/api/tasks/task-1/approve`, {
    method: 'POST',
    headers: {
      Origin: url,
      'X-CelCat-Request': 'control-panel',
    },
  });
  assert.equal(approveResponse.status, 200);
  assert.deepEqual(approvals, ['task-1']);

  const cancelResponse = await fetch(`${url}/api/tasks/task-1/cancel`, {
    method: 'POST',
    headers: {
      Origin: url,
      'X-CelCat-Request': 'control-panel',
    },
  });
  assert.equal(cancelResponse.status, 200);
  assert.deepEqual(cancellations, ['task-1']);

  const htmlResponse = await fetch(url);
  const html = await htmlResponse.text();
  assert.equal(htmlResponse.status, 200);
  assert.match(html, /Control Panel/);

  await server.stop();
});
