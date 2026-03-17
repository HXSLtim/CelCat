export type VoiceChatToolDefinition = {
  id: string;
  description: string;
  inputSchema: Record<string, unknown>;
  route: 'agent' | 'identity' | 'browser';
};

const TOOL_DEFINITIONS: VoiceChatToolDefinition[] = [
  {
    id: 'startAgentTask',
    route: 'agent',
    description: '将多步骤执行类请求转交给后台 agent 工作区。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['codex', 'tool', 'claude', 'mcp'] },
        transcript: { type: 'string' },
      },
      required: ['kind', 'transcript'],
    },
  },
  {
    id: 'renameCompanion',
    route: 'identity',
    description: '当用户明确要求你改名、换名、以后改叫某个名字时，更新桌宠当前对外使用的名字与身份认知。',
    inputSchema: {
      type: 'object',
      properties: {
        displayName: { type: 'string' },
      },
      required: ['displayName'],
    },
  },
  {
    id: 'openBrowser',
    route: 'browser',
    description: '打开浏览器或具体网页，由本地 agent/工具层实际执行。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        query: { type: 'string' },
      },
    },
  },
];

export function getVoiceChatToolDefinitions(): VoiceChatToolDefinition[] {
  return TOOL_DEFINITIONS.slice();
}

export function getVoiceChatToolPromptSummary(): string {
  return TOOL_DEFINITIONS
    .map((tool) => `${tool.id}: ${tool.description}`)
    .join(' | ');
}
