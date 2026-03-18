import fs from 'node:fs';
import path from 'node:path';
import type { SessionSnapshot } from '../../types/session';
import type { AgentWorkspaceStepStatus, TaskRecord, TaskStatus } from '../../types/tasks';
import type { UserSettings } from '../../types/settings';

type StoredRecentMemory = {
  title: string;
  kind: TaskRecord['kind'];
  sourceTranscript: string;
  compressedContext: string;
  resultSummary: string;
  updatedAt: string;
  outcomeStatus?: 'in_progress' | 'ready' | 'needs_attention';
  outcomeConfidence?: number;
  blockers?: string[];
  nextActions?: string[];
};

type StoredLongTermMemory = {
  category: 'preferences' | 'patterns' | 'failures' | 'recipes';
  title: string;
  summary: string;
  evidence: string;
  updatedAt: string;
};

type StoredCompanionIdentity = {
  displayName: string;
  identityNotes: string[];
  updatedAt: string;
};

type MemoryFiles = {
  baseDir: string;
  journalPath: string;
  recentMemoryPath: string;
  longTermMemoryPath: string;
  companionIdentityPath: string;
};

export type ControlPanelTaskListItem = {
  id: string;
  title: string;
  kind: TaskRecord['kind'];
  status: TaskRecord['status'];
  statusLabel: string;
  riskLevel: TaskRecord['riskLevel'];
  updatedAt: string;
  summary: string;
  requiresConfirmation: boolean;
};

export type ControlPanelDashboard = {
  generatedAt: string;
  session: {
    status: SessionSnapshot['status'];
    connected: boolean;
    latestTranscript: string;
    latestAssistantMessage: string;
    error: string;
  } | null;
  activeTask: ControlPanelTaskListItem | null;
  taskCounts: {
    total: number;
    active: number;
    waitingUser: number;
    completed: number;
    failed: number;
  };
  latestTranscript: string;
  autoExecute: boolean;
  companion: {
    displayName: string;
    identitySummary: string;
  } | null;
  memoryDigest: {
    stablePreferenceCount: number;
    recentWorkCount: number;
    longTermHighlightCount: number;
  };
};

export type ControlPanelTaskTimelineEntry = {
  id: string;
  kind: 'task' | 'step' | 'approval' | 'result';
  label: string;
  summary: string;
  status: 'completed' | 'in_progress' | 'pending' | 'blocked' | 'info';
  timestamp: string;
};

export type ControlPanelTaskTimeline = {
  taskId: string;
  title: string;
  status: TaskRecord['status'];
  statusLabel: string;
  requiresConfirmation: boolean;
  currentStage: string;
  timeline: ControlPanelTaskTimelineEntry[];
};

export type ControlPanelTaskDetail = {
  id: string;
  title: string;
  kind: TaskRecord['kind'];
  status: TaskRecord['status'];
  statusLabel: string;
  riskLevel: TaskRecord['riskLevel'];
  summary: string;
  result: string;
  currentStage: string;
  sourceTranscript: string;
  notes: string[];
  requiresConfirmation: boolean;
  updatedAt: string;
  relatedMemoryDocs: ControlPanelMemoryDocumentListItem[];
};

export type ControlPanelMemoryOverview = {
  identity: {
    displayName: string;
    identityNotes: string[];
    updatedAt: string;
  } | null;
  stablePreferences: string[];
  recentWork: Array<{
    title: string;
    kind: TaskRecord['kind'];
    updatedAt: string;
    summary: string;
    outcomeStatus: StoredRecentMemory['outcomeStatus'] | null;
  }>;
  longTermHighlights: Array<{
    category: StoredLongTermMemory['category'];
    title: string;
    summary: string;
    updatedAt: string;
  }>;
};

export type ControlPanelMemoryDocumentListItem = {
  id: string;
  label: string;
  fileName: string;
  contentType: 'markdown' | 'json' | 'text';
  sourceKind: 'task_memory' | 'journal' | 'memory_data' | 'other';
  sourceLabel: string;
  summary: string;
  updatedAt: string;
  sourceTaskId: string | null;
  sourceTaskTitle: string | null;
};

export type ControlPanelMemoryDocumentDetail = {
  id: string;
  label: string;
  fileName: string;
  path: string;
  contentType: 'markdown' | 'json' | 'text';
  summary: string;
  updatedAt: string;
  sourceTaskId: string | null;
  sourceTaskTitle: string | null;
  content: string;
};

