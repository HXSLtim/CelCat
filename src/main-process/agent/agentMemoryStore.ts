import fs from 'node:fs';
import path from 'node:path';
import type { AgentWorkspaceMemoryRef, TaskKind, TaskRecord } from '../../types/tasks';

export type LongTermMemoryCategory = 'preferences' | 'patterns' | 'failures' | 'recipes';

export type LongTermMemoryEntry = {
  category: LongTermMemoryCategory;
  title: string;
  summary: string;
  evidence: string;
  updatedAt: string;
};

export type AgentPlanningMemoryContext = {
  stablePreferences: string[];
  recentMemories: Array<{
    title: string;
    kind: TaskKind;
    sourceTranscript: string;
    compressedContext: string;
    resultSummary: string;
    updatedAt: string;
  }>;
  relevantMemories: Array<{
    title: string;
    kind: TaskKind;
    summary: string;
    score: number;
  }>;
  longTermMemories: LongTermMemoryEntry[];
};

type StoredMemoryEntry = AgentPlanningMemoryContext['recentMemories'][number];

const STABLE_PREFERENCES = [
  '偏好中文、直接执行、减少来回确认。',
  '偏好桌宠风格体验：自然情绪、嘴型联动、全屏适配。',
  '希望 agent 具备 OpenClaw 风格的记忆文档、上下文压缩和工作区记录。',
];

export class AgentMemoryStore {
  private readonly baseDir: string;
  private readonly journalPath: string;
  private readonly taskMemoryDir: string;
  private readonly recentMemoryPath: string;
  private readonly longTermMemoryPath: string;
  private readonly legacyBaseDir: string;
  private readonly legacyJournalPath: string;
  private readonly legacyTaskMemoryDir: string;
  private readonly legacyRecentMemoryPath: string;
  private readonly legacyLongTermMemoryPath: string;

  constructor(userDataPath: string) {
    this.baseDir = path.join(userDataPath, 'agentMemory');
    this.journalPath = path.join(this.baseDir, 'openClawStyleMemory.md');
    this.taskMemoryDir = path.join(this.baseDir, 'taskMemories');
    this.recentMemoryPath = path.join(this.baseDir, 'recentMemory.json');
    this.longTermMemoryPath = path.join(this.baseDir, 'longTermMemory.json');
    this.legacyBaseDir = path.join(userDataPath, 'agent-memory');
    this.legacyJournalPath = path.join(this.legacyBaseDir, 'openclaw-style-memory.md');
    this.legacyTaskMemoryDir = path.join(this.legacyBaseDir, 'tasks');
    this.legacyRecentMemoryPath = path.join(this.legacyBaseDir, 'recent-memory.json');
    this.legacyLongTermMemoryPath = path.join(this.legacyBaseDir, 'long-term-memory.json');
    this.migrateLegacyLayout();
  }

  recordTaskMemory(task: TaskRecord): AgentWorkspaceMemoryRef[] {
    fs.mkdirSync(this.taskMemoryDir, { recursive: true });

    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const taskDocPath = path.join(this.taskMemoryDir, `${safeTimestamp}-${task.id}.md`);
    const taskDoc = buildTaskMemoryDocument(task);
    fs.writeFileSync(taskDocPath, taskDoc, 'utf8');

    this.writeRecentMemory(task);
    this.writeLongTermMemories(task);
    this.rebuildJournal(taskDocPath);

    return [
      {
        id: 'memoryTaskDoc',
        label: '任务记忆',
        path: taskDocPath,
        summary: '记录了任务目标、步骤、产物、压缩上下文和最终结果。',
      },
      {
        id: 'memoryJournal',
        label: '长期记忆',
        path: this.journalPath,
        summary: '长期记忆文档，持续累计任务偏好、决策和工作方式。',
      },
    ];
  }

  getPlanningContext(query = '', kind?: TaskKind): AgentPlanningMemoryContext {
    const recentMemories = this.readRecentMemories();
    const relevantMemories = rankRelevantMemories(recentMemories, query, kind);
    const longTermMemories = rankLongTermMemories(this.readLongTermMemories(), query, kind);

    return {
      stablePreferences: STABLE_PREFERENCES.slice(),
      recentMemories,
      relevantMemories,
      longTermMemories,
    };
  }

  private rebuildJournal(latestTaskDocPath: string): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const recentMemories = this.readRecentMemories();
    const longTermMemories = this.readLongTermMemories();

