const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildVoiceChatSessionBlueprint,
  buildVoiceChatCompatibilityContextBlock,
} = require('../dist/main-process/realtime/voiceChatSessionBlueprint.js');

test('buildVoiceChatSessionBlueprint includes tools, mcp servers, memory, and active task', () => {
  const blueprint = buildVoiceChatSessionBlueprint({
    env: {
      CELCAT_MCP_SERVERS_JSON: JSON.stringify({
        mcpServers: {
          figmaBridge: {
            label: 'Figma Bridge',
            description: '读取设计稿和组件信息',
            command: 'npx',
            args: ['figma-mcp'],
          },
        },
      }),
    },
    cwd: process.cwd(),
    companionIdentity: {
      displayName: '小影',
      identityNotes: ['你会延续和用户之间的熟悉感。'],
      updatedAt: new Date().toISOString(),
    },
    memoryContext: {
      stablePreferences: ['偏好中文、直接执行。'],
      recentMemories: [],
      relevantMemories: [
        {
          title: '浏览器偏好',
          kind: 'tool',
          summary: '用户经常直接要求你打开浏览器和网页。',
          score: 3,
        },
      ],
      longTermMemories: [
        {
          category: 'preferences',
          title: '身份认知',
          summary: '用户希望桌宠保持稳定自称和连续记忆。',
          evidence: '历史对话',
          updatedAt: new Date().toISOString(),
        },
      ],
      capabilitySignals: [],
    },
    latestTask: {
      id: 'task-1',
      title: '后台工具任务',
      progressSummary: '正在打开浏览器并准备访问站点。',
    },
  });

  assert.equal(blueprint.assistant.displayName, '小影');
  assert.equal(blueprint.capabilities.tools.some((tool) => tool.id === 'openBrowser'), true);
  assert.equal(blueprint.capabilities.mcpServers.some((capability) => capability.label === 'Figma Bridge'), true);
  assert.equal(blueprint.memory.relevantMemories.length, 1);
  assert.equal(blueprint.activeTask?.id, 'task-1');
});

test('buildVoiceChatCompatibilityContextBlock renders a compact session summary for compatibility prompts', () => {
  const blueprint = buildVoiceChatSessionBlueprint({
    companionIdentity: {
      displayName: 'CelCat',
      identityNotes: ['你是一个自然陪伴型的中文桌宠 companion。'],
      updatedAt: new Date().toISOString(),
    },
    memoryContext: {
      stablePreferences: ['偏好中文、直接执行。'],
      recentMemories: [],
      relevantMemories: [],
      longTermMemories: [],
      capabilitySignals: [],
    },
    latestTask: null,
  });

  const block = buildVoiceChatCompatibilityContextBlock(blueprint);

  assert.match(block, /当前身份：CelCat/);
  assert.match(block, /稳定偏好：偏好中文、直接执行。/);
  assert.match(block, /已注册工具：/);
  assert.match(block, /可用 MCP：/);
});
