import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AgentCapabilityCatalogEntry,
  AgentWorkspaceCapability,
  AgentWorkspaceCapabilityType,
  TaskKind,
} from '../../types/tasks';

export type CapabilityDefinition = {
  id: string;
  label: string;
  type: AgentWorkspaceCapabilityType;
  keywords: RegExp[];
  keywordTerms: string[];
  kinds?: TaskKind[];
  defaultReason: string;
  source: 'builtin' | 'skill' | 'mcp';
  description?: string;
  originPath?: string;
  command?: string;
  args?: string[];
  inputMode?: 'json-stdin' | 'text-stdin' | 'transcript-arg';
  workingDirectory?: string;
  entryPath?: string;
};

type CapabilityCatalogOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  homeDir?: string;
  skillRoots?: string[];
};

type SerializableCapabilityDefinition = {
  id: string;
  label: string;
  type: AgentWorkspaceCapabilityType;
  kinds?: TaskKind[];
  keywords: string[];
  defaultReason: string;
  source: CapabilityDefinition['source'];
  description?: string;
};

type ExternalMcpDefinition = {
  id?: string;
  name?: string;
  label?: string;
  description?: string;
  command?: string;
  args?: string[];
  keywords?: string[];
};

type SkillExecutionConfig = {
  command?: string;
  args?: string[];
  inputMode?: CapabilityDefinition['inputMode'];
  cwd?: string;
  entryPath?: string;
};

const BUILTIN_CAPABILITY_DEFINITIONS: CapabilityDefinition[] = [
  createBuiltinCapability({
    id: 'codingWorkflow',
    label: 'Coding Workflow',
    type: 'skill',
    kinds: ['codex'],
    keywordTerms: ['代码', '修复', '实现', '重构', '脚本', '仓库', '项目', '前端', '后端', '测试'],
    defaultReason: '负责拆解编码步骤、变更实现和验证回归。',
  }),
  createBuiltinCapability({
    id: 'frontendDesign',
    label: 'Frontend Design',
    type: 'skill',
    kinds: ['codex'],
    keywordTerms: ['界面', 'ui', '前端', '样式', '布局', '全屏', '工作区', 'workspace'],
    defaultReason: '用于处理工作区布局、交互结构和可视化适配。',
  }),
  createBuiltinCapability({
    id: 'playwrightSkill',
    label: 'Playwright',
    type: 'skill',
    keywordTerms: ['页面', '浏览器', '截图', '回归', '自动化', '验证', '测试'],
    defaultReason: '适合浏览器自动化验证、截图和交互回归。',
  }),
  createBuiltinCapability({
    id: 'architectureDesigner',
    label: 'Architecture Designer',
    type: 'skill',
    keywordTerms: ['架构', '设计', '规划', 'agentic', 'workflow', 'skill', 'mcp'],
    defaultReason: '用于规划 agent 工作流、能力分层和系统设计。',
  }),
  createBuiltinCapability({
    id: 'gitEssentials',
    label: 'Git Essentials',
    type: 'skill',
    keywordTerms: ['git', '提交', '分支', '变更', '版本'],
    defaultReason: '帮助梳理版本变更、工作区状态和提交策略。',
  }),
  createBuiltinCapability({
    id: 'filesystem',
    label: 'Filesystem MCP',
    type: 'mcp',
    kinds: ['codex', 'tool', 'mcp'],
    keywordTerms: ['文件', '目录', '工作区', '仓库', '配置', '读取', '写入'],
    defaultReason: '用于读取和写入当前工程文件，建立任务工作区上下文。',
  }),
  createBuiltinCapability({
    id: 'terminal',
    label: 'Terminal MCP',
    type: 'mcp',
    kinds: ['codex', 'tool', 'mcp'],
    keywordTerms: ['运行', '命令', '测试', '构建', '安装', '执行'],
    defaultReason: '用于执行构建、测试、运行脚本和采集命令输出。',
  }),
  createBuiltinCapability({
    id: 'git',
    label: 'Git MCP',
    type: 'mcp',
    keywordTerms: ['git', '提交', 'diff', '改动', '版本'],
    defaultReason: '用于查看改动、分支状态和任务前后的代码差异。',
  }),
  createBuiltinCapability({
    id: 'browser',
    label: 'Browser MCP',
    type: 'mcp',
    keywordTerms: ['网页', '浏览器', '搜索', '在线', '站点', '页面'],
    defaultReason: '用于网页浏览、页面验证和在线信息采集。',
  }),
];

