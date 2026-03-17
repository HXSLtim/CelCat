const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  getAgentCapabilityCatalog,
  getSerializableAgentCapabilityCatalog,
  selectCapabilitiesForTask,
  resolveCapabilityDefinitionById,
} = require('../dist/main-process/agent/agentCapabilityCatalog.js');

test('agent capability catalog discovers installed skills from local skill roots', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-skills-'));
  const skillDir = path.join(tempDir, 'frontend-magic-1.0.0');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '# Frontend Magic\n\nCreate polished fullscreen layouts and visual interactions.',
    'utf8',
  );

  const catalog = getAgentCapabilityCatalog({
    env: {},
    cwd: tempDir,
    skillRoots: [tempDir],
  });
  const skill = catalog.find((item) => item.id === 'frontendMagic');

  assert.equal(Boolean(skill), true);
  assert.equal(skill?.type, 'skill');
  assert.match(skill?.defaultReason || '', /fullscreen|visual|layout/i);
});

test('agent capability catalog discovers runnable skill entry metadata', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-skills-'));
  const skillDir = path.join(tempDir, 'workspace-helper');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '# Workspace Helper\n\nAssist with workspace preparation and task execution.',
    'utf8',
  );
  fs.writeFileSync(
    path.join(skillDir, 'run.js'),
    "process.stdin.on('data', (chunk) => process.stdout.write(chunk.toString()))",
    'utf8',
  );

  const skill = resolveCapabilityDefinitionById('workspaceHelper', {
    env: {},
    cwd: tempDir,
    skillRoots: [tempDir],
  });

  assert.equal(Boolean(skill), true);
  assert.equal(skill?.type, 'skill');
  assert.equal(skill?.command, process.execPath);
  assert.deepEqual(skill?.args, [path.join(skillDir, 'run.js')]);
  assert.equal(skill?.inputMode, 'text-stdin');
  assert.equal(skill?.workingDirectory, skillDir);
});

test('agent capability catalog prefers discovered runnable skill metadata over builtin placeholders', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-skills-'));
  const skillDir = path.join(tempDir, 'playwright-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '# Playwright Skill\n\nAutomate browser tasks and screenshots.',
    'utf8',
  );
  fs.writeFileSync(path.join(skillDir, 'run.js'), 'process.exit(0)', 'utf8');

  const skill = resolveCapabilityDefinitionById('playwrightSkill', {
    env: {},
    cwd: tempDir,
    skillRoots: [tempDir],
  });

  assert.equal(Boolean(skill), true);
  assert.equal(skill?.source, 'skill');
  assert.equal(skill?.command, process.execPath);
  assert.equal(skill?.originPath, skillDir);
  assert.deepEqual(skill?.args, [path.join(skillDir, 'run.js')]);
});

test('agent capability catalog parses external MCP servers from env json', () => {
  const catalog = getAgentCapabilityCatalog({
    env: {
      CELCAT_MCP_SERVERS_JSON: JSON.stringify({
        mcpServers: {
          figmaBridge: {
            label: 'Figma Bridge',
            description: 'Read design tokens and artboards from Figma.',
            command: 'npx',
            args: ['figma-mcp'],
            keywords: ['figma', 'design', 'token'],
          },
        },
      }),
    },
    cwd: process.cwd(),
    skillRoots: [],
  });

  const mcp = resolveCapabilityDefinitionById('figmaBridge', {
    env: {
      CELCAT_MCP_SERVERS_JSON: JSON.stringify({
        mcpServers: {
          figmaBridge: {
            label: 'Figma Bridge',
            description: 'Read design tokens and artboards from Figma.',
            command: 'npx',
            args: ['figma-mcp'],
            keywords: ['figma', 'design', 'token'],
          },
        },
      }),
    },
    cwd: process.cwd(),
    skillRoots: [],
  });

  assert.equal(catalog.some((item) => item.id === 'figmaBridge'), true);
  assert.equal(mcp?.type, 'mcp');
  assert.equal(mcp?.command, 'npx');
});

test('agent capability selection prefers discovered skills and configured mcps for matching requests', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-skills-'));
  const skillDir = path.join(tempDir, 'full-screen-storyteller');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '# Full Screen Storyteller\n\nDesign immersive fullscreen companion scenes and dialogue layouts.',
    'utf8',
  );

  const catalog = getAgentCapabilityCatalog({
    env: {
      CELCAT_MCP_SERVERS_JSON: JSON.stringify([
        {
          id: 'figmaBridge',
          label: 'Figma Bridge',
          description: 'Read design frames from Figma and sync assets.',
          command: 'npx',
          args: ['figma-mcp'],
          keywords: ['figma', 'design', 'layout'],
        },
      ]),
    },
    cwd: tempDir,
    skillRoots: [tempDir],
  });

  const selected = selectCapabilitiesForTask({
    transcript: '帮我根据 Figma 设计稿做 fullscreen dialogue layout 工作区',
    kind: 'codex',
  }, catalog);

  assert.equal(selected.skills.some((skill) => skill.id === 'fullScreenStoryteller'), true);
  assert.equal(selected.mcps.some((mcp) => mcp.id === 'figmaBridge'), true);
});

test('serializable capability catalog strips runtime-only regex fields before model planning', () => {
  const catalog = getSerializableAgentCapabilityCatalog({
    env: {},
    cwd: process.cwd(),
    skillRoots: [],
  });

  assert.equal(Array.isArray(catalog[0]?.keywords), true);
  assert.equal(Object.prototype.hasOwnProperty.call(catalog[0], 'keywords'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(catalog[0], 'defaultReason'), true);
});
