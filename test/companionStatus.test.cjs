const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectCompanionStatus,
  selectRelevantTask,
} = require('../dist/renderer/status/companionStatus.js');

test('selectRelevantTask prioritizes the active task id and waiting_user tasks', () => {
  const tasks = [
    {
      id: 'queued-task',
      status: 'queued',
      updatedAt: '2026-03-18T10:00:00.000Z',
    },
    {
      id: 'waiting-task',
      status: 'waiting_user',
      updatedAt: '2026-03-18T10:05:00.000Z',
    },
    {
      id: 'running-task',
      status: 'running',
      updatedAt: '2026-03-18T10:10:00.000Z',
    },
  ];

  assert.equal(selectRelevantTask(tasks, 'queued-task')?.id, 'queued-task');
  assert.equal(selectRelevantTask(tasks, null)?.id, 'waiting-task');
});

test('selectCompanionStatus honors waiting_user and delegated priority above speaking state', () => {
  assert.deepEqual(
    selectCompanionStatus({
      sessionSnapshot: {
        status: 'listening',
        connected: true,
        lastTranscript: '',
        lastAssistantMessage: '',
        activeTaskId: 'task-1',
        error: '',
      },
      voiceUiState: {
        listening: true,
        showStatus: true,
        statusText: '正在聆听...',
        statusTone: 'listening',
      },
      task: {
        id: 'task-1',
        title: '需要确认',
        kind: 'tool',
        status: 'waiting_user',
        progressSummary: '等你点一下继续',
        internalDetail: '',
        createdAt: '2026-03-18T10:00:00.000Z',
        updatedAt: '2026-03-18T10:10:00.000Z',
        autoExecute: false,
        riskLevel: 'medium',
        sourceTranscript: '帮我打开浏览器',
      },
      assistantSpeakingText: '我已经开始处理了。',
    }),
    {
      key: 'waiting_user',
      text: '等你点一下继续',
      tone: 'result',
      visible: true,
    },
  );

  assert.deepEqual(
    selectCompanionStatus({
      sessionSnapshot: {
        status: 'processing',
        connected: true,
        lastTranscript: '',
        lastAssistantMessage: '',
        activeTaskId: 'task-2',
        error: '',
      },
      voiceUiState: null,
      task: {
        id: 'task-2',
        title: '后台处理中',
        kind: 'tool',
        status: 'running',
        progressSummary: '后台正在打开浏览器',
        internalDetail: '',
        createdAt: '2026-03-18T10:00:00.000Z',
        updatedAt: '2026-03-18T10:10:00.000Z',
        autoExecute: true,
        riskLevel: 'low',
        sourceTranscript: '帮我打开浏览器',
      },
      assistantSpeakingText: '我已经开始处理了。',
    }).key,
    'delegated',
  );
});

test('selectCompanionStatus falls back through speaking, thinking, listening, and idle states', () => {
  assert.equal(
    selectCompanionStatus({
      sessionSnapshot: {
        status: 'listening',
        connected: true,
        lastTranscript: '',
        lastAssistantMessage: '',
        activeTaskId: null,
        error: '',
      },
      voiceUiState: null,
      task: null,
      assistantSpeakingText: '你好呀',
    }).key,
    'assistant_speaking',
  );

  assert.equal(
    selectCompanionStatus({
      sessionSnapshot: {
        status: 'processing',
        connected: true,
        lastTranscript: '',
        lastAssistantMessage: '',
        activeTaskId: null,
        error: '',
      },
      voiceUiState: null,
      task: null,
      assistantSpeakingText: '',
    }).key,
    'assistant_thinking',
  );

  assert.equal(
    selectCompanionStatus({
      sessionSnapshot: {
        status: 'listening',
        connected: true,
        lastTranscript: '',
        lastAssistantMessage: '',
        activeTaskId: null,
        error: '',
      },
      voiceUiState: {
        listening: true,
        showStatus: true,
        statusText: '正在聆听...',
        statusTone: 'listening',
      },
      task: null,
      assistantSpeakingText: '',
    }).key,
    'user_listening',
  );

  assert.equal(
    selectCompanionStatus({
      sessionSnapshot: {
        status: 'listening',
        connected: true,
        lastTranscript: '',
        lastAssistantMessage: '',
        activeTaskId: null,
        error: '',
      },
      voiceUiState: null,
      task: null,
      assistantSpeakingText: '',
    }).key,
    'idle',
  );
});

test('selectCompanionStatus always elevates error states first', () => {
  assert.equal(
    selectCompanionStatus({
      sessionSnapshot: {
        status: 'error',
        connected: false,
        lastTranscript: '',
        lastAssistantMessage: '',
        activeTaskId: null,
        error: '会话启动失败',
      },
      voiceUiState: {
        listening: false,
        showStatus: true,
        statusText: '麦克风权限被拒绝',
        statusTone: 'error',
      },
      task: null,
      assistantSpeakingText: '你好呀',
    }).key,
    'error',
  );
});