export function getAgentCapabilityCatalog(
  options: CapabilityCatalogOptions = {},
): CapabilityDefinition[] {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const skillRoots = options.skillRoots ?? resolveSkillRoots(env, homeDir);

  return dedupeDefinitions([
    ...BUILTIN_CAPABILITY_DEFINITIONS,
    ...discoverSkillCapabilities(skillRoots),
    ...readExternalMcpCapabilities(env, cwd),
  ]);
}

export function getSerializableAgentCapabilityCatalog(
  options: CapabilityCatalogOptions = {},
): SerializableCapabilityDefinition[] {
  return getAgentCapabilityCatalog(options).map((capability) => ({
    id: capability.id,
    label: capability.label,
    type: capability.type,
    kinds: capability.kinds,
    keywords: capability.keywordTerms,
    defaultReason: capability.defaultReason,
    source: capability.source,
    description: capability.description,
  }));
}

export function getAgentCapabilityCatalogEntries(
  options: CapabilityCatalogOptions = {},
): AgentCapabilityCatalogEntry[] {
  return getAgentCapabilityCatalog(options).map((capability) => ({
    id: capability.id,
    label: capability.label,
    type: capability.type,
    source: capability.source,
    defaultReason: capability.defaultReason,
    description: capability.description,
  }));
}

export function resolveCapabilityDefinitionById(
  capabilityId: string,
  options: CapabilityCatalogOptions = {},
): CapabilityDefinition | null {
  return getAgentCapabilityCatalog(options).find((capability) => capability.id === capabilityId) ?? null;
}