    const document = [
      '# CelCat Agent Memory',
      '',
      '## Identity',
      '- 这是一个面向桌宠 companion 的 agent 记忆文档。',
      '- 记录用户偏好、执行风格、任务结论和上下文压缩摘要。',
      '',
      '## Stable Preferences',
      ...STABLE_PREFERENCES.map((preference) => `- ${preference}`),
      '',
      '## Successful Recipes',
      ...renderLongTermMemorySection(longTermMemories, 'recipes'),
      '',
      '## Failure Patterns',
      ...renderLongTermMemorySection(longTermMemories, 'failures'),
      '',
      '## Work Patterns',
      ...renderLongTermMemorySection(longTermMemories, 'patterns'),
      '',
      '## Learned Preferences',
      ...renderLongTermMemorySection(longTermMemories, 'preferences'),
      '',
      '## Recent Memories',
      ...renderRecentMemorySection(recentMemories, latestTaskDocPath),
      '',
    ].join('\n');

    fs.writeFileSync(this.journalPath, document, 'utf8');
  }

  private writeRecentMemory(task: TaskRecord): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const existing = this.readRecentMemories();
    const nextEntry: StoredMemoryEntry = {
      title: task.title,
      kind: task.kind,
      sourceTranscript: task.sourceTranscript,
      compressedContext: task.workspace?.compressedContext || '',
      resultSummary: task.resultSummary || '',
      updatedAt: new Date().toISOString(),
    };

    const nextEntries = [
      nextEntry,
      ...existing.filter((entry) =>
        entry.sourceTranscript !== nextEntry.sourceTranscript
        || entry.updatedAt !== nextEntry.updatedAt,
      ),
    ].slice(0, 8);

    fs.writeFileSync(this.recentMemoryPath, JSON.stringify(nextEntries, null, 2), 'utf8');
  }

  private writeLongTermMemories(task: TaskRecord): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const existing = this.readLongTermMemories();
    const nextEntries = mergeLongTermMemories(existing, classifyLongTermMemories(task)).slice(0, 24);
    fs.writeFileSync(this.longTermMemoryPath, JSON.stringify(nextEntries, null, 2), 'utf8');
  }

  private readRecentMemories(): StoredMemoryEntry[] {
    try {
      if (!fs.existsSync(this.recentMemoryPath)) {
        return [];
      }

      const raw = fs.readFileSync(this.recentMemoryPath, 'utf8');
      const parsed = JSON.parse(raw) as StoredMemoryEntry[];
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(isStoredMemoryEntry);
    } catch {
      return [];
    }
  }

  private readLongTermMemories(): LongTermMemoryEntry[] {
    try {
      if (!fs.existsSync(this.longTermMemoryPath)) {
        return [];
      }

      const raw = fs.readFileSync(this.longTermMemoryPath, 'utf8');
      const parsed = JSON.parse(raw) as LongTermMemoryEntry[];
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(isLongTermMemoryEntry);
    } catch {
      return [];
    }
  }

  private migrateLegacyLayout(): void {
    if (this.legacyBaseDir !== this.baseDir
      && fs.existsSync(this.legacyBaseDir)
      && !fs.existsSync(this.baseDir)) {
      fs.renameSync(this.legacyBaseDir, this.baseDir);
    }

    fs.mkdirSync(this.baseDir, { recursive: true });

    migratePath(path.join(this.baseDir, 'openclaw-style-memory.md'), this.journalPath);
    migratePath(path.join(this.baseDir, 'tasks'), this.taskMemoryDir);
    migrateJsonArrayFile(path.join(this.baseDir, 'recent-memory.json'), this.recentMemoryPath);
    migrateJsonArrayFile(path.join(this.baseDir, 'long-term-memory.json'), this.longTermMemoryPath);

    if (this.legacyBaseDir !== this.baseDir && fs.existsSync(this.legacyBaseDir)) {
      migratePath(this.legacyJournalPath, this.journalPath);
      migratePath(this.legacyTaskMemoryDir, this.taskMemoryDir);
      migrateJsonArrayFile(this.legacyRecentMemoryPath, this.recentMemoryPath);
      migrateJsonArrayFile(this.legacyLongTermMemoryPath, this.longTermMemoryPath);
      removeDirectoryIfEmpty(this.legacyBaseDir);
    }
  }
}