export function buildControlPanelTaskList(tasks: TaskRecord[]): ControlPanelTaskListItem[] {
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    kind: task.kind,
    status: task.status,
    statusLabel: getTaskStatusLabel(task.status),
    riskLevel: task.riskLevel,
    updatedAt: task.updatedAt,
    summary: getTaskSummary(task),
    requiresConfirmation: task.status === 'waiting_user' || Boolean(task.workspace?.requiresConfirmation),
  }));
}

export function buildControlPanelDashboard(input: {
  session: SessionSnapshot | null;
  latestTask: TaskRecord | null;
  tasks: TaskRecord[];
  settings: UserSettings;
  memoryOverview: ControlPanelMemoryOverview;
}): ControlPanelDashboard {
  const taskList = buildControlPanelTaskList(input.tasks);

  return {
    generatedAt: new Date().toISOString(),
    session: input.session
      ? {
        status: input.session.status,
        connected: input.session.connected,
        latestTranscript: input.session.lastTranscript || '',
        latestAssistantMessage: input.session.lastAssistantMessage || '',
        error: input.session.error || '',
      }
      : null,
    activeTask: input.latestTask
      ? buildControlPanelTaskList([input.latestTask])[0] || null
      : null,
    taskCounts: {
      total: input.tasks.length,
      active: input.tasks.filter((task) => task.status === 'queued' || task.status === 'running').length,
      waitingUser: input.tasks.filter((task) => task.status === 'waiting_user').length,
      completed: input.tasks.filter((task) => task.status === 'completed').length,
      failed: input.tasks.filter((task) => task.status === 'failed').length,
    },
    latestTranscript: input.session?.lastTranscript || '',
    autoExecute: input.settings.autoExecute,
    companion: input.memoryOverview.identity
      ? {
        displayName: input.memoryOverview.identity.displayName,
        identitySummary: compactText(input.memoryOverview.identity.identityNotes.join(' '), 96),
      }
      : null,
    memoryDigest: {
      stablePreferenceCount: input.memoryOverview.stablePreferences.length,
      recentWorkCount: input.memoryOverview.recentWork.length,
      longTermHighlightCount: input.memoryOverview.longTermHighlights.length,
    },
  };
}

export function buildControlPanelTaskTimeline(task: TaskRecord): ControlPanelTaskTimeline {
  const timeline: ControlPanelTaskTimelineEntry[] = [
    {
      id: `${task.id}-created`,
      kind: 'task',
      label: '任务已创建',
      summary: compactText(task.sourceTranscript || task.progressSummary || task.title, 110),
      status: 'completed',
      timestamp: task.createdAt,
    },
  ];

  if (task.workspace?.steps?.length) {
    task.workspace.steps.forEach((step, index) => {
      timeline.push({
        id: step.id || `${task.id}-step-${index + 1}`,
        kind: 'step',
        label: step.title,
        summary: compactText(step.summary, 140),
        status: mapStepStatus(step.status),
        timestamp: task.updatedAt,
      });
    });
  } else {
    timeline.push({
      id: `${task.id}-status`,
      kind: 'task',
      label: getCurrentStageLabel(task),
      summary: compactText(getTaskSummary(task), 140),
      status: mapTaskStatus(task.status),
      timestamp: task.updatedAt,
    });
  }

  if (task.status === 'waiting_user') {
    timeline.push({
      id: `${task.id}-approval`,
      kind: 'approval',
      label: '等待用户确认',
      summary: compactText(task.progressSummary || '后台任务需要你确认下一步。', 120),
      status: 'pending',
      timestamp: task.updatedAt,
    });
  }

  if (task.resultSummary || task.workspace?.outcome?.summary) {
    timeline.push({
      id: `${task.id}-result`,
      kind: 'result',
      label: '结果摘要',
      summary: compactText(task.resultSummary || task.workspace?.outcome?.summary || '', 180),
      status: task.status === 'failed'
        ? 'blocked'
        : task.status === 'completed'
          ? 'completed'
          : mapTaskStatus(task.status),
      timestamp: task.updatedAt,
    });
  }

  return {
    taskId: task.id,
    title: task.title,
    status: task.status,
    statusLabel: getTaskStatusLabel(task.status),
    requiresConfirmation: task.status === 'waiting_user' || Boolean(task.workspace?.requiresConfirmation),
    currentStage: getCurrentStageLabel(task),
    timeline,
  };
}

