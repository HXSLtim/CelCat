const state = {
  tasks: [],
  taskList: [],
  selectedTaskId: null,
  selectedTimeline: null,
  dashboard: null,
  memoryOverview: null,
  memoryDocs: [],
  memoryDocFilter: 'all',
  memoryDocKindFilter: 'all',
  memoryDocSortOrder: 'newest',
  memoryDocSearchTerm: '',
  selectedMemoryDocId: null,
  selectedMemoryDoc: null,
  selectedTaskDetail: null,
  pollTimer: null,
  requestError: '',
  lastPayload: null,
  isRefreshing: false,
};

function getTaskStatusLabel(status) {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'running':
      return '执行中';
    case 'waiting_user':
      return '等待确认';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return '空闲';
  }
}

function getSessionStatusLabel(status) {
  switch (status) {
    case 'listening':
      return '在线监听';
    case 'processing':
      return '处理中';
    case 'speaking':
      return '正在回复';
    case 'idle':
      return '空闲待命';
    case 'error':
      return '连接异常';
    default:
      return status || '未启动';
  }
}

function getStepStatusLabel(status) {
  switch (status) {
    case 'pending':
      return '待执行';
    case 'in_progress':
      return '进行中';
    case 'completed':
      return '已完成';
    case 'blocked':
      return '阻塞';
    default:
      return '未知';
  }
}

function getTimelineTone(status) {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'blocked':
    case 'failed':
      return 'blocked';
    case 'in_progress':
    case 'running':
      return 'active';
    default:
      return 'pending';
  }
}

function createEmpty(text) {
  const element = document.createElement('div');
  element.className = 'empty';
  element.textContent = text;
  return element;
}

function compactTextValue(value, maxLength) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function stripSpokenPrefix(value) {
  return String(value || '')
    .replace(/^[那嗯啊呀哎诶哦]+\s*/u, '')
    .replace(/^(帮我|请你|麻烦你|你帮我|给我)\s*/u, '')
    .replace(/^(现在|然后|那你现在|那就)\s*/u, '')
    .trim();
}

function getDisplayTaskTitle(taskLike, rawTask) {
  const rawTitle = String(taskLike?.title || rawTask?.title || '').trim();
  const transcript = stripSpokenPrefix(rawTask?.sourceTranscript || taskLike?.sourceTranscript || '');
  const mission = stripSpokenPrefix(rawTask?.workspace?.mission || '');
  const genericTitle = /后台|工具任务|执行任务|任务$/u.test(rawTitle);
  const preferred = compactTextValue(transcript || mission, 24);

  if (preferred && genericTitle) {
    return preferred;
  }

  return compactTextValue(rawTitle || preferred || '执行任务', 24);
}

function getDisplayMemorySourceTitle(taskTitle) {
  const raw = String(taskTitle || '').trim();
  if (!raw) {
    return '';
  }

  if (/后台|工具任务|执行任务|任务$/u.test(raw)) {
    return '关联任务';
  }

  return compactTextValue(raw, 20);
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function setVisible(id, visible) {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }

  element.style.display = visible ? '' : 'none';
}

function fillList(containerId, items, renderItem, emptyText) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  container.innerHTML = '';
  if (!items.length) {
    container.appendChild(createEmpty(emptyText));
    return;
  }

  for (const item of items) {
    container.appendChild(renderItem(item));
  }
}

function fetchJson(pathname) {
  return fetch(pathname, { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`请求失败: ${pathname}`);
    }

    return response.json();
  });
}

function getRiskLabel(riskLevel) {
  if (riskLevel === 'high') {
    return '高风险';
  }

  if (riskLevel === 'medium') {
    return '中风险';
  }

  return '低风险';
}

function getHeroFocusSummary(dashboard) {
  if (state.requestError) {
    return '本地服务正在重连，工作台会继续自动刷新并保留上次内容。';
  }

  if (dashboard.waitingApprovalCount > 0) {
    return '当前有关键步骤在等待你拍板，先看中间详情区顶部的决策卡。';
  }

  if (dashboard.activeTaskCount > 0) {
    return '当前有任务正在后台推进，左侧看队列，中间看结果和阶段。';
  }

  return '现在没有阻塞项，面板处于待命状态，随时可以承接新任务。';
}