export function selectCapabilitiesForTask(
  input: {
    transcript: string;
    kind: TaskKind;
  },
  catalog = getAgentCapabilityCatalog(),
): {
  skills: AgentWorkspaceCapability[];
  mcps: AgentWorkspaceCapability[];
} {
  const scored = catalog
    .map((definition) => ({
      definition,
      score: scoreCapability(definition, input.transcript, input.kind),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  const scoredSkills = scored
    .filter((entry) => entry.definition.type === 'skill')
    .slice(0, 4)
    .map((entry) => toWorkspaceCapability(entry.definition));
  const scoredMcps = scored
    .filter((entry) => entry.definition.type === 'mcp')
    .slice(0, 4)
    .map((entry) => toWorkspaceCapability(entry.definition));

  const fallbackDefinitions = selectFallbackDefinitions(catalog, input.kind);

  return {
    skills: mergeWorkspaceCapabilities(
      scoredSkills,
      fallbackDefinitions
        .filter((definition) => definition.type === 'skill')
        .map(toWorkspaceCapability),
    ),
    mcps: mergeWorkspaceCapabilities(
      scoredMcps,
      fallbackDefinitions
        .filter((definition) => definition.type === 'mcp')
        .map(toWorkspaceCapability),
    ),
  };
}

function createBuiltinCapability(input: {
  id: string;
  label: string;
  type: AgentWorkspaceCapabilityType;
  keywordTerms: string[];
  kinds?: TaskKind[];
  defaultReason: string;
}): CapabilityDefinition {
  return {
    ...input,
    keywords: input.keywordTerms.map(createKeywordRegex),
    source: 'builtin',
  };
}

function discoverSkillCapabilities(skillRoots: string[]): CapabilityDefinition[] {
  const discovered: CapabilityDefinition[] = [];
  const visitedPaths = new Set<string>();

  for (const root of skillRoots) {
    if (!root || visitedPaths.has(root) || !fs.existsSync(root)) {
      continue;
    }
    visitedPaths.add(root);

    for (const skillFilePath of findSkillFiles(root)) {
      const capability = buildSkillCapabilityFromFile(skillFilePath);
      if (capability) {
        discovered.push(capability);
      }
    }
  }

  return discovered;
}

function findSkillFiles(root: string): string[] {
  const results: string[] = [];
  const queue = [root];
  const visited = new Set<string>();

  while (queue.length) {
    const currentPath = queue.shift()!;
    if (visited.has(currentPath)) {
      continue;
    }
    visited.add(currentPath);

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name === 'SKILL.md') {
        results.push(entryPath);
      }
    }
  }

  return results;
}

function buildSkillCapabilityFromFile(skillFilePath: string): CapabilityDefinition | null {
  try {
    const skillDir = path.dirname(skillFilePath);
    const directoryName = normalizeSkillDirectoryName(path.basename(skillDir));
    const id = normalizeCapabilityId(directoryName);
    if (!id) {
      return null;
    }

    const raw = fs.readFileSync(skillFilePath, 'utf8');
    const description = extractSkillDescription(raw);
    const keywordTerms = extractKeywordTerms(`${directoryName} ${description}`);
    const label = humanizeCapabilityName(directoryName);
    const execution = discoverSkillExecution(skillDir);

    return {
      id,
      label,
      type: 'skill',
      kinds: inferTaskKindsFromKeywordTerms(keywordTerms),
      keywordTerms,
      keywords: keywordTerms.map(createKeywordRegex),
      defaultReason: description
        ? compactText(description, 72)
        : `可用于 ${label} 相关任务。`,
      source: 'skill',
      description,
      originPath: skillDir,
      command: execution?.command,
      args: execution?.args,
      inputMode: execution?.inputMode,
      workingDirectory: execution?.workingDirectory,
      entryPath: execution?.entryPath,
    };
  } catch {
    return null;
  }
}

function discoverSkillExecution(skillDir: string): Pick<
  CapabilityDefinition,
  'command' | 'args' | 'inputMode' | 'workingDirectory' | 'entryPath'
> | null {
  const configuredExecution = readSkillExecutionConfig(skillDir);
  if (configuredExecution) {
    return configuredExecution;
  }

  const directCandidates = [
    createRuntimeCandidate(skillDir, 'run.js', 'node', 'text-stdin'),
    createRuntimeCandidate(skillDir, 'run.cjs', 'node', 'text-stdin'),
    createRuntimeCandidate(skillDir, 'run.mjs', 'node', 'text-stdin'),
    createRuntimeCandidate(skillDir, 'run.py', 'python', 'text-stdin'),
    createRuntimeCandidate(skillDir, 'scripts/run.js', 'node', 'text-stdin'),
    createRuntimeCandidate(skillDir, 'scripts/run.cjs', 'node', 'text-stdin'),
    createRuntimeCandidate(skillDir, 'scripts/run.mjs', 'node', 'text-stdin'),
    createRuntimeCandidate(skillDir, 'scripts/run.py', 'python', 'text-stdin'),
    createRuntimeCandidate(skillDir, 'web-search.py', 'python', 'transcript-arg'),
    createRuntimeCandidate(skillDir, 'websearch.py', 'python', 'transcript-arg'),
    createRuntimeCandidate(skillDir, 'open-link.py', 'python', 'transcript-arg'),
    createRuntimeCandidate(skillDir, 'search-image.py', 'python', 'transcript-arg'),
    createRuntimeCandidate(skillDir, 'generate-image.py', 'python', 'transcript-arg'),
  ];

  for (const candidate of directCandidates) {
    if (candidate) {
      return candidate;
    }
  }

  const distExecutable = findExecutableInDirectory(path.join(skillDir, 'dist'));
  if (distExecutable) {
    return {
      command: distExecutable,
      args: [],
      inputMode: 'json-stdin',
      workingDirectory: skillDir,
      entryPath: distExecutable,
    };
  }

  return null;
}

function readSkillExecutionConfig(skillDir: string): Pick<
  CapabilityDefinition,
  'command' | 'args' | 'inputMode' | 'workingDirectory' | 'entryPath'
> | null {
  const configPath = path.join(skillDir, 'celcatSkill.json');
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as SkillExecutionConfig;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.command !== 'string' || !parsed.command.trim()) {
      return null;
    }

    return {
      command: parsed.command.trim(),
      args: Array.isArray(parsed.args)
        ? parsed.args.filter((value): value is string => typeof value === 'string')
        : [],
      inputMode: parsed.inputMode || 'json-stdin',
      workingDirectory: parsed.cwd ? path.resolve(skillDir, parsed.cwd) : skillDir,
      entryPath: parsed.entryPath ? path.resolve(skillDir, parsed.entryPath) : undefined,
    };
  } catch {
    return null;
  }
}