export function buildControlPanelTaskDetail(task: TaskRecord): ControlPanelTaskDetail {
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    status: task.status,
    statusLabel: getTaskStatusLabel(task.status),
    riskLevel: task.riskLevel,
    summary: compactText(task.workspace?.summary || task.progressSummary || task.sourceTranscript, 180),
    result: compactText(task.resultSummary || task.workspace?.outcome?.summary || '任务仍在推进中。', 220),
    currentStage: getCurrentStageLabel(task),
    sourceTranscript: task.sourceTranscript,
    notes: task.workspace?.notes.slice(0, 8) || [],
    requiresConfirmation: task.status === 'waiting_user' || Boolean(task.workspace?.requiresConfirmation),
    updatedAt: task.updatedAt,
    relatedMemoryDocs: buildTaskScopedMemoryDocuments(task),
  };
}

export function buildControlPanelMemoryOverview(tasks: TaskRecord[]): ControlPanelMemoryOverview {
  const memoryFiles = findMemoryFiles(tasks);
  if (!memoryFiles) {
    return {
      identity: null,
      stablePreferences: [],
      recentWork: [],
      longTermHighlights: [],
    };
  }

  const identity = readCompanionIdentity(memoryFiles.companionIdentityPath);
  const stablePreferences = readStablePreferences(memoryFiles.journalPath);
  const recentWork = readRecentWork(memoryFiles.recentMemoryPath);
  const longTermHighlights = readLongTermHighlights(memoryFiles.longTermMemoryPath);

  return {
    identity,
    stablePreferences,
    recentWork,
    longTermHighlights,
  };
}

export function buildControlPanelMemoryDocuments(tasks: TaskRecord[]): ControlPanelMemoryDocumentListItem[] {
  return collectMemoryDocumentEntries(tasks).map((entry) => ({
    id: entry.id,
    label: entry.label,
    fileName: path.basename(entry.path),
    contentType: detectMemoryDocumentContentType(entry.path),
    sourceKind: detectMemoryDocumentSourceKind(entry.path),
    sourceLabel: getMemoryDocumentSourceLabel(detectMemoryDocumentSourceKind(entry.path)),
    summary: entry.summary,
    updatedAt: entry.updatedAt,
    sourceTaskId: entry.sourceTaskId,
    sourceTaskTitle: entry.sourceTaskTitle,
  }));
}

export function buildControlPanelMemoryDocumentDetail(
  tasks: TaskRecord[],
  documentId: string,
): ControlPanelMemoryDocumentDetail | null {
  const entry = collectMemoryDocumentEntries(tasks).find((candidate) => candidate.id === documentId);
  if (!entry || !fs.existsSync(entry.path) || fs.statSync(entry.path).isDirectory()) {
    return null;
  }

  const content = fs.readFileSync(entry.path, 'utf8');
  return {
    id: entry.id,
    label: entry.label,
    fileName: path.basename(entry.path),
    path: entry.path,
    contentType: detectMemoryDocumentContentType(entry.path),
    summary: entry.summary,
    updatedAt: entry.updatedAt,
    sourceTaskId: entry.sourceTaskId,
    sourceTaskTitle: entry.sourceTaskTitle,
    content,
  };
}

function getTaskSummary(task: TaskRecord): string {
  return compactText(
    task.resultSummary
      || task.workspace?.outcome?.summary
      || task.workspace?.summary
      || task.progressSummary
      || task.sourceTranscript
      || task.title,
    140,
  );
}