function normalizeDashboard(payload) {
  const dashboard = payload?.dashboard || {};
  const session = dashboard.session || payload?.session || null;
  const activeTask = dashboard.activeTask || payload?.latestTask || null;
  const taskCounts = dashboard.taskCounts || {};
  const latestTranscript = dashboard.latestTranscript || session?.lastTranscript || '-';
  const autoExecute = typeof dashboard.autoExecute === 'boolean'
    ? dashboard.autoExecute
    : Boolean(payload?.settings?.autoExecute);
  const activeTaskCount = Number.isFinite(taskCounts.active)
    ? taskCounts.active
    : Array.isArray(payload?.tasks)
      ? payload.tasks.filter((task) => task.status === 'queued' || task.status === 'running').length
      : 0;
  const waitingApprovalCount = Number.isFinite(taskCounts.waitingUser)
    ? taskCounts.waitingUser
    : Array.isArray(payload?.tasks)
      ? payload.tasks.filter((task) => task.status === 'waiting_user').length
      : 0;
  const companion = dashboard.companion || null;

  return {
    session,
    activeTask,
    latestTranscript,
    autoExecute,
    activeTaskCount,
    waitingApprovalCount,
    companion,
  };
}

function normalizeMemoryOverview(payload) {
  const explicitOverview = payload?.memoryOverview || null;
  if (explicitOverview) {
    return {
      identityTitle: explicitOverview.identity?.displayName
        ? `${explicitOverview.identity.displayName} · 身份档案`
        : '当前没有身份摘要。',
      identityNotes: Array.isArray(explicitOverview.identity?.identityNotes)
        ? explicitOverview.identity.identityNotes
        : [],
      preferences: Array.isArray(explicitOverview.stablePreferences)
        ? explicitOverview.stablePreferences
        : [],
      recentWork: Array.isArray(explicitOverview.recentWork)
        ? explicitOverview.recentWork
        : [],
      highlights: Array.isArray(explicitOverview.longTermHighlights)
        ? explicitOverview.longTermHighlights
        : [],
    };
  }

  const activeTask = payload?.latestTask || state.tasks[0] || null;
  const workspace = activeTask?.workspace || null;
  const memoryRefs = Array.isArray(workspace?.memoryRefs) ? workspace.memoryRefs : [];

  return {
    identityTitle: '当前还没有独立记忆摘要接口。',
    identityNotes: [
      '后续会在这里展示桌宠名字、身份说明和最近一次身份变更。',
    ],
    preferences: payload?.settings
      ? [
        payload.settings.autoExecute
          ? '当前默认自动执行中低风险任务。'
          : '当前会先确认中高风险任务。',
      ]
      : [],
    recentWork: memoryRefs.map((memoryRef) => ({
      title: memoryRef.label,
      summary: memoryRef.summary,
      updatedAt: memoryRef.path,
    })),
    highlights: [],
  };
}

function buildTaskTimeline(task, timelinePayload) {
  if (timelinePayload?.timeline?.length) {
    return timelinePayload.timeline.map((item) => ({
      title: item.label,
      summary: item.summary,
      meta: item.timestamp ? formatDateTime(item.timestamp) : '',
      tone: getTimelineTone(item.status),
    }));
  }

  if (!task) {
    return [];
  }

  if (Array.isArray(task.timeline) && task.timeline.length) {
    return task.timeline;
  }

  const workspace = task.workspace || null;
  const timeline = [];

  timeline.push({
    title: '任务已接收',
    summary: task.progressSummary || task.sourceTranscript || '任务已进入工作台。',
    meta: task.createdAt ? formatDateTime(task.createdAt) : '',
    tone: 'completed',
  });

  if (workspace?.steps?.length) {
    for (const step of workspace.steps) {
      timeline.push({
        title: step.title,
        summary: step.summary,
        meta: getStepStatusLabel(step.status),
        tone: getTimelineTone(step.status),
      });
    }
  }

  if (task.status === 'waiting_user') {
    timeline.push({
      title: '等待你的确认',
      summary: getDecisionSummary(task),
      meta: '需要操作',
      tone: 'active',
    });
  } else if (task.resultSummary) {
    timeline.push({
      title: '结果整理完成',
      summary: task.resultSummary,
      meta: getTaskStatusLabel(task.status),
      tone: task.status === 'failed' ? 'blocked' : 'completed',
    });
  }

  return timeline;
}

function getDecisionSummary(task) {
  const workspace = task?.workspace || null;
  if (!task || task.status !== 'waiting_user') {
    return '当前没有待确认任务。';
  }

  return workspace?.notes?.[0]
    || workspace?.summary
    || task.progressSummary
    || '后台任务推进到关键节点，需要你决定是否继续执行。';
}

