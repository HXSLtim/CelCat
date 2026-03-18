const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildControlPanelTaskDetail,
  buildControlPanelDashboard,
  buildControlPanelMemoryDocumentDetail,
  buildControlPanelMemoryDocuments,
  buildControlPanelMemoryOverview,
  buildControlPanelTaskTimeline,
} = require('../dist/main-process/control-panel/viewModels.js');

function createTask(memoryPath) {
  return {
    id: 'task-1',
    kind: 'tool',
    title: '后台工具任务',
    status: 'waiting_user',
    progressSummary: '等待用户确认',
    internalDetail: 'waiting',
    createdAt: '2026-03-18T08:00:00.000Z',
    updatedAt: '2026-03-18T09:00:00.000Z',
    autoExecute: false,
    riskLevel: 'medium',
    sourceTranscript: '帮我打开一下浏览器',
    resultSummary: '已经准备好打开浏览器，等待继续。',
    workspace: {
      mission: '打开浏览器',
      summary: '任务已规划',
      model: 'glm-5-turbo',
      mode: 'planning',
      requiresConfirmation: true,
      notes: ['用户要求直接执行。'],
      skills: [],
      mcps: [],
      steps: [
        {
          id: 'step-1',
          title: '确认目标',
          summary: '识别为浏览器任务。',
          status: 'completed',
        },
        {
          id: 'step-2',
          title: '等待确认',
          summary: '准备调用浏览器能力。',
          status: 'pending',
        },
      ],
      artifacts: [],
      compressedContext: '不要直接口头拒绝，要把浏览器任务交给后台处理。',
      memoryRefs: [
        {
          id: 'memory-journal',
          label: '长期记忆',
          path: memoryPath,
          summary: 'OpenClaw 风格记忆文档。',
        },
      ],
      outcome: {
        status: 'in_progress',
        summary: '任务已排队，等待用户确认。',
        confidence: 0.84,
        highlights: ['任务已识别为浏览器操作'],
        blockers: [],
        nextActions: ['用户确认后启动工具'],
      },
    },
  };
}

test('control panel view models build clean dashboard, timeline, and memory overview', () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-memory-'));
  const memoryDir = path.join(workspaceDir, 'agentMemory');
  fs.mkdirSync(memoryDir, { recursive: true });
  const journalPath = path.join(memoryDir, 'openClawStyleMemory.md');
  const recentMemoryPath = path.join(memoryDir, 'recentMemory.json');
  const longTermMemoryPath = path.join(memoryDir, 'longTermMemory.json');
  const companionIdentityPath = path.join(memoryDir, 'companionIdentity.json');
  const taskMemoryDir = path.join(memoryDir, 'taskMemories');
  fs.mkdirSync(taskMemoryDir, { recursive: true });
  const taskDocPath = path.join(taskMemoryDir, '2026-03-18-task-1.md');

  fs.writeFileSync(
    journalPath,
    [
      '# CelCat Agent Memory',
      '',
      '## Stable Preferences',
      '- 偏好中文、直接执行、减少来回确认。',
      '- 偏好桌宠风格体验：自然情绪、嘴型联动、全屏适配。',
      '',
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    recentMemoryPath,
    JSON.stringify([
      {
        title: '后台工具任务',
        kind: 'tool',
        sourceTranscript: '帮我打开一下浏览器。',
        compressedContext: '用户要求打开浏览器，交给后台 agent。',
        resultSummary: '浏览器任务已交给后台执行。',
        updatedAt: '2026-03-18T07:00:00.000Z',
        outcomeStatus: 'ready',
      },
    ], null, 2),
    'utf8',
  );

  fs.writeFileSync(
    longTermMemoryPath,
    JSON.stringify([
      {
        category: 'recipes',
        title: '浏览器任务走后台',
        summary: '打开网页、搜索、浏览器启动要优先走工具调用。',
        evidence: '不要口头说自己做不到。',
        updatedAt: '2026-03-18T06:00:00.000Z',
      },
    ], null, 2),
    'utf8',
  );

  fs.writeFileSync(
    companionIdentityPath,
    JSON.stringify({
      displayName: '豆包',
      identityNotes: [
        '你是一个自然陪伴型的中文桌宠 companion。',
        '之后和用户聊天时，自然地以豆包的身份陪伴对方。',
        '用户最近把你的名字改成了小影吧。',
      ],
      updatedAt: '2026-03-18T05:00:00.000Z',
    }, null, 2),
    'utf8',
  );
  fs.writeFileSync(taskDocPath, '# 后台工具任务\n\n## Result\n浏览器任务已交给后台执行。\n', 'utf8');

  const task = createTask(journalPath);
  task.workspace.memoryRefs.unshift({
    id: 'memory-task-doc',
    label: '任务记忆',
    path: taskDocPath,
    summary: '记录浏览器任务的执行结果。',
  });
  const memoryOverview = buildControlPanelMemoryOverview([task]);
  const taskDetail = buildControlPanelTaskDetail(task);
  const memoryDocs = buildControlPanelMemoryDocuments([task]);
  const memoryDocDetail = buildControlPanelMemoryDocumentDetail([task], memoryDocs[0].id);
  const dashboard = buildControlPanelDashboard({
    session: {
      status: 'processing',
      connected: true,
      lastTranscript: '帮我打开一下浏览器。',
      lastAssistantMessage: '',
      activeTaskId: 'task-1',
      error: '',
    },
    latestTask: task,
    tasks: [task],
    settings: { autoExecute: false },
    memoryOverview,
  });
  const timeline = buildControlPanelTaskTimeline(task);

  assert.equal(memoryOverview.identity.displayName, '豆包');
  assert.equal(memoryOverview.stablePreferences.length, 2);
  assert.equal(memoryOverview.identity.identityNotes.some((note) => /小影/.test(note)), false);
  assert.equal(memoryOverview.recentWork[0].summary, '浏览器任务已交给后台执行。');
  assert.equal(memoryOverview.longTermHighlights[0].title, '浏览器任务走后台');
  assert.equal(taskDetail.relatedMemoryDocs.length, 2);
  assert.equal(taskDetail.relatedMemoryDocs[0].sourceTaskId, 'task-1');
  assert.equal(memoryDocs.length, 2);
  assert.equal(memoryDocs[0].contentType, 'markdown');
  assert.equal(memoryDocs[0].sourceKind, 'task_memory');
  assert.equal(memoryDocDetail.fileName, '2026-03-18-task-1.md');
  assert.match(memoryDocDetail.content, /浏览器任务已交给后台执行/);

  assert.equal(dashboard.activeTask.statusLabel, '等待确认');
  assert.equal(dashboard.taskCounts.waitingUser, 1);
  assert.equal(dashboard.companion.displayName, '豆包');
  assert.equal(dashboard.memoryDigest.recentWorkCount, 1);

  assert.equal(timeline.requiresConfirmation, true);
  assert.equal(timeline.currentStage, '等待确认');
  assert.equal(timeline.timeline[1].label, '确认目标');
  assert.equal(timeline.timeline.at(-1).label, '结果摘要');
});