function buildTaskMemoryDocument(task: TaskRecord): string {
  const workspace = task.workspace;

  return [
    `# ${task.title}`,
    '',
    '## Mission',
    workspace?.mission || task.sourceTranscript,
    '',
    '## Summary',
    workspace?.summary || task.progressSummary,
    '',
    '## Plan',
    ...(workspace?.steps.length
      ? workspace.steps.map((step) => `- [${mapStepStatus(step.status)}] ${step.title}: ${step.summary}`)
      : ['- 暂无步骤记录']),
    '',
    '## Skills',
    ...(workspace?.skills.length
      ? workspace.skills.map((skill) => `- ${skill.label}: ${skill.reason}`)
      : ['- 无']),
    '',
    '## MCP',
    ...(workspace?.mcps.length
      ? workspace.mcps.map((mcp) => `- ${mcp.label}: ${mcp.reason}`)
      : ['- 无']),
    '',
    '## Artifacts',
    ...(workspace?.artifacts.length
      ? workspace.artifacts.map((artifact) => `- ${artifact.label}: ${artifact.content.replace(/\n/g, ' ')}`)
      : ['- 无']),
    '',
    '## Compressed Context',
    workspace?.compressedContext || '暂无',
    '',
    '## Result',
    task.resultSummary || '暂无',
    '',
  ].join('\n');
}

function mapStepStatus(status: string): string {
  if (status === 'completed') {
    return 'x';
  }

  if (status === 'in_progress') {
    return '>';
  }

  if (status === 'blocked') {
    return '!';
  }

  return ' ';
}

function renderLongTermMemorySection(
  memories: LongTermMemoryEntry[],
  category: LongTermMemoryCategory,
): string[] {
  const matches = memories.filter((memory) => memory.category === category).slice(0, 6);
  if (!matches.length) {
    return ['- 暂无'];
  }

  return matches.map((memory) =>
    `- ${memory.title}: ${memory.summary} (${memory.updatedAt})`,
  );
}

function renderRecentMemorySection(
  memories: StoredMemoryEntry[],
  latestTaskDocPath: string,
): string[] {
  if (!memories.length) {
    return ['- 暂无'];
  }

  return memories.slice(0, 8).map((memory, index) => [
    `### ${memory.updatedAt} ${memory.title}`,
    `- Source: ${memory.sourceTranscript}`,
    memory.compressedContext ? `- Compressed Context: ${memory.compressedContext.replace(/\n/g, ' | ')}` : '',
    memory.resultSummary ? `- Result: ${memory.resultSummary}` : '',
    index === 0 ? `- Latest Task Doc: ${latestTaskDocPath}` : '',
  ].filter(Boolean).join('\n'));
}

function classifyLongTermMemories(task: TaskRecord): LongTermMemoryEntry[] {
  const updatedAt = new Date().toISOString();
  const entries: LongTermMemoryEntry[] = [];
  const compressedContext = task.workspace?.compressedContext || '';

  if (/参考|风格|偏好|希望|不要|记忆文档|上下文压缩/.test(task.sourceTranscript)) {
    entries.push({
      category: 'preferences',
      title: task.title,
      summary: compactText(task.sourceTranscript, 90),
      evidence: compressedContext || task.sourceTranscript,
      updatedAt,
    });
  }

  if (task.status === 'failed') {
    entries.push({
      category: 'failures',
      title: task.title,
      summary: compactText(task.errorMessage || task.progressSummary, 110),
      evidence: compressedContext || task.sourceTranscript,
      updatedAt,
    });
  } else if (task.status === 'completed') {
    entries.push({
      category: 'recipes',
      title: task.title,
      summary: compactText(task.resultSummary || task.progressSummary, 110),
      evidence: compressedContext || task.sourceTranscript,
      updatedAt,
    });
  }

  if (compressedContext) {
    entries.push({
      category: 'patterns',
      title: task.title,
      summary: compactText(compressedContext.replace(/\n/g, ' | '), 120),
      evidence: compressedContext,
      updatedAt,
    });
  }

  return entries;
}

function mergeLongTermMemories(
  existing: LongTermMemoryEntry[],
  nextEntries: LongTermMemoryEntry[],
): LongTermMemoryEntry[] {
  const merged = [...nextEntries, ...existing];
  const deduped = new Map<string, LongTermMemoryEntry>();

  for (const entry of merged) {
    const key = `${entry.category}:${entry.title}:${entry.summary}`;
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  }

  return Array.from(deduped.values());
}