function formatDateTime(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getSelectedTask() {
  return state.tasks.find((item) => item.id === state.selectedTaskId) || null;
}

function getSelectedTaskCard() {
  return state.taskList.find((item) => item.id === state.selectedTaskId) || null;
}

function getSelectedMemoryDocCard() {
  return state.memoryDocs.find((item) => item.id === state.selectedMemoryDocId) || null;
}

function getTaskDetailMemoryDocs() {
  return Array.isArray(state.selectedTaskDetail?.relatedMemoryDocs)
    ? state.selectedTaskDetail.relatedMemoryDocs
    : [];
}

function getVisibleMemoryDocs() {
  const relatedDocIds = new Set(getTaskDetailMemoryDocs().map((item) => item.id));
  const searchTerm = state.memoryDocSearchTerm.trim().toLowerCase();
  const filtered = state.memoryDocs.filter((item) => {
    if (state.memoryDocFilter === 'task' && !relatedDocIds.has(item.id)) {
      return false;
    }

    if (state.memoryDocKindFilter !== 'all' && item.sourceKind !== state.memoryDocKindFilter) {
      return false;
    }

    if (!searchTerm) {
      return true;
    }

    return [
      item.label,
      item.fileName,
      item.summary,
      item.sourceTaskTitle,
      item.contentType,
      item.sourceLabel,
    ].some((field) => String(field || '').toLowerCase().includes(searchTerm));
  });

  return filtered.sort((left, right) => (
    state.memoryDocSortOrder === 'oldest'
      ? left.updatedAt.localeCompare(right.updatedAt)
      : right.updatedAt.localeCompare(left.updatedAt)
  ));
}

function setMemoryDocFilter(filter) {
  state.memoryDocFilter = filter === 'task' ? 'task' : 'all';
  void syncVisibleMemoryDocSelection();
}

function setMemoryDocSearchTerm(value) {
  state.memoryDocSearchTerm = String(value || '').trim();
  void syncVisibleMemoryDocSelection();
}

function setMemoryDocKindFilter(value) {
  state.memoryDocKindFilter = value || 'all';
  void syncVisibleMemoryDocSelection();
}

function setMemoryDocSortOrder(value) {
  state.memoryDocSortOrder = value === 'oldest' ? 'oldest' : 'newest';
  void syncVisibleMemoryDocSelection();
}

async function syncVisibleMemoryDocSelection() {
  const visibleDocs = getVisibleMemoryDocs();
  if (!visibleDocs.length) {
    state.selectedMemoryDocId = null;
    state.selectedMemoryDoc = null;
    renderMemoryDocs();
    renderMemoryDocumentPreview();
    return;
  }

  const selectedVisible = visibleDocs.some((doc) => doc.id === state.selectedMemoryDocId);
  if (selectedVisible) {
    renderMemoryDocs();
    renderMemoryDocumentPreview();
    return;
  }

  state.selectedMemoryDocId = visibleDocs[0].id;
  try {
    state.selectedMemoryDoc = await fetchJson(`/api/memory/docs/${encodeURIComponent(state.selectedMemoryDocId)}`);
  } catch {
    state.selectedMemoryDoc = null;
  }

  renderMemoryDocs();
  renderMemoryDocumentPreview();
}

function renderTaskList() {
  fillList(
    'task-list',
    state.taskList,
    (task) => {
      const rawTask = state.tasks.find((item) => item.id === task.id) || null;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'task-card';
      if (task.id === state.selectedTaskId) {
        item.classList.add('is-active');
      }

      const top = document.createElement('div');
      top.className = 'task-card-top';

      const title = document.createElement('strong');
      title.className = 'task-title';
      title.textContent = getDisplayTaskTitle(task, rawTask);

      const status = document.createElement('span');
      status.className = 'status-pill';
      status.dataset.status = task.status;
      status.textContent = task.statusLabel || getTaskStatusLabel(task.status);

      const meta = document.createElement('p');
      meta.className = 'task-meta';
      meta.textContent = `${getRiskLabel(task.riskLevel)} · ${formatDateTime(task.updatedAt) || '刚刚更新'}`;

      const summary = document.createElement('p');
      summary.className = 'task-summary';
      summary.textContent = compactTextValue(
        task.summary
          || rawTask?.workspace?.summary
          || rawTask?.progressSummary
          || rawTask?.resultSummary
          || rawTask?.sourceTranscript
          || '暂无摘要。',
        120,
      );

      top.append(title, status);
      item.append(top, meta, summary);
      item.addEventListener('click', () => {
        state.selectedTaskId = task.id;
        void refreshState();
      });
      return item;
    },
    '当前没有后台任务。',
  );
}

function renderTaskDetail() {
  const task = getSelectedTask();
  const taskCard = getSelectedTaskCard();
  const taskDetail = state.selectedTaskDetail;
  const approveButton = document.getElementById('approve-button');
  const cancelButton = document.getElementById('cancel-button');
  const status = document.getElementById('detail-status');

  if (!task) {
    setText('detail-title', '等待任务');
    setText('detail-stage', '等待任务');
    setText('detail-request', '当前还没有可展示的用户请求。');
    setText('detail-summary', '当前没有后台任务。');
    setText('detail-result', '任务完成后会在这里显示结果摘要。');
    setText('decision-title', '当前没有待确认任务');
    setText('decision-summary', '当任务进入等待确认状态时，这里会把最关键的说明单独提出来。');
    if (status) {
      status.dataset.status = 'idle';
      status.textContent = '空闲';
    }
    setVisible('decision-card', false);
    fillList('detail-timeline', [], (item) => item, '还没有任务时间线。');
    fillList('detail-notes', [], (item) => item, '当前没有备注。');
    fillList('detail-memory-docs', [], (item) => item, '这个任务还没有关联记忆文档。');
    return;
  }

  const workspace = task.workspace || null;
  const decisionVisible = task.status === 'waiting_user';
  const timeline = buildTaskTimeline(task, state.selectedTimeline);

  setText('detail-title', getDisplayTaskTitle(taskDetail || task, task));
  setText('detail-stage', taskDetail?.currentStage || workspace?.mode || getTaskStatusLabel(task.status));
  setText('detail-request', compactTextValue(taskDetail?.sourceTranscript || task.sourceTranscript || '当前还没有可展示的用户请求。', 140));
  setText('detail-summary', taskDetail?.summary || workspace?.summary || taskCard?.summary || task.progressSummary || '暂无摘要。');
  setText('detail-result', taskDetail?.result || task.resultSummary || workspace?.outcome?.summary || '任务仍在推进中。');
  setText('decision-title', decisionVisible ? '这个任务现在需要你确认' : '当前没有待确认任务');
  setText('decision-summary', getDecisionSummary(task));
  if (status) {
    status.dataset.status = task.status;
    status.textContent = taskDetail?.statusLabel || taskCard?.statusLabel || getTaskStatusLabel(task.status);
  }

  setVisible('decision-card', decisionVisible);

  fillList(
    'detail-timeline',
    timeline,
    (item) => {
      const element = document.createElement('div');
      element.className = 'timeline-item';
      element.dataset.tone = item.tone || 'pending';

      const marker = document.createElement('div');
      marker.className = 'timeline-marker';

      const body = document.createElement('div');
      body.className = 'timeline-body';

      const title = document.createElement('strong');
      title.textContent = item.title;

      const summary = document.createElement('p');
      summary.className = 'stack-copy';
      summary.textContent = item.summary || '暂无说明。';

      body.append(title, summary);
      if (item.meta) {
        const meta = document.createElement('span');
        meta.className = 'timeline-meta';
        meta.textContent = item.meta;
        body.appendChild(meta);
      }

      element.append(marker, body);
      return element;
    },
    '还没有任务时间线。',
  );

  fillList(
    'detail-notes',
    taskDetail?.notes || workspace?.notes || [],
    (note) => {
      const item = document.createElement('div');
      item.className = 'stack-item';
      item.textContent = note;
      return item;
    },
    '当前没有备注。',
  );

  fillList(
    'detail-memory-docs',
    getTaskDetailMemoryDocs(),
    (entry) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'task-card memory-doc-card';
      if (entry.id === state.selectedMemoryDocId) {
        item.classList.add('is-active');
      }

      const top = document.createElement('div');
      top.className = 'task-card-top';

      const title = document.createElement('strong');
      title.className = 'task-title';
      title.textContent = entry.label || entry.fileName || '记忆文档';

      const meta = document.createElement('span');
      meta.className = 'memory-doc-source';
      meta.textContent = `${entry.sourceLabel || '文档'} · ${entry.contentType || 'text'}`;

      const summary = document.createElement('p');
      summary.className = 'task-summary';
      summary.textContent = entry.summary || '暂无摘要。';

      top.append(title, meta);
      item.append(top, summary);
      item.addEventListener('click', () => {
        state.memoryDocFilter = 'task';
        state.selectedMemoryDocId = entry.id;
        void refreshState();
      });
      return item;
    },
    '这个任务还没有关联记忆文档。',
  );

  if (approveButton) {
    approveButton.disabled = task.status !== 'waiting_user';
    approveButton.onclick = task.status === 'waiting_user'
      ? () => mutateTask(task.id, 'approve')
      : null;
  }

  if (cancelButton) {
    cancelButton.disabled = task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed';
    cancelButton.onclick = cancelButton.disabled
      ? null
      : () => mutateTask(task.id, 'cancel');
  }
}

