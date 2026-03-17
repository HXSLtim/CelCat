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
      return '空闲';
  }
}

function createEmpty(text) {
  const element = document.createElement('div');
  element.className = 'empty';
  element.textContent = text;
  return element;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function renderTaskList() {
  const container = document.getElementById('task-list');
  if (!container) {
    return;
  }

  container.innerHTML = '';
  if (!state.tasks.length) {
    container.appendChild(createEmpty('当前没有后台任务。'));
    return;
  }

  for (const task of state.tasks) {
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
    title.textContent = task.title;

    const status = document.createElement('span');
    status.className = 'status-pill';
    status.dataset.status = task.status;
    status.textContent = getStatusLabel(task.status);

    const summary = document.createElement('p');
    summary.className = 'task-summary';
    summary.textContent = task.progressSummary || task.resultSummary || '暂无摘要。';

    top.append(title, status);
    item.append(top, summary);
    item.addEventListener('click', () => {
      state.selectedTaskId = task.id;
      renderTaskList();
      renderTaskDetail();
    });
    container.appendChild(item);
  }
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

function renderTaskDetail() {
  const task = state.tasks.find((item) => item.id === state.selectedTaskId) || null;
  const actions = document.getElementById('detail-actions');
  const approveButton = document.getElementById('approve-button');
  const cancelButton = document.getElementById('cancel-button');
  const status = document.getElementById('detail-status');

  if (!task) {
    setText('detail-title', '等待任务');
    setText('detail-summary', '当前没有后台任务。');
    setText('detail-result', '任务完成后会在这里显示结果摘要。');
    if (status) {
      status.dataset.status = 'idle';
      status.textContent = '空闲';
    }
    if (actions) {
      actions.style.display = 'none';
    }
    fillList('detail-steps', [], (item) => item, '还没有步骤。');
    fillList('detail-notes', [], (item) => item, '当前没有备注。');
    return;
  }

  const workspace = task.workspace || null;
  setText('detail-title', task.title);
  setText('detail-summary', workspace?.summary || task.progressSummary || '暂无摘要。');
  setText('detail-result', task.resultSummary || workspace?.outcome?.summary || '任务仍在推进中。');
  if (status) {
    status.dataset.status = task.status;
    status.textContent = getStatusLabel(task.status);
  }

  fillList(
    'detail-steps',
    workspace?.steps || [],
    (step) => {
      const item = document.createElement('div');
      item.className = 'stack-item';

      const title = document.createElement('strong');
      title.textContent = `${step.title} · ${getStatusLabel(step.status)}`;

      const summary = document.createElement('p');
      summary.className = 'stack-copy';
      summary.textContent = step.summary;

      item.append(title, summary);
      return item;
    },
    '还没有步骤。',
  );

  fillList(
    'detail-notes',
    workspace?.notes || [],
    (note) => {
      const item = document.createElement('div');
      item.className = 'stack-item';
      item.textContent = note;
      return item;
    },
    '当前没有备注。',
  );

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
      ? '后台任务细节都放在这里，桌宠主界面只负责陪伴和交互。'
      : '这是第一版简化控制面板，用来看任务状态和手动确认。',
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
  const response = await fetch('/api/state', { cache: 'no-store' });
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
