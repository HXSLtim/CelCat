const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createClassList() {
  const classes = new Set();
  return {
    add(...names) {
      for (const name of names) {
        classes.add(name);
      }
    },
    remove(...names) {
      for (const name of names) {
        classes.delete(name);
      }
    },
    toggle(name, force) {
      if (force === undefined) {
        if (classes.has(name)) {
          classes.delete(name);
          return false;
        }
        classes.add(name);
        return true;
      }

      if (force) {
        classes.add(name);
        return true;
      }

      classes.delete(name);
      return false;
    },
    contains(name) {
      return classes.has(name);
    },
    toString() {
      return [...classes].join(' ');
    },
  };
}

function createElement(tagName) {
  const element = {
    tagName: String(tagName).toUpperCase(),
    children: [],
    dataset: {},
    style: {},
    className: '',
    textContent: '',
    disabled: false,
    onclick: null,
    listeners: {},
    classList: createClassList(),
    append(...nodes) {
      this.children.push(...nodes);
    },
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
  };

  let innerHtmlValue = '';
  Object.defineProperty(element, 'innerHTML', {
    get() {
      return innerHtmlValue;
    },
    set(value) {
      innerHtmlValue = String(value);
      element.children = [];
    },
    configurable: true,
    enumerable: true,
  });

  return element;
}

function loadControlPanelApp(options = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'control-panel', 'app.js'),
    'utf8',
  );

  const elements = new Map();
  const ensureElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, createElement('div'));
    }
    return elements.get(id);
  };

  const alertCalls = [];
  const fetchCalls = [];

  const sandbox = {
    console,
    setInterval: () => 1,
    clearInterval: () => {},
    document: {
      getElementById(id) {
        return ensureElement(id);
      },
      createElement,
    },
    window: {
      alert(message) {
        alertCalls.push(message);
      },
    },
    fetch: async (...args) => {
      fetchCalls.push(args);
      if (options.fetchImpl) {
        return options.fetchImpl(...args);
      }
      throw new Error('fetch not stubbed');
    },
    globalThis: {
      __CELCAT_CONTROL_PANEL_TEST__: {},
      __CELCAT_CONTROL_PANEL_DISABLE_BOOTSTRAP__: true,
    },
  };
  sandbox.window.document = sandbox.document;

  vm.runInNewContext(source, sandbox, { filename: 'control-panel/app.js' });

  return {
    api: sandbox.globalThis.__CELCAT_CONTROL_PANEL_TEST__.api,
    elements,
    alertCalls,
    fetchCalls,
  };
}

test('control panel maps workspace step statuses to user-facing labels', () => {
  const { api } = loadControlPanelApp();

  assert.equal(api.getStepStatusLabel('pending'), '待执行');
  assert.equal(api.getStepStatusLabel('in_progress'), '进行中');
  assert.equal(api.getStepStatusLabel('completed'), '已完成');
  assert.equal(api.getStepStatusLabel('blocked'), '阻塞');
});

test('control panel refreshState degrades gracefully when api/state fails', async () => {
  const { api, elements } = loadControlPanelApp({
    fetchImpl: async () => {
      throw new Error('本地服务暂时不可用');
    },
  });

  await api.refreshState();

  assert.equal(api.state.requestError, '本地服务暂时不可用');
  assert.match(elements.get('hero-summary').textContent, /会继续自动重试/);
  assert.equal(elements.get('session-status').textContent, '连接异常');
});

test('control panel mutateTask surfaces request failures without throwing', async () => {
  const { api, alertCalls, fetchCalls } = loadControlPanelApp({
    fetchImpl: async () => ({
      ok: false,
    }),
  });

  await api.mutateTask('task-1', 'approve');

  assert.equal(api.state.requestError, '任务审批失败');
  assert.deepEqual(alertCalls, ['任务审批失败']);
  assert.equal(fetchCalls[0][0], '/api/tasks/task-1/approve');
  assert.equal(fetchCalls[0][1].method, 'POST');
  assert.equal(fetchCalls[0][1].headers['X-CelCat-Request'], 'control-panel');
});