function renderMemoryOverview(payload) {
  const overview = normalizeMemoryOverview(payload);

  setText('memory-identity-title', overview.identityTitle || '当前没有身份摘要。');

  fillList(
    'memory-identity-notes',
    overview.identityNotes || [],
    (note) => {
      const item = document.createElement('div');
      item.className = 'memory-pill';
      item.textContent = typeof note === 'string' ? note : note.summary || note.title || '暂无说明';
      return item;
    },
    '这里会显示桌宠的身份说明和最近的身份变化。',
  );

  fillList(
    'memory-preferences',
    overview.preferences || [],
    (preference) => {
      const item = document.createElement('div');
      item.className = 'memory-pill';
      item.textContent = typeof preference === 'string'
        ? preference
        : preference.summary || preference.label || '暂无偏好摘要';
      return item;
    },
    '这里会显示长期偏好，例如语言、执行风格和桌宠体验偏好。',
  );

  fillList(
    'memory-recent-work',
    overview.recentWork || [],
    (entry) => {
      const item = document.createElement('div');
      item.className = 'stack-item';

      const title = document.createElement('strong');
      title.textContent = entry.title || entry.label || '最近任务沉淀';

      const summary = document.createElement('p');
      summary.className = 'stack-copy';
      summary.textContent = entry.summary || '暂无摘要。';

      item.append(title, summary);
      if (entry.updatedAt || entry.timestamp) {
        const meta = document.createElement('span');
        meta.className = 'timeline-meta';
        meta.textContent = formatDateTime(entry.updatedAt || entry.timestamp);
        item.appendChild(meta);
      }

      return item;
    },
    '这里会显示最近的任务沉淀与记忆文档入口。',
  );

  fillList(
    'memory-highlights',
    overview.highlights || [],
    (entry) => {
      const item = document.createElement('div');
      item.className = 'stack-item';

      const title = document.createElement('strong');
      title.textContent = entry.title || '长期记忆高亮';

      const summary = document.createElement('p');
      summary.className = 'stack-copy';
      summary.textContent = entry.summary || '暂无摘要。';

      item.append(title, summary);
      if (entry.updatedAt) {
        const meta = document.createElement('span');
        meta.className = 'timeline-meta';
        meta.textContent = formatDateTime(entry.updatedAt);
        item.appendChild(meta);
      }

      return item;
    },
    '这里会显示沉淀下来的长期经验和稳定工作方式。',
  );
}

