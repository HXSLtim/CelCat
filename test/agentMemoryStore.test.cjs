const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { AgentMemoryStore } = require('../dist/main-process/agent/agentMemoryStore.js');

test('AgentMemoryStore writes OpenClaw-style markdown memory documents', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-memory-'));
  const store = new AgentMemoryStore(tempDir);

  const memoryRefs = store.recordTaskMemory({
    id: 'task-1',
    kind: 'codex',
    title: '后台编码任务',
    status: 'completed',
    progressSummary: '任务已完成',
    internalDetail: 'done',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    autoExecute: true,
    riskLevel: 'low',
    sourceTranscript: '帮我做一个工作区',
    resultSummary: '已经完成工作区和记忆能力。',
    workspace: {
      mission: '帮我做一个工作区',
      summary: '建立工作区并记录记忆。',
      model: 'glm:glm5',
      mode: 'completed',
      requiresConfirmation: false,
      notes: ['记录长期记忆'],
      skills: [],
      mcps: [],
      steps: [],
      artifacts: [],
      compressedContext: 'Mission: 帮我做一个工作区',
      memoryRefs: [],
    },
  });

  assert.equal(memoryRefs.length, 2);
  assert.equal(memoryRefs.every((item) => fs.existsSync(item.path)), true);
  assert.deepEqual(memoryRefs.map((item) => item.id), ['memoryTaskDoc', 'memoryJournal']);
  assert.match(memoryRefs[0].path, /agentMemory[\\/]taskMemories[\\/]/);
  assert.match(memoryRefs[1].path, /agentMemory[\\/]openClawStyleMemory\.md$/);
  const journal = fs.readFileSync(memoryRefs[1].path, 'utf8');
  assert.match(journal, /# CelCat Agent Memory/);
  assert.match(journal, /Compressed Context/);
});

test('AgentMemoryStore exposes recent memories for planning context', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-memory-'));
  const store = new AgentMemoryStore(tempDir);

  store.recordTaskMemory({
    id: 'task-2',
    kind: 'tool',
    title: '后台工具任务',
    status: 'completed',
    progressSummary: '任务已完成',
    internalDetail: 'done',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    autoExecute: false,
    riskLevel: 'medium',
    sourceTranscript: '帮我检查一下最近的任务上下文',
    resultSummary: '已经整理好最近任务。',
    workspace: {
      mission: '帮我检查一下最近的任务上下文',
      summary: '读取并整理最近任务。',
      model: 'glm:glm5',
      mode: 'completed',
      requiresConfirmation: false,
      notes: [],
      skills: [],
      mcps: [],
      steps: [],
      artifacts: [],
      compressedContext: 'Mission: 帮我检查一下最近的任务上下文',
      memoryRefs: [],
    },
  });

  const planningContext = store.getPlanningContext();
  assert.equal(planningContext.stablePreferences.length > 0, true);
  assert.equal(planningContext.recentMemories.length > 0, true);
  assert.match(planningContext.recentMemories[0].compressedContext, /Mission/);
});

test('AgentMemoryStore recalls relevant memories and categorizes long-term entries', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-memory-'));
  const store = new AgentMemoryStore(tempDir);

  store.recordTaskMemory({
    id: 'task-3',
    kind: 'codex',
    title: '后台编码任务',
    status: 'completed',
    progressSummary: '任务已完成',
    internalDetail: 'done',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    autoExecute: true,
    riskLevel: 'low',
    sourceTranscript: '参考 openclaw 风格做记忆文档和上下文压缩',
    resultSummary: '已经完成 OpenClaw 风格记忆文档。',
    workspace: {
      mission: '参考 openclaw 风格做记忆文档和上下文压缩',
      summary: '建立记忆文档和压缩流程。',
      model: 'glm:glm5',
      mode: 'completed',
      requiresConfirmation: false,
      notes: [],
      skills: [],
      mcps: [],
      steps: [],
      artifacts: [],
      compressedContext: 'Mission: openclaw 记忆文档 | Result: 已完成',
      memoryRefs: [],
    },
  });

  const planningContext = store.getPlanningContext('继续完善记忆文档和上下文压缩', 'codex');
  assert.equal(planningContext.relevantMemories.length > 0, true);
  assert.match(planningContext.relevantMemories[0].summary, /记忆文档|上下文压缩/);
  assert.equal(planningContext.longTermMemories.some((entry) => entry.category === 'preferences'), true);
  assert.equal(planningContext.longTermMemories.some((entry) => entry.category === 'recipes'), true);
});

test('AgentMemoryStore migrates legacy kebab-case memory storage to lowerCamelCase paths', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-memory-'));
  const legacyBaseDir = path.join(tempDir, 'agent-memory');
  const legacyTaskDir = path.join(legacyBaseDir, 'tasks');
  fs.mkdirSync(legacyTaskDir, { recursive: true });

  const legacyTaskDocPath = path.join(legacyTaskDir, 'legacy-task.md');
  fs.writeFileSync(legacyTaskDocPath, '# legacy task', 'utf8');
  fs.writeFileSync(
    path.join(legacyBaseDir, 'recent-memory.json'),
    JSON.stringify([
      {
        title: '旧任务',
        kind: 'codex',
        sourceTranscript: '旧的上下文压缩',
        compressedContext: 'Legacy compressed context',
        resultSummary: 'Legacy result',
        updatedAt: new Date().toISOString(),
      },
    ], null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(legacyBaseDir, 'long-term-memory.json'),
    JSON.stringify([
      {
        category: 'preferences',
        title: '旧偏好',
        summary: '用户希望目录名为小驼峰',
        evidence: 'legacy preference',
        updatedAt: new Date().toISOString(),
      },
    ], null, 2),
    'utf8',
  );

  const store = new AgentMemoryStore(tempDir);
  const planningContext = store.getPlanningContext('小驼峰目录', 'codex');

  assert.equal(fs.existsSync(path.join(tempDir, 'agentMemory')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'agent-memory')), false);
  assert.equal(fs.existsSync(path.join(tempDir, 'agentMemory', 'taskMemories', 'legacy-task.md')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'agentMemory', 'recentMemory.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'agentMemory', 'longTermMemory.json')), true);
  assert.equal(planningContext.recentMemories.length > 0, true);
  assert.equal(planningContext.longTermMemories.some((entry) => entry.title === '旧偏好'), true);
});
