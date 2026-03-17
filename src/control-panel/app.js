const state = {
  tasks: [],
  selectedTaskId: null,
  pollTimer: null,
};

function getStatusLabel(status) {
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
      return '未知';
  }
}

function formatEmpty(text) {
  const item = document.createElement('div');
  item.className = 'empty';
  item.textContent = text;
  return item;
}

function createStatusPill(status) {
  const pill = document.createElement('span');
  pill.className = 'status-pill';
  pill.dataset.status = status || 'idle';
  pill.textContent = getStatusLabel(status);
  return pill;
}

function renderTaskList() {
  const container = document.getElementById('task-list');
  if (!container) {
    return;
  }

  container.innerHTML = '';
  if (!state.tasks.length) {
    container.appendChild(formatEmpty('当前没有后台任务。'));
    return;
  }

  for (const task of state.tasks) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'task-card';
    if (task.id === state.selectedTaskId) {
      item.classList.add('is-active');
    }

    const head = document.createElement('div');
    head.className = 'task-card-head';

    const title = document.createElement('div');
    title.className = 'task-card-title';
    title.textContent = task.title;

    head.append(title, createStatusPill(task.status));

    const copy = document.createElement('div');
    copy.className = 'task-card-copy';
    copy.textContent = task.progressSummary || task.resultSummary || '暂无进度摘要。';

    item.append(head, copy);
    item.addEventListener('click', () => {
      state.selectedTaskId = task.id;
      renderTaskList();
      renderTaskDetail();
    });
    container.appendChild(item);
  }
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function fillList(containerId, values, renderItem) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  container.innerHTML = '';
  if (!values.length) {
    container.appendChild(formatEmpty('暂无内容。'));
    return;
  }

  for (const value of values) {
    container.appendChild(renderItem(value));
  }
}

function renderTaskDetail() {
  const task = state.tasks.find((item) => item.id === state.selectedTaskId) || null;
  const statusElement = document.getElementById('detail-status');
  const actions = document.getElementById('detail-actions');
  const approveButton = document.getElementById('approve-button');
  const cancelButton = document.getElementById('cancel-button');

  if (!task) {
    setText('detail-title', '等待任务');
    setText('detail-summary', '当前没有后台任务。');
    setText('detail-result', '任务完成后会在这里显示结果摘要。');
    setText('detail-mission', '暂无任务目标');
    setText('detail-context', '暂无压缩上下文');
    if (statusElement) {
      statusElement.dataset.status = 'idle';
      statusElement.textContent = '空闲';
    }
    actions && (actions.style.display = 'none');
    fillList('detail-notes', [], (note) => {
      const item = document.createElement('div');
      item.className = 'stack-item';
      item.textContent = note;
      return item;
    });
    fillList('detail-skills', [], (capability) => capability);
    fillList('detail-mcps', [], (capability) => capability);
    fillList('detail-steps', [], (step) => step);
    fillList('detail-artifacts', [], (artifact) => artifact);
    fillList('detail-memory', [], (memory) => memory);
    return;
  }

  const workspace = task.workspace || null;
  setText('detail-title', task.title);
  setText('detail-summary', workspace?.summary || task.progressSummary || '暂无摘要。');
  setText('detail-result', task.resultSummary || workspace?.outcome?.summary || '任务仍在推进中。');
  setText('detail-mission', workspace?.mission || task.sourceTranscript || '暂无任务目标');
  setText('detail-context', workspace?.compressedContext || '暂无压缩上下文');
  if (statusElement) {
    statusElement.dataset.status = task.status;
    statusElement.textContent = getStatusLabel(task.status);
  }

  fillList('detail-notes', workspace?.notes || [], (note) => {
    const item = document.createElement('div');
    item.className = 'stack-item';
    item.textContent = note;
    return item;
  });

  fillList('detail-skills', workspace?.skills || [], (capability) => {
    const item = document.createElement('div');
    item.className = 'chip';
    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = capability.label;
    const reason = document.createElement('span');
    reason.textContent = capability.reason;
    item.append(label, reason);
    return item;
  });

  fillList('detail-mcps', workspace?.mcps || [], (capability) => {
    const item = document.createElement('div');
    item.className = 'chip';
    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = capability.label;
    const reason = document.createElement('span');
    reason.textContent = capability.reason;
    item.append(label, reason);
    return item;
  });

  fillList('detail-steps', workspace?.steps || [], (step) => {
    const item = document.createElement('div');
    item.className = 'step-item';
    const title = document.createElement('div');
    title.className = 'step-title';
    title.textContent = `${step.title} · ${step.status}`;
    const summary = document.createElement('div');
    summary.className = 'step-summary';
    summary.textContent = step.summary;
    item.append(title, summary);
    return item;
  });

  fillList('detail-artifacts', workspace?.artifacts || [], (artifact) => {
    const item = document.createElement('div');
    item.className = 'artifact-item';
    const label = document.createElement('div');
    label.className = 'artifact-label';
    label.textContent = artifact.label;
    const content = document.createElement('div');
    content.className = 'artifact-content';
    content.textContent = artifact.content;
    item.append(label, content);
    return item;
  });

  fillList('detail-memory', workspace?.memoryRefs || [], (memoryRef) => {
    const item = document.createElement('div');
    item.className = 'memory-item';
    const label = document.createElement('div');
    label.className = 'memory-label';
    label.textContent = memoryRef.label;
    const summary = document.createElement('div');
    summary.className = 'memory-summary';
    summary.textContent = memoryRef.summary;
    const pathLabel = document.createElement('div');
    pathLabel.className = 'memory-path';
    pathLabel.textContent = memoryRef.path;
    item.append(label, summary, pathLabel);
    return item;
  });

  if (actions) {
    actions.style.display = 'flex';
  }

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

function renderSummary(payload) {
  setText('session-status', payload.session?.status || '未启动');
  setText('last-transcript', payload.session?.lastTranscript || '-');
  setText('auto-execute-state', payload.settings?.autoExecute ? '开启' : '关闭');
  setText(
    'hero-summary',
    payload.latestTask
      ? `当前最近任务：${payload.latestTask.title}。控制面板与桌宠主界面分离，后台细节只保留在这里。`
      : '本地控制面板用于查看 agent 工作区、任务执行状态和审批操作。',
  );
}

async function mutateTask(taskId, action) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/${action}`, {
    method: 'POST',
  });
  if (!response.ok) {
    window.alert(`任务${action === 'approve' ? '审批' : '取消'}失败`);
    return;
  }

  await refreshState();
}

async function refreshState() {
  const response = await fetch('/api/state', {
    cache: 'no-store',
  });
  const payload = await response.json();
  state.tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  if (!state.selectedTaskId || !state.tasks.some((task) => task.id === state.selectedTaskId)) {
    state.selectedTaskId = payload.latestTask?.id || state.tasks[0]?.id || null;
  }
  renderSummary(payload);
  renderTaskList();
  renderTaskDetail();
}

function startPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }

  state.pollTimer = setInterval(() => {
    void refreshState();
  }, 2000);
}

document.getElementById('refresh-button')?.addEventListener('click', () => {
  void refreshState();
});

void refreshState();
startPolling();