function renderMemoryDocs() {
  renderMemoryDocFilters();
  fillList(
    'memory-doc-list',
    getVisibleMemoryDocs(),
    (entry) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'task-card memory-doc-card';
      if (entry.id === state.selectedMemoryDocId) {
        item.classList.add('is-active');
      }

      const top = document.createElement('div');
      top.className = 'task-card-top';

      const title = document.createElement('strong');
      title.className = 'task-title';
      title.textContent = entry.label || entry.fileName || '记忆文档';

      const meta = document.createElement('span');
      meta.className = 'memory-doc-source';
      meta.textContent = `${entry.sourceLabel || '文档'} · ${entry.contentType || 'text'}`;

      const summary = document.createElement('p');
      summary.className = 'task-summary';
      summary.textContent = entry.summary || '暂无摘要。';

      const subMeta = document.createElement('p');
      subMeta.className = 'task-meta';
      subMeta.textContent = entry.updatedAt
        ? `${formatDateTime(entry.updatedAt)}${entry.sourceTaskTitle ? ` · ${getDisplayMemorySourceTitle(entry.sourceTaskTitle)}` : ''}`
        : (getDisplayMemorySourceTitle(entry.sourceTaskTitle) || '记忆文档');

      top.append(title, meta);
      item.append(top, subMeta, summary);
      item.addEventListener('click', () => {
        state.selectedMemoryDocId = entry.id;
        void refreshState();
      });
      return item;
    },
    '这里会显示可追溯的记忆文档入口。',
  );
}

