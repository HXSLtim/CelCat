import type {
  AgentWorkspaceCapability,
  AgentWorkspaceCapabilityType,
  TaskKind,
} from '../../types/tasks';

type CapabilityDefinition = {
  id: string;
  label: string;
  type: AgentWorkspaceCapabilityType;
  keywords: RegExp[];
  kinds?: TaskKind[];
  defaultReason: string;
};

const CAPABILITY_DEFINITIONS: CapabilityDefinition[] = [
  {
    id: 'codingWorkflow',
    label: 'Coding Workflow',
    type: 'skill',
    kinds: ['codex'],
    keywords: [/代码|修复|实现|重构|脚本|仓库|项目|前端|后端|测试/],
    defaultReason: '负责拆解编码步骤、变更实现和验证回归。',
  },
  {
    id: 'frontendDesign',
    label: 'Frontend Design',
    type: 'skill',
    kinds: ['codex'],
    keywords: [/界面|UI|前端|样式|布局|全屏|工作区|workspace/i],
    defaultReason: '用于处理工作区布局、交互结构和可视化适配。',
  },
  {
    id: 'playwrightSkill',
    label: 'Playwright',
    type: 'skill',
    keywords: [/页面|浏览器|截图|回归|自动化|验证|测试/],
    defaultReason: '适合浏览器自动化验证、截图和交互回归。',
  },
  {
    id: 'architectureDesigner',
    label: 'Architecture Designer',
    type: 'skill',
    keywords: [/架构|设计|规划|agentic|workflow|skill|mcp/i],
    defaultReason: '用于规划 agent 工作流、能力分层和系统设计。',
  },
  {
    id: 'gitEssentials',
    label: 'Git Essentials',
    type: 'skill',
    keywords: [/git|提交|分支|变更|版本/],
    defaultReason: '帮助梳理版本变更、工作区状态和提交策略。',
  },
  {
    id: 'filesystem',
    label: 'Filesystem MCP',
    type: 'mcp',
    kinds: ['codex', 'tool', 'mcp'],
    keywords: [/文件|目录|工作区|仓库|配置|读取|写入/],
    defaultReason: '用于读取和写入当前工程文件，建立任务工作区上下文。',
  },
  {
    id: 'terminal',
    label: 'Terminal MCP',
    type: 'mcp',
    kinds: ['codex', 'tool', 'mcp'],
    keywords: [/运行|命令|测试|构建|安装|执行/],
    defaultReason: '用于执行构建、测试、运行脚本和采集命令输出。',
  },
  {
    id: 'git',
    label: 'Git MCP',
    type: 'mcp',
    keywords: [/git|提交|diff|改动|版本/],
    defaultReason: '用于查看改动、分支状态和任务前后的代码差异。',
  },
  {
    id: 'browser',
    label: 'Browser MCP',
    type: 'mcp',
    keywords: [/网页|浏览器|搜索|在线|站点|页面/],
    defaultReason: '用于网页浏览、页面验证和在线信息采集。',
  },
];

export function getAgentCapabilityCatalog(): CapabilityDefinition[] {
  return CAPABILITY_DEFINITIONS.slice();
}

export function selectCapabilitiesForTask(input: {
  transcript: string;
  kind: TaskKind;
}): {
  skills: AgentWorkspaceCapability[];
  mcps: AgentWorkspaceCapability[];
} {
  const transcript = input.transcript.trim();
  const matches = CAPABILITY_DEFINITIONS.filter((definition) => {
    if (definition.kinds?.includes(input.kind)) {
      return true;
    }

    return definition.keywords.some((keyword) => keyword.test(transcript));
  });

  const fallbackCapabilities = CAPABILITY_DEFINITIONS.filter((definition) => {
    if (input.kind === 'codex') {
      return ['codingWorkflow', 'filesystem', 'terminal'].includes(definition.id);
    }

    if (input.kind === 'tool' || input.kind === 'mcp') {
      return ['terminal', 'browser', 'filesystem'].includes(definition.id);
    }

    return ['architectureDesigner'].includes(definition.id);
  });

  const selected = dedupeCapabilities(matches.length ? matches : fallbackCapabilities);

  return {
    skills: selected.filter((capability) => capability.type === 'skill'),
    mcps: selected.filter((capability) => capability.type === 'mcp'),
  };
}

function dedupeCapabilities(
  capabilities: CapabilityDefinition[],
): AgentWorkspaceCapability[] {
  const deduped = new Map<string, AgentWorkspaceCapability>();

  for (const capability of capabilities) {
    if (deduped.has(capability.id)) {
      continue;
    }

    deduped.set(capability.id, {
      id: capability.id,
      label: capability.label,
      type: capability.type,
      reason: capability.defaultReason,
    });
  }

  return Array.from(deduped.values());
}