function createRuntimeCandidate(
  skillDir: string,
  relativePath: string,
  runtime: 'node' | 'python',
  inputMode: NonNullable<CapabilityDefinition['inputMode']>,
): Pick<
  CapabilityDefinition,
  'command' | 'args' | 'inputMode' | 'workingDirectory' | 'entryPath'
> | null {
  const entryPath = path.join(skillDir, relativePath);
  if (!fs.existsSync(entryPath)) {
    return null;
  }

  if (runtime === 'node') {
    return {
      command: process.execPath,
      args: [entryPath],
      inputMode,
      workingDirectory: skillDir,
      entryPath,
    };
  }

  const pythonRuntime = resolvePythonRuntime();
  return {
    command: pythonRuntime.command,
    args: [...pythonRuntime.args, entryPath],
    inputMode,
    workingDirectory: skillDir,
    entryPath,
  };
}

function resolvePythonRuntime(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: 'py', args: ['-3'] };
  }
  return { command: 'python3', args: [] };
}

function findExecutableInDirectory(directoryPath: string): string | null {
  if (!fs.existsSync(directoryPath)) {
    return null;
  }

  try {
    const preferredNames = ['mcp_server.exe', 'relay.exe'];
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);

    for (const preferredName of preferredNames) {
      if (entries.includes(preferredName)) {
        return path.join(directoryPath, preferredName);
      }
    }

    const genericExecutable = entries.find((entryName) =>
      /\.(?:exe|cmd|bat|sh)$/i.test(entryName),
    );

    return genericExecutable ? path.join(directoryPath, genericExecutable) : null;
  } catch {
    return null;
  }
}

function readExternalMcpCapabilities(
  env: NodeJS.ProcessEnv,
  cwd: string,
): CapabilityDefinition[] {
  const definitions: CapabilityDefinition[] = [];
  const inlineConfig = env.CELCAT_MCP_SERVERS_JSON?.trim();
  if (inlineConfig) {
    definitions.push(...parseExternalMcpDefinitions(inlineConfig));
  }

  const explicitConfigPath = env.CELCAT_MCP_CONFIG_PATH?.trim();
  if (explicitConfigPath) {
    const resolvedConfigPath = path.resolve(cwd, explicitConfigPath);
    if (fs.existsSync(resolvedConfigPath)) {
      try {
        definitions.push(...parseExternalMcpDefinitions(fs.readFileSync(resolvedConfigPath, 'utf8')));
      } catch {
        // Ignore malformed external MCP config files.
      }
    }
  }

  return definitions;
}

function parseExternalMcpDefinitions(raw: string): CapabilityDefinition[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeExternalMcpDefinitions(parsed);
  } catch {
    return [];
  }
}

function normalizeExternalMcpDefinitions(parsed: unknown): CapabilityDefinition[] {
  const normalizedEntries = extractExternalMcpEntries(parsed);
  return normalizedEntries.flatMap((entry) => {
    const label = (entry.label || entry.name || entry.id || '').trim();
    const capabilityId = normalizeCapabilityId(entry.id || entry.name || entry.label || '');
    if (!label || !capabilityId) {
      return [];
    }

    const description = (entry.description || '').trim();
    const keywordTerms = dedupeStrings([
      ...extractKeywordTerms(`${label} ${description}`),
      ...((entry.keywords || []).map((keyword) => keyword.trim()).filter(Boolean)),
    ]);

    return [{
      id: capabilityId,
      label,
      type: 'mcp' as const,
      kinds: ['tool', 'mcp'],
      keywordTerms,
      keywords: keywordTerms.map(createKeywordRegex),
      defaultReason: description
        ? compactText(description, 72)
        : `用于调用 ${label} 提供的外部能力。`,
      source: 'mcp' as const,
      description,
      command: typeof entry.command === 'string' ? entry.command : undefined,
      args: Array.isArray(entry.args) ? entry.args.filter((value): value is string => typeof value === 'string') : undefined,
    }];
  });
}