function renderMemoryDocFilters() {
  const allButton = document.getElementById('memory-doc-filter-all');
  const taskButton = document.getElementById('memory-doc-filter-task');
  const kindAllButton = document.getElementById('memory-doc-kind-all');
  const kindTaskMemoryButton = document.getElementById('memory-doc-kind-task_memory');
  const kindJournalButton = document.getElementById('memory-doc-kind-journal');
  const searchInput = document.getElementById('memory-doc-search');
  const sortSelect = document.getElementById('memory-doc-sort');
  const hasTaskScopedDocs = getTaskDetailMemoryDocs().length > 0;

  if (allButton) {
    allButton.classList.toggle('is-active', state.memoryDocFilter === 'all');
    allButton.onclick = () => {
      setMemoryDocFilter('all');
    };
  }

  if (taskButton) {
    taskButton.disabled = !hasTaskScopedDocs;
    taskButton.classList.toggle('is-active', state.memoryDocFilter === 'task');
    taskButton.onclick = hasTaskScopedDocs
      ? () => {
        setMemoryDocFilter('task');
      }
      : null;
  }

  if (searchInput && searchInput.value !== state.memoryDocSearchTerm) {
    searchInput.value = state.memoryDocSearchTerm;
  }

  if (kindAllButton) {
    kindAllButton.classList.toggle('is-active', state.memoryDocKindFilter === 'all');
    kindAllButton.onclick = () => {
      setMemoryDocKindFilter('all');
    };
  }

  if (kindTaskMemoryButton) {
    kindTaskMemoryButton.classList.toggle('is-active', state.memoryDocKindFilter === 'task_memory');
    kindTaskMemoryButton.onclick = () => {
      setMemoryDocKindFilter('task_memory');
    };
  }

  if (kindJournalButton) {
    kindJournalButton.classList.toggle('is-active', state.memoryDocKindFilter === 'journal');
    kindJournalButton.onclick = () => {
      setMemoryDocKindFilter('journal');
    };
  }

  if (sortSelect && sortSelect.value !== state.memoryDocSortOrder) {
    sortSelect.value = state.memoryDocSortOrder;
  }
}

function renderMemoryDocumentPreview() {
  const selectedDocCard = getSelectedMemoryDocCard();
  const detail = state.selectedMemoryDoc;
  const sourceTaskButton = document.getElementById('memory-doc-source-button');
  setText('memory-doc-title', selectedDocCard?.label || detail?.label || '记忆文档预览');
  setText(
    'memory-doc-meta',
    selectedDocCard?.sourceTaskTitle
      ? `${getDisplayMemorySourceTitle(selectedDocCard.sourceTaskTitle)} · ${formatDateTime(selectedDocCard.updatedAt)}`
      : (selectedDocCard?.updatedAt ? formatDateTime(selectedDocCard.updatedAt) : '选择一份记忆文档查看摘要和正文。'),
  );

  const preview = document.getElementById('memory-doc-preview');
  if (!preview) {
    return;
  }

  preview.textContent = detail?.content || '当前还没有选中的记忆文档。';
  preview.dataset.contentType = detail?.contentType || 'text';

  if (sourceTaskButton) {
    const sourceTaskId = selectedDocCard?.sourceTaskId || detail?.sourceTaskId || null;
    sourceTaskButton.disabled = !sourceTaskId;
    sourceTaskButton.onclick = sourceTaskId
      ? () => {
        state.selectedTaskId = sourceTaskId;
        state.memoryDocFilter = 'task';
        void refreshState();
      }
      : null;
  }
}

