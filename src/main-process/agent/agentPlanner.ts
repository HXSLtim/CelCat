import {
  getSafeAgentModelMeta,
  readAgentModelConfig,
  type AgentModelConfig,
} from './agentModelConfig';
import {
  getAgentCapabilityCatalog,
  selectCapabilitiesForTask,
} from './agentCapabilityCatalog';
import type { AgentMemoryStore } from './agentMemoryStore';
import { logDebug } from '../../shared/debugLogger';
import type {
  AgentWorkspace,
  AgentWorkspaceCapability,
  AgentWorkspaceStep,
  TaskKind,
  TaskRiskLevel,
} from '../../types/tasks';

type PlanTaskInput = {
  transcript: string;
  kind: TaskKind;
  riskLevel: TaskRiskLevel;
  autoExecute: boolean;
};

type PlannerResponse = {
  mission?: string;
  summary?: string;
  requiresConfirmation?: boolean;
  notes?: string[];
  skills?: Array<{ id?: string; reason?: string }>;
  mcps?: Array<{ id?: string; reason?: string }>;
  steps?: Array<{
    title?: string;
    summary?: string;
    capabilityType?: 'skill' | 'mcp';
    capabilityId?: string;
  }>;
};

const GLM_CHAT_COMPLETIONS_PATH = '/chat/completions';

export class AgentPlanner {
  constructor(
    private readonly config: AgentModelConfig = readAgentModelConfig(process.env),
    private readonly agentMemoryStore?: Pick<AgentMemoryStore, 'getPlanningContext'>,
  ) {}

  async planTask(input: PlanTaskInput): Promise<AgentWorkspace> {
    const memoryContext = this.agentMemoryStore?.getPlanningContext();
    const fallbackWorkspace = buildFallbackWorkspace(input, this.config, memoryContext);
    if (!this.config.enabled) {
      return fallbackWorkspace;
    }

    try {
      const modelWorkspace = await this.planTaskWithModel(input, memoryContext);
      return mergeWorkspaceWithFallback(modelWorkspace, fallbackWorkspace);
    } catch (error: any) {
      logDebug('agent', 'Falling back to local planner', {
        reason: error?.message || 'unknown error',
        model: getSafeAgentModelMeta(this.config),
      });
      return fallbackWorkspace;
    }
  }

  private async planTaskWithModel(
    input: PlanTaskInput,
    memoryContext?: ReturnType<NonNullable<AgentMemoryStore['getPlanningContext']>>,
  ): Promise<AgentWorkspace> {
    const response = await fetch(`${this.config.baseUrl}${GLM_CHAT_COMPLETIONS_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: [
              '你是一个桌面 companion 内部的 agent planner。',
              '你需要根据用户请求生成一个结构化工作区 JSON。',
              '请优先选择合适的 skill 和 mcp 能力，并输出 3-6 个可执行步骤。',
              '只输出 JSON，不要输出 Markdown。',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              request: input.transcript,
              kind: input.kind,
              riskLevel: input.riskLevel,
              autoExecute: input.autoExecute,
              memoryContext,
              capabilityCatalog: getAgentCapabilityCatalog(),
              outputSchema: {
                mission: 'string',
                summary: 'string',
                requiresConfirmation: 'boolean',
                notes: ['string'],
                skills: [{ id: 'string', reason: 'string' }],
                mcps: [{ id: 'string', reason: 'string' }],
                steps: [{
                  title: 'string',
                  summary: 'string',
                  capabilityType: 'skill|mcp|optional',
                  capabilityId: 'string|optional',
                }],
              },
            }),
          },
        ],
        response_format: {
          type: 'json_object',
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Agent planner request failed (${response.status})`);
    }

    const payload = await response.json() as Record<string, any>;
    const content = extractPlannerContent(payload);
    const parsed = JSON.parse(content) as PlannerResponse;

    return normalizePlannerResponse(parsed, input, this.config, memoryContext);
  }
}

