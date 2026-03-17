const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { executeWorkspaceStep } = require('../dist/main-process/agent/agentCapabilityExecutor.js');

test('executeWorkspaceStep runs external MCP bridge commands when configured', async () => {
  const previousConfig = process.env.CELCAT_MCP_SERVERS_JSON;
  process.env.CELCAT_MCP_SERVERS_JSON = JSON.stringify([
    {
      id: 'echoBridge',
      label: 'Echo Bridge',
      description: 'Echo the incoming payload for testing.',
      command: process.execPath,
      args: ['-e', "process.stdin.on('data', (chunk) => process.stdout.write(chunk.toString().toUpperCase()))"],
      keywords: ['echo', 'test'],
    },
  ]);

  try {
    const result = await executeWorkspaceStep({
      transcript: '帮我测试一下外部能力桥接',
      kind: 'mcp',
      autoExecute: true,
      projectRoot: process.cwd(),
      workspace: {
        mission: '测试外部 MCP',
        summary: '执行外部命令桥接',
        model: 'glm:glm5',
        mode: 'executing',
        requiresConfirmation: false,
        notes: [],
        skills: [],
        mcps: [{ id: 'echoBridge', label: 'Echo Bridge', type: 'mcp', reason: '测试桥接', source: 'mcp' }],
        steps: [],
        artifacts: [],
        compressedContext: '',
        memoryRefs: [],
      },
      step: {
        id: 'stepEcho',
        title: '运行 Echo Bridge',
        summary: '执行外部桥接命令',
        status: 'in_progress',
        capabilityType: 'mcp',
        capabilityId: 'echoBridge',
      },
    });

    assert.equal(result.workspace.artifacts.length > 0, true);
    assert.match(result.workspace.artifacts[0].label, /Echo Bridge Output/);
    assert.match(result.workspace.artifacts[0].content, /STATUS：执行成功|状态：执行成功/i);
  } finally {
    if (previousConfig === undefined) {
      delete process.env.CELCAT_MCP_SERVERS_JSON;
    } else {
      process.env.CELCAT_MCP_SERVERS_JSON = previousConfig;
    }
  }
});

test('executeWorkspaceStep runs discovered skill commands when executable entry exists', async () => {
  const previousSkillDirs = process.env.CELCAT_SKILL_DIRS;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-skill-exec-'));
  const skillDir = path.join(tempDir, 'workspace-helper');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '# Workspace Helper\n\nAssist with workspace execution tasks.',
    'utf8',
  );
  fs.writeFileSync(
    path.join(skillDir, 'run.js'),
    [
      "let data = '';",
      "process.stdin.on('data', (chunk) => { data += chunk.toString(); });",
      "process.stdin.on('end', () => {",
      "  process.stdout.write(`skill received: ${data.trim()}`);",
      '});',
    ].join('\n'),
    'utf8',
  );
  process.env.CELCAT_SKILL_DIRS = tempDir;

  try {
    const result = await executeWorkspaceStep({
      transcript: '继续完善 agent workspace',
      kind: 'codex',
      autoExecute: true,
      projectRoot: process.cwd(),
      workspace: {
        mission: '测试 skill 执行',
        summary: '执行 skill 命令',
        model: 'glm:glm5',
        mode: 'executing',
        requiresConfirmation: false,
        notes: [],
        skills: [{ id: 'workspaceHelper', label: 'Workspace Helper', type: 'skill', reason: '测试 skill 运行', source: 'skill' }],
        mcps: [],
        steps: [],
        artifacts: [],
        compressedContext: '',
        memoryRefs: [],
      },
      step: {
        id: 'stepSkill',
        title: '运行 Workspace Helper',
        summary: '执行 skill 命令桥',
        status: 'in_progress',
        capabilityType: 'skill',
        capabilityId: 'workspaceHelper',
      },
    });

    assert.equal(result.workspace.artifacts.length > 0, true);
    assert.match(result.workspace.artifacts[0].label, /Workspace Helper Output/);
    assert.match(result.workspace.artifacts[0].content, /状态：执行成功/i);
    assert.match(result.workspace.artifacts[0].content, /skill received:/i);
    assert.equal(result.workspace.notes.some((note) => /Skill Workspace Helper 已纳入执行上下文/.test(note)), true);
  } finally {
    if (previousSkillDirs === undefined) {
      delete process.env.CELCAT_SKILL_DIRS;
    } else {
      process.env.CELCAT_SKILL_DIRS = previousSkillDirs;
    }
  }
});