function renderSummary(payload) {
  const dashboard = normalizeDashboard(payload);
  const refreshButton = document.getElementById('refresh-button');

  setText('session-status', getSessionStatusLabel(dashboard.session?.status || (state.requestError ? 'error' : '')));
  setText('last-transcript', compactTextValue(dashboard.latestTranscript || '-', 30));
  setText('auto-execute-state', dashboard.autoExecute ? '开启' : '关闭');
  setText('active-task-count', String(dashboard.activeTaskCount || 0));
  setText('waiting-approval-count', String(dashboard.waitingApprovalCount || 0));
  setText('companion-name', dashboard.companion?.displayName || '未同步');
  setText(
    'hero-summary',
    state.requestError
      ? `${state.requestError}，控制面板会继续自动重试。`
      : dashboard.waitingApprovalCount > 0
        ? '现在有任务卡在等待确认的节点，先看详情区顶部的决策卡，再决定是否继续推进。'
        : dashboard.activeTask
          ? '这里是 CelCat 的本地工作台，桌宠主界面负责陪伴，这里负责看结果、批任务和追记忆。'
          : '当前没有活跃阻塞项，这里会继续汇聚任务、确认动作和长期记忆，作为 CelCat 的本地工作台。',
  );

  if (refreshButton) {
    refreshButton.disabled = state.isRefreshing;
    refreshButton.textContent = state.isRefreshing ? '刷新中...' : '刷新';
  }

  if (document.body && document.body.dataset) {
    document.body.dataset.sessionState = dashboard.session?.status || (state.requestError ? 'error' : 'idle');
    document.body.dataset.workspaceMode = dashboard.waitingApprovalCount > 0
      ? 'waiting_user'
      : dashboard.activeTaskCount > 0
        ? 'active'
        : 'idle';
  }

  setText('hero-focus-title', dashboard.activeTask ? getDisplayTaskTitle(dashboard.activeTask, getSelectedTask()) : '工作台已准备好');
  setText('hero-focus-summary', getHeroFocusSummary(dashboard));
  setText('hero-generated-at', payload?.generatedAt ? formatDateTime(payload.generatedAt) : '等待同步');
}

function getMutationErrorMessage(action, error) {
  if (error && typeof error.message === 'string' && error.message) {
    return error.message;
  }

  return `任务${action === 'approve' ? '审批' : '取消'}失败，请稍后再试。`;
}

function getRefreshErrorMessage(error) {
  if (error && typeof error.message === 'string' && error.message) {
    return error.message;
  }

  return '控制面板暂时无法连接本地服务';
}

function getCurrentRenderPayload() {
  return {
    ...(state.lastPayload || {}),
    dashboard: state.dashboard || state.lastPayload?.dashboard || null,
    memoryOverview: state.memoryOverview || state.lastPayload?.memoryOverview || null,
  };
}