test('control panel refreshState prefers dashboard, memory overview, and timeline endpoints when available', async () => {
  const { api, elements, fetchCalls } = loadControlPanelApp({
    fetchImpl: async (url) => {
      if (url === '/api/state') {
        return {
          ok: true,
          async json() {
            return {
              tasks: [
                {
                  id: 'task-1',
                  title: '后台工具任务',
                  status: 'waiting_user',
                  progressSummary: '等待用户确认',
                  resultSummary: '',
                  updatedAt: '2026-03-18T09:00:00.000Z',
                  createdAt: '2026-03-18T08:00:00.000Z',
                  riskLevel: 'medium',
                  sourceTranscript: '帮我打开一下浏览器。',
                  workspace: {
                    summary: '任务已规划',
                    notes: ['请确认是否继续。'],
                    steps: [],
                    outcome: null,
                    memoryRefs: [],
                  },
                },
              ],
              taskList: [
                {
                  id: 'task-1',
                  title: '后台工具任务',
                  status: 'waiting_user',
                  statusLabel: '等待确认',
                  summary: '等待用户确认',
                  updatedAt: '2026-03-18T09:00:00.000Z',
                  riskLevel: 'medium',
                },
              ],
              latestTask: { id: 'task-1' },
              session: { status: 'processing', lastTranscript: '帮我打开一下浏览器。' },
              settings: { autoExecute: false },
            };
          },
        };
      }

      if (url === '/api/dashboard') {
        return {
          ok: true,
          async json() {
            return {
              session: { status: 'processing' },
              latestTranscript: '帮我打开一下浏览器。',
              autoExecute: false,
              taskCounts: { active: 0, waitingUser: 1 },
              companion: { displayName: '豆包' },
            };
          },
        };
      }

      if (url === '/api/tasks') {
        return {
          ok: true,
          async json() {
            return [
              {
                id: 'task-1',
                title: '后台工具任务',
                status: 'waiting_user',
                statusLabel: '等待确认',
                summary: '等待用户确认',
                updatedAt: '2026-03-18T09:00:00.000Z',
                riskLevel: 'medium',
              },
            ];
          },
        };
      }

      if (url === '/api/memory/overview') {
        return {
          ok: true,
          async json() {
            return {
              identity: {
                displayName: '豆包',
                identityNotes: ['你是一个自然陪伴型的中文桌宠 companion。'],
              },
              stablePreferences: ['偏好中文、直接执行、减少来回确认。'],
              recentWork: [],
              longTermHighlights: [],
            };
          },
        };
      }

      if (url === '/api/tasks/task-1/timeline') {
        return {
          ok: true,
          async json() {
            return {
              taskId: 'task-1',
              timeline: [
                {
                  label: '等待用户确认',
                  summary: '请确认是否继续。',
                  status: 'pending',
                  timestamp: '2026-03-18T09:00:00.000Z',
                },
              ],
            };
          },
        };
      }

      if (url === '/api/tasks/task-1/detail') {
        return {
          ok: true,
          async json() {
            return {
              id: 'task-1',
              statusLabel: '等待确认',
              summary: '任务已规划，等待用户确认。',
              result: '用户确认后将继续执行。',
              notes: ['请确认是否继续。'],
              relatedMemoryDocs: [
              {
                id: 'doc-1',
                label: '任务记忆',
                fileName: '2026-03-18-task-1.md',
                contentType: 'markdown',
                sourceKind: 'task_memory',
                sourceLabel: '任务记忆',
                summary: '记录了浏览器任务的执行结果。',
                sourceTaskId: 'task-1',
              },
              ],
            };
          },
        };
      }

      if (url === '/api/memory/docs') {
        return {
          ok: true,
          async json() {
            return [
              {
                id: 'doc-1',
                label: '任务记忆',
                fileName: '2026-03-18-task-1.md',
                contentType: 'markdown',
                sourceKind: 'task_memory',
                sourceLabel: '任务记忆',
                summary: '记录了浏览器任务的执行结果。',
                updatedAt: '2026-03-18T09:00:00.000Z',
                sourceTaskId: 'task-1',
                sourceTaskTitle: '后台工具任务',
              },
              {
                id: 'doc-2',
                label: '长期记忆',
                fileName: 'openClawStyleMemory.md',
                contentType: 'markdown',
                sourceKind: 'journal',
                sourceLabel: '长期记忆',
                summary: '长期偏好和身份摘要。',
                updatedAt: '2026-03-18T08:30:00.000Z',
                sourceTaskId: 'task-2',
                sourceTaskTitle: '身份整理任务',
              },
            ];
          },
        };
      }

      if (url === '/api/memory/docs/doc-1') {
        return {
          ok: true,
          async json() {
            return {
              id: 'doc-1',
              label: '任务记忆',
              fileName: '2026-03-18-task-1.md',
              contentType: 'markdown',
              sourceTaskId: 'task-1',
              content: '# 后台工具任务\n\n浏览器已经打开。',
            };
          },
        };
      }

      if (url === '/api/memory/docs/doc-2') {
        return {
          ok: true,
          async json() {
            return {
              id: 'doc-2',
              label: '长期记忆',
              fileName: 'openClawStyleMemory.md',
              contentType: 'markdown',
              sourceTaskId: 'task-2',
              content: '# CelCat Agent Memory\n\n长期偏好和身份摘要。',
            };
          },
        };
      }

      throw new Error(`unexpected fetch: ${url}`);
    },
  });

  await api.refreshState();

  assert.equal(api.state.selectedTaskId, 'task-1');
  assert.equal(elements.get('waiting-approval-count').textContent, '1');
  assert.equal(elements.get('companion-name').textContent, '豆包');
  assert.match(elements.get('memory-identity-title').textContent, /豆包/);
  assert.match(elements.get('memory-doc-preview').textContent, /浏览器已经打开/);
  assert.equal(elements.get('detail-summary').textContent, '任务已规划，等待用户确认。');
  assert.equal(elements.get('memory-doc-source-button').disabled, false);
  assert.equal(typeof elements.get('memory-doc-source-button').onclick, 'function');
  assert.equal(api.state.selectedMemoryDocId, 'doc-1');
  assert.equal(elements.get('memory-doc-list').children.length, 2);
  assert.equal(fetchCalls.some(([url]) => url === '/api/tasks'), true);
  assert.equal(fetchCalls.some(([url]) => url === '/api/dashboard'), true);
  assert.equal(fetchCalls.some(([url]) => url === '/api/memory/overview'), true);
  assert.equal(fetchCalls.some(([url]) => url === '/api/tasks/task-1/detail'), true);
  assert.equal(fetchCalls.some(([url]) => url === '/api/tasks/task-1/timeline'), true);
  assert.equal(fetchCalls.some(([url]) => url === '/api/memory/docs'), true);
  assert.equal(fetchCalls.some(([url]) => url === '/api/memory/docs/doc-1'), true);

  api.setMemoryDocFilter('task');
  await api.refreshState();

  assert.equal(api.state.memoryDocFilter, 'task');
  assert.equal(elements.get('memory-doc-list').children.length, 1);
  assert.equal(elements.get('memory-doc-filter-task').disabled, false);

  api.setMemoryDocFilter('all');
  api.setMemoryDocSearchTerm('浏览器');
  await Promise.resolve();

  assert.equal(api.state.memoryDocSearchTerm, '浏览器');
  assert.equal(api.getVisibleMemoryDocs().length, 1);

  api.setMemoryDocSearchTerm('');
  api.setMemoryDocKindFilter('journal');
  await Promise.resolve();

  assert.equal(api.state.memoryDocKindFilter, 'journal');
  assert.equal(api.getVisibleMemoryDocs().length, 1);
  assert.equal(api.getVisibleMemoryDocs()[0].id, 'doc-2');

  api.setMemoryDocKindFilter('all');
  api.setMemoryDocSortOrder('oldest');
  await Promise.resolve();

  assert.equal(api.state.memoryDocSortOrder, 'oldest');
  assert.equal(api.getVisibleMemoryDocs()[0].id, 'doc-2');
});