function buildFallbackWorkspace(
  input: PlanTaskInput,
  config: AgentModelConfig,
  memoryContext?: ReturnType<NonNullable<AgentMemoryStore['getPlanningContext']>>,
): AgentWorkspace {
  const selectedCapabilities = selectCapabilitiesForTask({
    transcript: input.transcript,
    kind: input.kind,
  });
  const requiresConfirmation = !input.autoExecute && input.riskLevel !== 'low';
  const stepTemplates = createFallbackSteps(input, selectedCapabilities.skills, selectedCapabilities.mcps);

  return {
    mission: input.transcript,
    summary: createFallbackSummary(input.kind),
    model: `${config.provider}:${config.model}`,
    mode: requiresConfirmation ? 'blocked' : 'planning',
    requiresConfirmation,
    notes: [
      requiresConfirmation
        ? '当前任务包含中高风险动作，默认先进入等待确认。'
        : '当前任务会直接进入 agent 执行流。',
      '如果远端 agent 规划不可用，会自动退回到本地启发式工作区。',
      ...(memoryContext?.recentMemories[0]?.compressedContext
        ? [`最近相关记忆：${memoryContext.recentMemories[0].compressedContext}`]
        : []),
    ],
    skills: selectedCapabilities.skills,
    mcps: selectedCapabilities.mcps,
    steps: stepTemplates,
    artifacts: [],
    compressedContext: '',
    memoryRefs: [],
  };
}

function mergeWorkspaceWithFallback(
  workspace: AgentWorkspace,
  fallbackWorkspace: AgentWorkspace,
): AgentWorkspace {
  return {
    ...fallbackWorkspace,
    ...workspace,
    skills: workspace.skills.length ? workspace.skills : fallbackWorkspace.skills,
    mcps: workspace.mcps.length ? workspace.mcps : fallbackWorkspace.mcps,
    steps: workspace.steps.length ? workspace.steps : fallbackWorkspace.steps,
    notes: workspace.notes.length ? workspace.notes : fallbackWorkspace.notes,
  };
}

function normalizePlannerResponse(
  parsed: PlannerResponse,
  input: PlanTaskInput,
  config: AgentModelConfig,
  memoryContext?: ReturnType<NonNullable<AgentMemoryStore['getPlanningContext']>>,
): AgentWorkspace {
  const fallback = buildFallbackWorkspace(input, config, memoryContext);
  const selectedCapabilities = selectCapabilitiesForTask({
    transcript: input.transcript,
    kind: input.kind,
  });

  const skillMap = new Map(selectedCapabilities.skills.map((capability) => [capability.id, capability]));
  const mcpMap = new Map(selectedCapabilities.mcps.map((capability) => [capability.id, capability]));

  const skills = normalizeCapabilities(parsed.skills, skillMap);
  const mcps = normalizeCapabilities(parsed.mcps, mcpMap);
  const steps = normalizeSteps(parsed.steps, skills, mcps);
  const requiresConfirmation = parsed.requiresConfirmation ?? (!input.autoExecute && input.riskLevel !== 'low');

  return {
    mission: parsed.mission?.trim() || input.transcript,
    summary: parsed.summary?.trim() || fallback.summary,
    model: `${config.provider}:${config.model}`,
    mode: requiresConfirmation ? 'blocked' : 'planning',
    requiresConfirmation,
    notes: Array.isArray(parsed.notes) && parsed.notes.length
      ? parsed.notes.filter((note): note is string => typeof note === 'string' && Boolean(note.trim()))
      : fallback.notes,
    skills: skills.length ? skills : fallback.skills,
    mcps: mcps.length ? mcps : fallback.mcps,
    steps: steps.length ? steps : fallback.steps,
    artifacts: [],
    compressedContext: '',
    memoryRefs: [],
  };
}

function normalizeCapabilities(
  rawCapabilities: PlannerResponse['skills'] | PlannerResponse['mcps'],
  capabilityMap: Map<string, AgentWorkspaceCapability>,
): AgentWorkspaceCapability[] {
  if (!Array.isArray(rawCapabilities)) {
    return [];
  }

  const normalized: AgentWorkspaceCapability[] = [];
  for (const rawCapability of rawCapabilities) {
    const capabilityId = rawCapability?.id;
    if (!capabilityId || !capabilityMap.has(capabilityId)) {
      continue;
    }

    const baseCapability = capabilityMap.get(capabilityId)!;
    normalized.push({
      ...baseCapability,
      reason: typeof rawCapability.reason === 'string' && rawCapability.reason.trim()
        ? rawCapability.reason.trim()
        : baseCapability.reason,
    });
  }

  return dedupeWorkspaceCapabilities(normalized);
}

