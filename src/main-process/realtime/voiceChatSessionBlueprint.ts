import type { AgentPlanningMemoryContext, CompanionIdentityProfile } from '../agent/agentMemoryStore';
import { getAgentCapabilityCatalogEntries } from '../agent/agentCapabilityCatalog';
import type { AgentCapabilityCatalogEntry } from '../../types/tasks';
import type { VoiceChatToolDefinition } from './voiceChatToolRegistry';
import { getVoiceChatToolDefinitions } from './voiceChatToolRegistry';

export type VoiceChatSessionBlueprint = {
  generatedAt: string;
  transport: {
    providerMode: 'voiceChat';
    lifecycle: 'startVoiceChat-compatible';
    migrationTarget: 'StartVoiceChat + Function Calling + MCP + Memory';
  };
  assistant: {
    displayName: string;
    identityNotes: string[];
    systemPrompt: string;
  };
  memory: {
    stablePreferences: string[];
    relevantMemories: string[];
    longTermMemories: string[];
  };
  capabilities: {
    tools: VoiceChatToolDefinition[];
    mcpServers: AgentCapabilityCatalogEntry[];
  };
  activeTask: {
    id: string;
    title: string;
    progressSummary: string;
  } | null;
};

export function buildVoiceChatSessionBlueprint(input: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  companionIdentity?: Pick<CompanionIdentityProfile, 'displayName' | 'identityNotes'> | null;
  memoryContext?: AgentPlanningMemoryContext | null;
  latestTask?: {
    id: string;
    title: string;
    progressSummary: string;
  } | null;
}): VoiceChatSessionBlueprint {
  const companionIdentity = input.companionIdentity ?? null;
  const memoryContext = input.memoryContext ?? null;
  const displayName = companionIdentity?.displayName || 'CelCat';
  const identityNotes = companionIdentity?.identityNotes.slice(0, 4) || [
    '你是一个自然陪伴型的中文桌宠 companion。',
  ];
  const mcpServers = getAgentCapabilityCatalogEntries({
    env: input.env,
    cwd: input.cwd,
  }).filter((capability) => capability.type === 'mcp');
  const tools = getVoiceChatToolDefinitions();

  return {
    generatedAt: new Date().toISOString(),
    transport: {
      providerMode: 'voiceChat',
      lifecycle: 'startVoiceChat-compatible',
      migrationTarget: 'StartVoiceChat + Function Calling + MCP + Memory',
    },
    assistant: {
      displayName,
      identityNotes,
      systemPrompt: buildVoiceChatSystemPrompt({
        displayName,
        identityNotes,
      }),
    },
    memory: {
      stablePreferences: memoryContext?.stablePreferences.slice(0, 4) || [],
      relevantMemories: memoryContext?.relevantMemories.slice(0, 3).map((memory) => memory.summary) || [],
      longTermMemories: memoryContext?.longTermMemories.slice(0, 3).map((memory) => memory.summary) || [],
    },
    capabilities: {
      tools,
      mcpServers,
    },
    activeTask: input.latestTask ?? null,
  };
}

export function buildVoiceChatCompatibilityContextBlock(blueprint: VoiceChatSessionBlueprint): string {
  const toolSummary = blueprint.capabilities.tools
    .map((tool) => `${tool.id}: ${tool.description}`)
    .join('；');
  const mcpSummary = blueprint.capabilities.mcpServers.length
    ? blueprint.capabilities.mcpServers
      .slice(0, 5)
      .map((capability) => `${capability.label}: ${capability.defaultReason}`)
      .join('；')
    : '当前没有额外 MCP。';

  return [
    `当前身份：${blueprint.assistant.displayName}`,
    blueprint.assistant.identityNotes.length
      ? `身份认知：${blueprint.assistant.identityNotes.join('；')}`
      : '',
    blueprint.memory.stablePreferences.length
      ? `稳定偏好：${blueprint.memory.stablePreferences.join('；')}`
      : '',
    blueprint.memory.relevantMemories.length
      ? `相关记忆：${blueprint.memory.relevantMemories.join('；')}`
      : '',
    blueprint.memory.longTermMemories.length
      ? `长期记忆：${blueprint.memory.longTermMemories.join('；')}`
      : '',
    blueprint.activeTask
      ? `当前后台任务：${blueprint.activeTask.title}，进度：${blueprint.activeTask.progressSummary}`
      : '',
    `已注册工具：${toolSummary}`,
    `可用 MCP：${mcpSummary}`,
  ].filter(Boolean).join('\n');
}

function buildVoiceChatSystemPrompt(input: {
  displayName: string;
  identityNotes: string[];
}): string {
  return [
    `你是 ${input.displayName}，一个持续陪伴用户的中文桌宠 companion。`,
    `你现在对用户自称“${input.displayName}”。`,
    ...input.identityNotes.map((note) => `- ${note}`),
    '你需要优先用 Function Calling / MCP / 后台 agent 处理执行型任务，而不是口头假装完成。',
  ].join('\n');
}
