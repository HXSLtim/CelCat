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

test('ConversationOrchestrator routes browser-opening requests to the background agent immediately', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-settings-'));
  const taskStore = new InMemoryTaskStore();
  const taskRunner = new TaskRunner(taskStore);
  const settingsStore = new UserSettingsStore(tempDir);
  const orchestrator = new ConversationOrchestrator(taskStore, taskRunner, settingsStore);

  const result = await orchestrator.handleTranscript('帮我打开一下浏览器');

  assert.equal(result.relatedTask?.kind, 'tool');
  assert.equal(result.companionRequest, null);
  assert.match(result.events[0].text, /后台 agent 处理|后台处理/);
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

test('ConversationOrchestrator injects identity and memory context for companion chat', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-settings-'));
  const taskStore = new InMemoryTaskStore();
  const taskRunner = new TaskRunner(taskStore);
  const settingsStore = new UserSettingsStore(tempDir);
  const memoryStore = {
    getPlanningContext: () => ({
      stablePreferences: ['偏好中文、直接执行、减少来回确认。'],
      recentMemories: [{
        title: '最近一次对话',
        kind: 'claude',
        sourceTranscript: '我们在调桌宠的身份认知',
        compressedContext: '希望实时语音也能带着身份认知和连续记忆说话。',
        resultSummary: '已经完成 agent 工作区与记忆系统。',
        updatedAt: new Date().toISOString(),
      }],
      relevantMemories: [{
        title: '身份认知优化',
        kind: 'claude',
        summary: '用户希望实时语音回复能自然体现桌宠身份认知和熟悉感。',
        score: 4,
      }],
      longTermMemories: [{
        category: 'preferences',
        title: '桌宠风格偏好',
        summary: '用户更希望像桌宠一样自然陪伴，而不是机械助手。',
        evidence: '历史对话',
        updatedAt: new Date().toISOString(),
      }],
      capabilitySignals: [],
    }),
    getCompanionIdentity: () => ({
      displayName: '小影',
      identityNotes: ['你是一个自然陪伴型的中文桌宠 companion。'],
      updatedAt: new Date().toISOString(),
    }),
    updateCompanionIdentity: (update) => ({
      displayName: update.displayName || '小影',
      identityNotes: update.identityNotes || [],
      updatedAt: new Date().toISOString(),
    }),
  };
  const orchestrator = new ConversationOrchestrator(taskStore, taskRunner, settingsStore, memoryStore);

  const result = await orchestrator.handleTranscript('你还记得你是谁吗');

  assert.equal(result.relatedTask, null);
  assert.equal(result.events.length, 0);
  assert.ok(result.companionRequest);
  assert.match(result.companionRequest.prompt, /你是 小影/);
  assert.match(result.companionRequest.prompt, /你现在对用户自称“小影”/);
  assert.match(result.companionRequest.prompt, /\[\[CELCAT_AGENT kind=codex\]\]/);
  assert.match(result.companionRequest.prompt, /用户长期偏好：/);
  assert.match(result.companionRequest.prompt, /最近相关上下文：/);
  assert.match(result.companionRequest.prompt, /用户刚刚说：你还记得你是谁吗/);
});

test('ConversationOrchestrator persists spoken rename requests into companion identity', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-settings-'));
  const taskStore = new InMemoryTaskStore();
  const taskRunner = new TaskRunner(taskStore);
  const settingsStore = new UserSettingsStore(tempDir);
  const updateCalls = [];
  const memoryStore = {
    getPlanningContext: () => ({
      stablePreferences: [],
      recentMemories: [],
      relevantMemories: [],
      longTermMemories: [],
      capabilitySignals: [],
    }),
    getCompanionIdentity: () => ({
      displayName: 'CelCat',
      identityNotes: [],
      updatedAt: new Date().toISOString(),
    }),
    updateCompanionIdentity: (update) => {
      updateCalls.push(update);
      return {
        displayName: update.displayName || 'CelCat',
        identityNotes: update.identityNotes || [],
        updatedAt: new Date().toISOString(),
      };
    },
  };
  const orchestrator = new ConversationOrchestrator(taskStore, taskRunner, settingsStore, memoryStore);

  const result = await orchestrator.handleTranscript('以后我叫你小影');

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].displayName, '小影');
  assert.equal(result.companionRequest, null);
  assert.match(result.events[0].text, /以后就叫小影/);
});