function normalizeSteps(
  rawSteps: PlannerResponse['steps'],
  skills: AgentWorkspaceCapability[],
  mcps: AgentWorkspaceCapability[],
): AgentWorkspaceStep[] {
  if (!Array.isArray(rawSteps)) {
    return [];
  }

  const knownCapabilities = new Set([
    ...skills.map((capability) => capability.id),
    ...mcps.map((capability) => capability.id),
  ]);

  const normalizedSteps: AgentWorkspaceStep[] = [];

  rawSteps.forEach((step, index) => {
    const title = step?.title?.trim();
    const summary = step?.summary?.trim();
    if (!title || !summary) {
      return;
    }

    const capabilityType = step.capabilityType === 'skill' || step.capabilityType === 'mcp'
      ? step.capabilityType
      : undefined;
    const capabilityId = step.capabilityId && knownCapabilities.has(step.capabilityId)
      ? step.capabilityId
      : undefined;

    normalizedSteps.push({
      id: `step${index + 1}`,
      title,
      summary,
      status: index === 0 ? 'in_progress' : 'pending',
      capabilityType,
      capabilityId,
    });
  });

  return normalizedSteps;
}

function createFallbackSteps(
  input: PlanTaskInput,
  skills: AgentWorkspaceCapability[],
  mcps: AgentWorkspaceCapability[],
): AgentWorkspaceStep[] {
  const primarySkill = skills[0];
  const primaryMcp = mcps[0];

  return [
    {
      id: 'step1',
      title: '建立工作区上下文',
      summary: '汇总用户目标、工程范围和当前任务风险。',
      status: 'in_progress',
      capabilityType: primaryMcp ? 'mcp' : undefined,
      capabilityId: primaryMcp?.id,
    },
    {
      id: 'step2',
      title: '生成执行计划',
      summary: '根据任务类型拆分 agent 步骤，并选择合适的 skill 与 MCP。',
      status: 'pending',
      capabilityType: primarySkill ? 'skill' : undefined,
      capabilityId: primarySkill?.id,
    },
    {
      id: 'step3',
      title: '执行与验证',
      summary: input.kind === 'codex'
        ? '读写工作区文件、执行命令并验证结果。'
        : '按任务目标调用能力并整理可交付结果。',
      status: 'pending',
      capabilityType: primaryMcp ? 'mcp' : undefined,
      capabilityId: primaryMcp?.id,
    },
    {
      id: 'step4',
      title: '总结输出',
      summary: '将 agent 过程沉淀为工作区摘要，准备复述给用户。',
      status: 'pending',
    },
  ];
}

function createFallbackSummary(kind: TaskKind): string {
  if (kind === 'codex') {
    return '这是一项编码型 agent 任务，工作区会围绕代码理解、实现、验证和回顾展开。';
  }

  if (kind === 'tool' || kind === 'mcp') {
    return '这是一项工具型 agent 任务，工作区会围绕能力选择、执行和结果整理展开。';
  }

  return '这是一项分析型 agent 任务，工作区会围绕问题拆解、规划和输出总结展开。';
}

function dedupeWorkspaceCapabilities(
  capabilities: AgentWorkspaceCapability[],
): AgentWorkspaceCapability[] {
  const deduped = new Map<string, AgentWorkspaceCapability>();
  for (const capability of capabilities) {
    if (!deduped.has(capability.id)) {
      deduped.set(capability.id, capability);
    }
  }
  return Array.from(deduped.values());
}

function extractPlannerContent(payload: Record<string, any>): string {
  const candidate =
    payload.choices?.[0]?.message?.content
    ?? payload.choices?.[0]?.delta?.content
    ?? payload.output?.text
    ?? payload.text;

  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim();
  }

  throw new Error('Agent planner returned an empty response');
}