function getTaskStatusLabel(status: TaskStatus): string {
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

function getCurrentStageLabel(task: TaskRecord): string {
  if (task.status === 'waiting_user') {
    return '等待确认';
  }

  if (task.status === 'completed') {
    return '已完成';
  }

  if (task.status === 'failed') {
    return '执行失败';
  }

  if (task.status === 'cancelled') {
    return '已取消';
  }

  if (task.workspace?.mode === 'planning') {
    return '规划中';
  }

  if (task.workspace?.mode === 'executing') {
    return '执行中';
  }

  if (task.workspace?.mode === 'blocked') {
    return '阻塞中';
  }

  return task.status === 'queued' ? '已接收' : '处理中';
}

function mapStepStatus(status: AgentWorkspaceStepStatus): 'completed' | 'in_progress' | 'pending' | 'blocked' | 'info' {
  if (status === 'completed') {
    return 'completed';
  }

  if (status === 'in_progress') {
    return 'in_progress';
  }

  if (status === 'blocked') {
    return 'blocked';
  }

  return 'pending';
}

function mapTaskStatus(status: TaskStatus): 'completed' | 'in_progress' | 'pending' | 'blocked' | 'info' {
  if (status === 'completed') {
    return 'completed';
  }

  if (status === 'running') {
    return 'in_progress';
  }

  if (status === 'failed') {
    return 'blocked';
  }

  if (status === 'queued' || status === 'waiting_user') {
    return 'pending';
  }

  return 'info';
}

function findMemoryFiles(tasks: TaskRecord[]): MemoryFiles | null {
  const sortedTasks = [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  for (const task of sortedTasks) {
    for (const memoryRef of task.workspace?.memoryRefs || []) {
      const memoryFiles = deriveMemoryFiles(memoryRef.path);
      if (memoryFiles) {
        return memoryFiles;
      }
    }
  }

  return null;
}

function deriveMemoryFiles(memoryPath: string): MemoryFiles | null {
  if (!memoryPath) {
    return null;
  }

  const normalized = path.normalize(memoryPath);
  const lower = normalized.toLowerCase();
  let baseDir = '';
  const fileName = path.basename(lower);

  if (fileName === 'openclawstylememory.md' || fileName === 'openclaw-style-memory.md') {
    baseDir = path.dirname(normalized);
  } else if (lower.includes(`${path.sep}taskmemories${path.sep}`) || lower.includes(`${path.sep}tasks${path.sep}`)) {
    baseDir = path.dirname(path.dirname(normalized));
  }

  if (!baseDir) {
    return null;
  }

  return {
    baseDir,
    journalPath: path.join(baseDir, 'openClawStyleMemory.md'),
    recentMemoryPath: path.join(baseDir, 'recentMemory.json'),
    longTermMemoryPath: path.join(baseDir, 'longTermMemory.json'),
    companionIdentityPath: path.join(baseDir, 'companionIdentity.json'),
  };
}

function collectMemoryDocumentEntries(tasks: TaskRecord[]): Array<{
  id: string;
  label: string;
  path: string;
  summary: string;
  updatedAt: string;
  sourceTaskId: string | null;
  sourceTaskTitle: string | null;
}> {
  const entries = new Map<string, {
    id: string;
    label: string;
    path: string;
    summary: string;
    updatedAt: string;
    sourceTaskId: string | null;
    sourceTaskTitle: string | null;
  }>();
  const sortedTasks = [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  for (const task of sortedTasks) {
    for (const memoryRef of task.workspace?.memoryRefs || []) {
      if (!memoryRef.path || entries.has(memoryRef.path) || !fs.existsSync(memoryRef.path)) {
        continue;
      }

      entries.set(memoryRef.path, {
        id: encodeMemoryDocumentId(memoryRef.path),
        label: memoryRef.label,
        path: memoryRef.path,
        summary: compactText(memoryRef.summary || task.resultSummary || task.progressSummary || task.title, 140),
        updatedAt: task.updatedAt,
        sourceTaskId: task.id,
        sourceTaskTitle: task.title,
      });
    }
  }

  return Array.from(entries.values())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 12);
}

function buildTaskScopedMemoryDocuments(task: TaskRecord): ControlPanelMemoryDocumentListItem[] {
  return (task.workspace?.memoryRefs || [])
    .filter((memoryRef) => memoryRef.path && fs.existsSync(memoryRef.path))
    .map((memoryRef) => ({
      id: encodeMemoryDocumentId(memoryRef.path),
      label: memoryRef.label,
      fileName: path.basename(memoryRef.path),
      contentType: detectMemoryDocumentContentType(memoryRef.path),
      sourceKind: detectMemoryDocumentSourceKind(memoryRef.path),
      sourceLabel: getMemoryDocumentSourceLabel(detectMemoryDocumentSourceKind(memoryRef.path)),
      summary: compactText(memoryRef.summary || task.resultSummary || task.progressSummary || task.title, 140),
      updatedAt: task.updatedAt,
      sourceTaskId: task.id,
      sourceTaskTitle: task.title,
    }));
}

function readCompanionIdentity(filePath: string): ControlPanelMemoryOverview['identity'] {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<StoredCompanionIdentity>;
    if (!parsed || typeof parsed.displayName !== 'string') {
      return null;
    }
    const displayName = parsed.displayName.trim();
    const identityNotes = Array.isArray(parsed.identityNotes)
      ? sanitizeIdentityNotes(
        displayName,
        parsed.identityNotes.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())),
      )
      : [];

    return {
      displayName,
      identityNotes: identityNotes
        .map((item) => compactText(item, 96))
        .slice(0, 4),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return null;
  }
}