function extractExternalMcpEntries(parsed: unknown): ExternalMcpDefinition[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(isExternalMcpDefinition);
  }

  if (!parsed || typeof parsed !== 'object') {
    return [];
  }

  const candidate = parsed as Record<string, unknown>;
  if (Array.isArray(candidate.servers)) {
    return candidate.servers.filter(isExternalMcpDefinition);
  }

  if (Array.isArray(candidate.mcpServers)) {
    return candidate.mcpServers.filter(isExternalMcpDefinition);
  }

  if (candidate.mcpServers && typeof candidate.mcpServers === 'object') {
    return Object.entries(candidate.mcpServers as Record<string, unknown>)
      .flatMap(([name, value]) => {
        if (!value || typeof value !== 'object') {
          return [];
        }

        const entry = value as Record<string, unknown>;
        return [{
          id: typeof entry.id === 'string' ? entry.id : name,
          name,
          label: typeof entry.label === 'string' ? entry.label : name,
          description: typeof entry.description === 'string' ? entry.description : '',
          command: typeof entry.command === 'string' ? entry.command : undefined,
          args: Array.isArray(entry.args) ? entry.args.filter((item): item is string => typeof item === 'string') : undefined,
          keywords: Array.isArray(entry.keywords) ? entry.keywords.filter((item): item is string => typeof item === 'string') : undefined,
        }];
      });
  }

  return [];
}

function isExternalMcpDefinition(value: unknown): value is ExternalMcpDefinition {
  return Boolean(value) && typeof value === 'object';
}

function resolveSkillRoots(env: NodeJS.ProcessEnv, homeDir: string): string[] {
  const explicitRoots = env.CELCAT_SKILL_DIRS?.trim();
  if (explicitRoots) {
    return explicitRoots
      .split(path.delimiter)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => path.resolve(value));
  }

  return [
    path.join(homeDir, '.codex', 'skills'),
    path.join(homeDir, '.agents', 'skills'),
  ];
}

function scoreCapability(
  definition: CapabilityDefinition,
  transcript: string,
  kind: TaskKind,
): number {
  const normalizedTranscript = transcript.trim().toLowerCase();
  let score = 0;

  if (definition.kinds?.includes(kind)) {
    score += 2;
  }

  for (const keyword of definition.keywords) {
    if (keyword.test(normalizedTranscript)) {
      score += 3;
    }
  }

  if (normalizedTranscript.includes(definition.label.toLowerCase())) {
    score += 2;
  }

  return score;
}

function selectFallbackDefinitions(
  catalog: CapabilityDefinition[],
  kind: TaskKind,
): CapabilityDefinition[] {
  const fallbackIds = kind === 'codex'
    ? ['codingWorkflow', 'filesystem', 'terminal']
    : kind === 'tool' || kind === 'mcp'
      ? ['terminal', 'browser', 'filesystem']
      : ['architectureDesigner'];

  return fallbackIds
    .map((id) => catalog.find((definition) => definition.id === id))
    .filter((definition): definition is CapabilityDefinition => Boolean(definition));
}

function toWorkspaceCapability(definition: CapabilityDefinition): AgentWorkspaceCapability {
  return {
    id: definition.id,
    label: definition.label,
    type: definition.type,
    reason: definition.defaultReason,
    source: definition.source,
  };
}

function dedupeDefinitions(definitions: CapabilityDefinition[]): CapabilityDefinition[] {
  const deduped = new Map<string, CapabilityDefinition>();
  for (const definition of definitions) {
    const existingDefinition = deduped.get(definition.id);
    deduped.set(
      definition.id,
      existingDefinition ? mergeCapabilityDefinitions(existingDefinition, definition) : definition,
    );
  }
  return Array.from(deduped.values());
}

