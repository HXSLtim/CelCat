const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildVoiceChatSessionBlueprint,
  buildVoiceChatStartConfig,
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
  assert.equal(blueprint.nativeSessionConfig.functions.some((tool) => tool.name === 'openBrowser'), true);
  assert.equal(blueprint.nativeSessionConfig.mcps.some((capability) => capability.label === 'Figma Bridge'), true);
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

test('buildVoiceChatSessionBlueprint system prompt distinguishes rename requests from name questions', () => {
  const blueprint = buildVoiceChatSessionBlueprint({
    companionIdentity: {
      displayName: 'CelCat',
      identityNotes: ['你是一个自然陪伴型的中文桌宠 companion。'],
      updatedAt: new Date().toISOString(),
    },
    memoryContext: {
      stablePreferences: [],
      recentMemories: [],
      relevantMemories: [],
      longTermMemories: [],
      capabilitySignals: [],
    },
    latestTask: null,
  });

  assert.match(blueprint.assistant.systemPrompt, /你叫什么名字.*不要调用 renameCompanion/);
  assert.match(blueprint.assistant.systemPrompt, /只有当用户明确要求你改名/);
});

test('buildVoiceChatStartConfig serializes native voiceChat-oriented fields from the blueprint', () => {
  const blueprint = buildVoiceChatSessionBlueprint({
    companionIdentity: {
      displayName: '小影',
      identityNotes: ['你会延续和用户之间的熟悉感。'],
      updatedAt: new Date().toISOString(),
    },
    memoryContext: {
      stablePreferences: ['偏好中文、直接执行。'],
      recentMemories: [],
      relevantMemories: [{
        title: '浏览器偏好',
        kind: 'tool',
        summary: '用户经常直接要求你打开浏览器和网页。',
        score: 3,
      }],
      longTermMemories: [],
      capabilitySignals: [],
    },
    latestTask: {
      id: 'task-1',
      title: '后台工具任务',
      progressSummary: '正在打开浏览器。',
    },
  });

  const startConfig = buildVoiceChatStartConfig(blueprint);

  assert.equal(startConfig.systemMessages.some((item) => /小影/.test(item)), true);
  assert.equal(startConfig.functions.some((item) => item.name === 'openBrowser'), true);
  assert.equal(Array.isArray(startConfig.mcps), true);
  assert.equal(startConfig.memory.stablePreferences[0], '偏好中文、直接执行。');
  assert.match(startConfig.activeTaskSummary, /后台工具任务/);
});

test('buildVoiceChatSessionBlueprint excludes task mission summaries from prompt-oriented memory fields', () => {
  const blueprint = buildVoiceChatSessionBlueprint({
    companionIdentity: {
      displayName: '豆包',
      identityNotes: ['你会延续和用户之间的熟悉感。'],
      updatedAt: new Date().toISOString(),
    },
    memoryContext: {
      stablePreferences: ['偏好中文、直接执行。'],
      recentMemories: [],
      relevantMemories: [{
        title: '后台工具任务',
        kind: 'tool',
        summary: '帮我打开一下浏览器。 | Mission: 帮我打开一下浏览器。 Mode: completed Capabilities: skill:Playwright',
        score: 40,
      }],
      longTermMemories: [],
      capabilitySignals: [],
    },
    latestTask: {
      id: 'task-1',
      title: '后台工具任务',
      progressSummary: '正在打开浏览器。',
    },
  });

  assert.equal(blueprint.memory.relevantMemories.length, 0);
  assert.equal(blueprint.nativeSessionConfig.systemMessages.some((item) => /Mission:|当前后台任务：/.test(item)), false);
  assert.match(blueprint.nativeSessionConfig.activeTaskSummary, /后台工具任务/);
});