function rankRelevantMemories(
  memories: StoredMemoryEntry[],
  query: string,
  kind?: TaskKind,
): AgentPlanningMemoryContext['relevantMemories'] {
  const ranked = memories
    .map((memory) => ({
      title: memory.title,
      kind: memory.kind,
      summary: compactText(
        `${memory.sourceTranscript} | ${memory.compressedContext || memory.resultSummary}`,
        140,
      ),
      score: computeMemoryRelevanceScore(query, kind, [
        memory.title,
        memory.sourceTranscript,
        memory.compressedContext,
        memory.resultSummary,
      ], memory.kind),
    }))
    .filter((memory) => memory.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  return ranked;
}

function rankLongTermMemories(
  memories: LongTermMemoryEntry[],
  query: string,
  kind?: TaskKind,
): LongTermMemoryEntry[] {
  return memories
    .map((memory) => ({
      ...memory,
      score: computeMemoryRelevanceScore(query, kind, [
        memory.title,
        memory.summary,
        memory.evidence,
      ]),
    }))
    .filter((memory) => memory.score > 0 || memory.category === 'preferences')
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map(({ score: _score, ...memory }) => memory);
}

function computeMemoryRelevanceScore(
  query: string,
  kind: TaskKind | undefined,
  fields: string[],
  memoryKind?: TaskKind,
): number {
  const queryKeywords = extractKeywords(query);
  let score = 0;

  if (kind && memoryKind && kind === memoryKind) {
    score += 2;
  }

  for (const keyword of queryKeywords) {
    for (const field of fields) {
      if (field.includes(keyword)) {
        score += keyword.length >= 4 ? 2 : 1;
      }
    }
  }

  return score;
}

function extractKeywords(text: string): string[] {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const matches = normalized.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9_-]{2,}/g) ?? [];
  const keywords = new Set<string>();

  for (const match of matches) {
    keywords.add(match);
    if (/^[\u4e00-\u9fa5]+$/.test(match)) {
      for (let length = 2; length <= Math.min(4, match.length); length += 1) {
        for (let index = 0; index <= match.length - length; index += 1) {
          keywords.add(match.slice(index, index + length));
        }
      }
    }
  }

  return Array.from(keywords);
}

function isStoredMemoryEntry(value: unknown): value is StoredMemoryEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.title === 'string'
    && typeof candidate.kind === 'string'
    && typeof candidate.sourceTranscript === 'string'
    && typeof candidate.compressedContext === 'string'
    && typeof candidate.resultSummary === 'string'
    && typeof candidate.updatedAt === 'string';
}

function isLongTermMemoryEntry(value: unknown): value is LongTermMemoryEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (candidate.category === 'preferences'
      || candidate.category === 'patterns'
      || candidate.category === 'failures'
      || candidate.category === 'recipes')
    && typeof candidate.title === 'string'
    && typeof candidate.summary === 'string'
    && typeof candidate.evidence === 'string'
    && typeof candidate.updatedAt === 'string'
  );
}

function compactText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function migratePath(sourcePath: string, destinationPath: string): void {
  if (!fs.existsSync(sourcePath) || sourcePath === destinationPath) {
    return;
  }

  if (!fs.existsSync(destinationPath)) {
    fs.renameSync(sourcePath, destinationPath);
    return;
  }

  const sourceStats = fs.statSync(sourcePath);
  const destinationStats = fs.statSync(destinationPath);

  if (sourceStats.isDirectory() && destinationStats.isDirectory()) {
    const entries = fs.readdirSync(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      migratePath(
        path.join(sourcePath, entry.name),
        path.join(destinationPath, entry.name),
      );
    }
    removeDirectoryIfEmpty(sourcePath);
  }
}

function migrateJsonArrayFile(sourcePath: string, destinationPath: string): void {
  if (!fs.existsSync(sourcePath) || sourcePath === destinationPath) {
    return;
  }

  if (!fs.existsSync(destinationPath)) {
    fs.renameSync(sourcePath, destinationPath);
    return;
  }

  try {
    const sourceData = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as unknown;
    const destinationData = JSON.parse(fs.readFileSync(destinationPath, 'utf8')) as unknown;
    if (!Array.isArray(sourceData) || !Array.isArray(destinationData)) {
      return;
    }

    const merged = [...destinationData];
    for (const entry of sourceData) {
      if (!merged.some((existing) => JSON.stringify(existing) === JSON.stringify(entry))) {
        merged.push(entry);
      }
    }

    fs.writeFileSync(destinationPath, JSON.stringify(merged, null, 2), 'utf8');
    fs.rmSync(sourcePath, { force: true });
  } catch {
    // Keep legacy file untouched when merge data is invalid.
  }
}

function removeDirectoryIfEmpty(directoryPath: string): void {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return;
  }

  if (fs.readdirSync(directoryPath).length === 0) {
    fs.rmdirSync(directoryPath);
  }
}