async function mutateTask(taskId, action) {
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/${action}`, {
      method: 'POST',
      headers: {
        'X-CelCat-Request': 'control-panel',
      },
    });
    if (!response.ok) {
      throw new Error(`任务${action === 'approve' ? '审批' : '取消'}失败`);
    }

    state.requestError = '';
    await refreshState();
  } catch (error) {
    const message = getMutationErrorMessage(action, error);
    state.requestError = message;
    renderSummary(state.lastPayload || { latestTask: getSelectedTask() });
    window.alert(message);
  }
}

async function refreshState() {
  state.isRefreshing = true;
  renderSummary(state.lastPayload ? getCurrentRenderPayload() : {
    latestTask: getSelectedTask(),
    session: null,
    settings: null,
    tasks: state.tasks,
  });
  try {
    const payload = await fetchJson('/api/state');
    state.lastPayload = payload;
    state.tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    state.taskList = Array.isArray(payload.taskList) ? payload.taskList : state.tasks;
    state.requestError = '';

    if (!state.selectedTaskId || !state.tasks.some((task) => task.id === state.selectedTaskId)) {
      state.selectedTaskId = payload.latestTask?.id || state.tasks[0]?.id || null;
    }

    const selectedTaskId = state.selectedTaskId;
    const [
      taskListResult,
      dashboardResult,
      memoryResult,
      memoryDocsResult,
      taskDetailResult,
      timelineResult,
    ] = await Promise.allSettled([
      fetchJson('/api/tasks'),
      fetchJson('/api/dashboard'),
      fetchJson('/api/memory/overview'),
      fetchJson('/api/memory/docs'),
      selectedTaskId ? fetchJson(`/api/tasks/${encodeURIComponent(selectedTaskId)}/detail`) : Promise.resolve(null),
      selectedTaskId ? fetchJson(`/api/tasks/${encodeURIComponent(selectedTaskId)}/timeline`) : Promise.resolve(null),
    ]);

    state.taskList = taskListResult.status === 'fulfilled'
      ? taskListResult.value
      : state.taskList;
    state.dashboard = dashboardResult.status === 'fulfilled'
      ? dashboardResult.value
      : payload.dashboard || null;
    state.memoryOverview = memoryResult.status === 'fulfilled'
      ? memoryResult.value
      : payload.memoryOverview || null;
    state.memoryDocs = memoryDocsResult.status === 'fulfilled'
      ? memoryDocsResult.value
      : state.memoryDocs;
    state.selectedTaskDetail = taskDetailResult.status === 'fulfilled'
      ? taskDetailResult.value
      : null;
    state.selectedTimeline = timelineResult.status === 'fulfilled'
      ? timelineResult.value
      : null;

    if (state.memoryDocFilter === 'task' && getTaskDetailMemoryDocs().length === 0) {
      state.memoryDocFilter = 'all';
    }

    const visibleDocs = getVisibleMemoryDocs();
    if (!state.selectedMemoryDocId || !visibleDocs.some((doc) => doc.id === state.selectedMemoryDocId)) {
      state.selectedMemoryDocId = visibleDocs[0]?.id || state.memoryDocs[0]?.id || null;
    }

    const selectedMemoryDocResult = state.selectedMemoryDocId
      ? await Promise.allSettled([
        fetchJson(`/api/memory/docs/${encodeURIComponent(state.selectedMemoryDocId)}`),
      ])
      : [{ status: 'fulfilled', value: null }];
    state.selectedMemoryDoc = selectedMemoryDocResult[0]?.status === 'fulfilled'
      ? selectedMemoryDocResult[0].value
      : null;

    const renderPayload = {
      ...payload,
      dashboard: state.dashboard,
      memoryOverview: state.memoryOverview,
    };

    renderSummary(renderPayload);
    renderTaskList();
    renderTaskDetail();
    renderMemoryOverview(renderPayload);
    renderMemoryDocs();
    renderMemoryDocumentPreview();
  } catch (error) {
    state.requestError = getRefreshErrorMessage(error);
    renderSummary(state.lastPayload || {
      latestTask: getSelectedTask(),
      session: null,
      settings: null,
      tasks: state.tasks,
    });
    renderTaskList();
    renderTaskDetail();
    renderMemoryOverview(state.lastPayload || { latestTask: null, settings: null });
    renderMemoryDocs();
    renderMemoryDocumentPreview();
  } finally {
    state.isRefreshing = false;
    renderSummary(state.lastPayload ? getCurrentRenderPayload() : {
      latestTask: getSelectedTask(),
      session: null,
      settings: null,
      tasks: state.tasks,
    });
  }
}

function startPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }

  state.pollTimer = setInterval(() => {
    void refreshState();
  }, 2000);
}

if (globalThis.__CELCAT_CONTROL_PANEL_TEST__) {
  globalThis.__CELCAT_CONTROL_PANEL_TEST__.api = {
    getTaskStatusLabel,
    getStepStatusLabel,
    getMutationErrorMessage,
    getRefreshErrorMessage,
    normalizeDashboard,
    normalizeMemoryOverview,
    buildTaskTimeline,
    getDecisionSummary,
    refreshState,
    mutateTask,
    renderTaskDetail,
    renderSummary,
    renderMemoryOverview,
    renderMemoryDocs,
    renderMemoryDocFilters,
    renderMemoryDocumentPreview,
    setMemoryDocFilter,
    setMemoryDocKindFilter,
    setMemoryDocSortOrder,
    setMemoryDocSearchTerm,
    getVisibleMemoryDocs,
    state,
  };
}

if (!globalThis.__CELCAT_CONTROL_PANEL_DISABLE_BOOTSTRAP__) {
  document.getElementById('refresh-button')?.addEventListener('click', () => {
    void refreshState();
  });
  document.getElementById('memory-doc-filter-all')?.addEventListener('click', () => {
    setMemoryDocFilter('all');
  });
  document.getElementById('memory-doc-filter-task')?.addEventListener('click', () => {
    setMemoryDocFilter('task');
  });
  document.getElementById('memory-doc-search')?.addEventListener('input', (event) => {
    setMemoryDocSearchTerm(event.target?.value);
  });
  document.getElementById('memory-doc-kind-all')?.addEventListener('click', () => {
    setMemoryDocKindFilter('all');
  });
  document.getElementById('memory-doc-kind-task_memory')?.addEventListener('click', () => {
    setMemoryDocKindFilter('task_memory');
  });
  document.getElementById('memory-doc-kind-journal')?.addEventListener('click', () => {
    setMemoryDocKindFilter('journal');
  });
  document.getElementById('memory-doc-sort')?.addEventListener('change', (event) => {
    setMemoryDocSortOrder(event.target?.value);
  });

  void refreshState();
  startPolling();
}