test('ConversationOrchestrator converts companion handoff directives into background tasks', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-settings-'));
  const taskStore = new InMemoryTaskStore();
  const taskRunner = new TaskRunner(taskStore);
  const settingsStore = new UserSettingsStore(tempDir);
  const orchestrator = new ConversationOrchestrator(taskStore, taskRunner, settingsStore);

  const result = orchestrator.resolveCompanionReply(
    '你帮我查一下今年桌宠 agentic 的设计趋势',
    '[[CELCAT_AGENT kind=tool]]帮用户搜索并整理今年桌宠 agentic 设计趋势',
  );

  assert.ok(result);
  assert.equal(result.relatedTask?.kind, 'tool');
  assert.match(result.events[0].text, /后台 agent 处理/);
  assert.equal(taskStore.list().length, 1);
});

test('ConversationOrchestrator overrides browser refusal replies into forced agent tasks', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-settings-'));
  const taskStore = new InMemoryTaskStore();
  const taskRunner = new TaskRunner(taskStore);
  const settingsStore = new UserSettingsStore(tempDir);
  const orchestrator = new ConversationOrchestrator(taskStore, taskRunner, settingsStore);

  const result = orchestrator.resolveCompanionReply(
    '帮我打开一下浏览器',
    '不好意思啊，我没办法直接打开浏览器呢。',
  );

  assert.ok(result);
  assert.equal(result.relatedTask?.kind, 'tool');
  assert.match(result.events[0].text, /后台 agent 处理|后台处理/);
  assert.equal(taskStore.list().length, 1);
});

test('ConversationOrchestrator exposes a system method for creating background tasks', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-settings-'));
  const taskStore = new InMemoryTaskStore();
  const taskRunner = new TaskRunner(taskStore);
  const settingsStore = new UserSettingsStore(tempDir);
  const orchestrator = new ConversationOrchestrator(taskStore, taskRunner, settingsStore);

  const result = orchestrator.startAgentTaskFromSystem({
    transcript: '帮我打开浏览器并搜索 CelCat',
    kind: 'tool',
  });

  assert.equal(result.relatedTask?.kind, 'tool');
  assert.match(result.events[0].text, /后台 agent 处理|后台处理/);
  assert.equal(taskStore.list().length, 1);
});

test('ConversationOrchestrator exposes a system method for renaming the companion identity', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-settings-'));
  const taskStore = new InMemoryTaskStore();
  const taskRunner = new TaskRunner(taskStore);
  const settingsStore = new UserSettingsStore(tempDir);
  let currentIdentity = {
    displayName: 'CelCat',
    identityNotes: [],
    updatedAt: new Date().toISOString(),
  };
  const memoryStore = {
    getPlanningContext: () => ({
      stablePreferences: [],
      recentMemories: [],
      relevantMemories: [],
      longTermMemories: [],
      capabilitySignals: [],
    }),
    getCompanionIdentity: () => currentIdentity,
    updateCompanionIdentity: (update) => {
      currentIdentity = {
        displayName: update.displayName || currentIdentity.displayName,
        identityNotes: update.identityNotes || currentIdentity.identityNotes,
        updatedAt: new Date().toISOString(),
      };
      return currentIdentity;
    },
  };
  const orchestrator = new ConversationOrchestrator(taskStore, taskRunner, settingsStore, memoryStore);

  const result = orchestrator.renameCompanionFromSystem('小影');

  assert.ok(result);
  assert.equal(currentIdentity.displayName, '小影');
  assert.match(result.events[0].text, /以后就叫小影/);
});

test('ConversationOrchestrator exposes voiceChat session context for StartVoiceChat migration', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-settings-'));
  const taskStore = new InMemoryTaskStore();
  const taskRunner = new TaskRunner(taskStore);
  const settingsStore = new UserSettingsStore(tempDir);
  const memoryStore = {
    getPlanningContext: () => ({
      stablePreferences: ['偏好中文、直接执行。'],
      recentMemories: [],
      relevantMemories: [],
      longTermMemories: [],
      capabilitySignals: [],
    }),
    getCompanionIdentity: () => ({
      displayName: 'CelCat',
      identityNotes: ['你是一个自然陪伴型的中文桌宠 companion。'],
      updatedAt: new Date().toISOString(),
    }),
    updateCompanionIdentity: (update) => ({
      displayName: update.displayName || 'CelCat',
      identityNotes: update.identityNotes || [],
      updatedAt: new Date().toISOString(),
    }),
  };
  const orchestrator = new ConversationOrchestrator(taskStore, taskRunner, settingsStore, memoryStore);

  const context = orchestrator.getVoiceChatSessionContext();

  assert.equal(context.companionIdentity?.displayName, 'CelCat');
  assert.equal(context.memoryContext?.stablePreferences[0], '偏好中文、直接执行。');
  assert.equal(context.latestTask, null);
});