function mergeCapabilityDefinitions(
  existingDefinition: CapabilityDefinition,
  nextDefinition: CapabilityDefinition,
): CapabilityDefinition {
  const preferred = getDefinitionPriority(nextDefinition) >= getDefinitionPriority(existingDefinition)
    ? nextDefinition
    : existingDefinition;
  const secondary = preferred === nextDefinition ? existingDefinition : nextDefinition;
  const mergedKinds = Array.from(new Set([
    ...(preferred.kinds ?? []),
    ...(secondary.kinds ?? []),
  ]));
  const mergedKeywordTerms = dedupeStrings([
    ...preferred.keywordTerms,
    ...secondary.keywordTerms,
  ]);

  return {
    ...secondary,
    ...preferred,
    kinds: mergedKinds.length ? mergedKinds : undefined,
    keywordTerms: mergedKeywordTerms,
    keywords: mergedKeywordTerms.map(createKeywordRegex),
    defaultReason: preferred.defaultReason || secondary.defaultReason,
    description: preferred.description || secondary.description,
    originPath: preferred.originPath || secondary.originPath,
    command: preferred.command || secondary.command,
    args: preferred.args || secondary.args,
    inputMode: preferred.inputMode || secondary.inputMode,
    workingDirectory: preferred.workingDirectory || secondary.workingDirectory,
    entryPath: preferred.entryPath || secondary.entryPath,
  };
}

function getDefinitionPriority(definition: CapabilityDefinition): number {
  let score = 0;
  if (definition.source === 'skill') {
    score += 4;
  } else if (definition.source === 'mcp') {
    score += 3;
  } else {
    score += 1;
  }

  if (definition.command) {
    score += 3;
  }
  if (definition.originPath) {
    score += 2;
  }
  if (definition.description) {
    score += 1;
  }

  return score;
}

function normalizeSkillDirectoryName(directoryName: string): string {
  return directoryName.replace(/-\d+(?:\.\d+)+(?:-[a-z0-9]+)?$/i, '');
}

function normalizeCapabilityId(value: string): string {
  const tokens = value
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!tokens.length) {
    return '';
  }

  return tokens
    .map((token, index) => {
      const normalizedToken = token.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '');
      if (!normalizedToken) {
        return '';
      }
      if (index === 0) {
        return normalizedToken.charAt(0).toLowerCase() + normalizedToken.slice(1);
      }
      return normalizedToken.charAt(0).toUpperCase() + normalizedToken.slice(1);
    })
    .join('');
}

function humanizeCapabilityName(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim();

  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function extractSkillDescription(markdown: string): string {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line === '---' || line.startsWith('#') || line.startsWith('```')) {
      continue;
    }

    const normalizedLine = line.replace(/^[-*]\s+/, '').trim();
    if (normalizedLine) {
      return normalizedLine;
    }
  }

  return '';
}

function extractKeywordTerms(text: string): string[] {
  const matches = text.toLowerCase().match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]+/g) ?? [];
  return dedupeStrings(
    matches.filter((keyword) =>
      keyword.length >= 2
      && !COMMON_KEYWORD_STOP_WORDS.has(keyword),
    ),
  ).slice(0, 18);
}

function inferTaskKindsFromKeywordTerms(keywordTerms: string[]): TaskKind[] | undefined {
  const joined = keywordTerms.join(' ');
  const kinds: TaskKind[] = [];
  if (/代码|修复|实现|仓库|脚本|test|build|前端|后端|codex/.test(joined)) {
    kinds.push('codex');
  }
  if (/工具|搜索|浏览器|网页|下载|抓取|调用|automation|browser/.test(joined)) {
    kinds.push('tool');
  }
  if (/mcp/.test(joined)) {
    kinds.push('mcp');
  }
  return kinds.length ? kinds : undefined;
}

function createKeywordRegex(keyword: string): RegExp {
  return new RegExp(escapeRegex(keyword), 'i');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function mergeWorkspaceCapabilities(
  primary: AgentWorkspaceCapability[],
  fallback: AgentWorkspaceCapability[],
): AgentWorkspaceCapability[] {
  const merged = new Map<string, AgentWorkspaceCapability>();
  for (const capability of [...primary, ...fallback]) {
    if (!merged.has(capability.id)) {
      merged.set(capability.id, capability);
    }
  }
  return Array.from(merged.values());
}

const COMMON_KEYWORD_STOP_WORDS = new Set([
  'skill',
  'skills',
  'mcp',
  'mcps',
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'that',
  'this',
  'your',
  'you',
  'use',
  'using',
  'able',
  'agent',
  'agents',
]);