function readStablePreferences(filePath: string): string[] {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const document = fs.readFileSync(filePath, 'utf8');
    const lines = extractMarkdownSectionLines(document, 'Stable Preferences');
    return lines
      .map((line) => line.replace(/^-+\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 6);
  } catch {
    return [];
  }
}

function readRecentWork(filePath: string): ControlPanelMemoryOverview['recentWork'] {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoredRecentMemory[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry) => entry && typeof entry.title === 'string')
      .slice(0, 6)
      .map((entry) => ({
        title: entry.title,
        kind: entry.kind,
        updatedAt: entry.updatedAt,
        summary: compactText(
          entry.resultSummary
            || buildRecentMemoryFallback(entry),
          140,
        ),
        outcomeStatus: entry.outcomeStatus || null,
      }));
  } catch {
    return [];
  }
}

function readLongTermHighlights(filePath: string): ControlPanelMemoryOverview['longTermHighlights'] {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoredLongTermMemory[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry) => entry && typeof entry.title === 'string')
      .slice(0, 6)
      .map((entry) => ({
        category: entry.category,
        title: entry.title,
        summary: compactText(entry.summary, 140),
        updatedAt: entry.updatedAt,
      }));
  } catch {
    return [];
  }
}

function buildRecentMemoryFallback(entry: StoredRecentMemory): string {
  const candidate = entry.sourceTranscript || entry.title || '';
  return compactText(candidate.replace(/\s+/g, ' ').trim(), 140);
}

function extractMarkdownSectionLines(document: string, sectionTitle: string): string[] {
  const lines = document.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === `## ${sectionTitle}`);
  if (startIndex === -1) {
    return [];
  }

  const sectionLines: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] || '';
    if (line.startsWith('## ')) {
      break;
    }
    if (line.trim()) {
      sectionLines.push(line);
    }
  }

  return sectionLines;
}

function compactText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function encodeMemoryDocumentId(filePath: string): string {
  return Buffer.from(filePath, 'utf8').toString('base64url');
}

function detectMemoryDocumentContentType(filePath: string): 'markdown' | 'json' | 'text' {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.md') {
    return 'markdown';
  }

  if (extension === '.json') {
    return 'json';
  }

  return 'text';
}

function detectMemoryDocumentSourceKind(filePath: string): 'task_memory' | 'journal' | 'memory_data' | 'other' {
  const normalized = path.normalize(filePath).toLowerCase();
  const fileName = path.basename(normalized);
  if (normalized.includes(`${path.sep}taskmemories${path.sep}`) || normalized.includes(`${path.sep}tasks${path.sep}`)) {
    return 'task_memory';
  }
  if (fileName === 'openclawstylememory.md' || fileName === 'openclaw-style-memory.md') {
    return 'journal';
  }
  if (fileName === 'recentmemory.json' || fileName === 'longtermmemory.json' || fileName === 'companionidentity.json') {
    return 'memory_data';
  }
  return 'other';
}

function getMemoryDocumentSourceLabel(sourceKind: 'task_memory' | 'journal' | 'memory_data' | 'other'): string {
  switch (sourceKind) {
    case 'task_memory':
      return '任务记忆';
    case 'journal':
      return '长期记忆';
    case 'memory_data':
      return '记忆数据';
    default:
      return '其他文档';
  }
}

function sanitizeIdentityNotes(displayName: string, notes: string[]): string[] {
  const normalizedDisplayName = displayName.trim();
  const deduped = new Set<string>();

  for (const note of notes) {
    const normalizedNote = note.replace(/\s+/g, ' ').trim();
    if (!normalizedNote) {
      continue;
    }

    if (shouldDropStaleIdentityNote(normalizedDisplayName, normalizedNote)) {
      continue;
    }

    deduped.add(normalizedNote);
  }

  return Array.from(deduped.values());
}

function shouldDropStaleIdentityNote(displayName: string, note: string): boolean {
  if (!displayName || note.includes(displayName)) {
    return false;
  }

  return /改名|改叫|名字改成|以后叫|叫你|叫我|现在叫|自称|身份持续陪伴|身份陪伴/.test(note);
}
