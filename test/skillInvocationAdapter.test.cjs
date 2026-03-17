const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { prepareSkillExecution } = require('../dist/main-process/agent/skillInvocationAdapter.js');

test('prepareSkillExecution turns playwright requests with a url into executable browser scripts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-playwright-skill-'));
  const skillDir = path.join(tempDir, 'playwright-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  const runEntry = path.join(skillDir, 'run.js');
  fs.writeFileSync(runEntry, 'process.stdin.resume()', 'utf8');

  const prepared = prepareSkillExecution({
    capability: {
      id: 'playwrightSkill',
      label: 'Playwright Skill',
      type: 'skill',
      keywords: [],
      keywordTerms: ['playwright', 'browser'],
      defaultReason: '用于浏览器自动化。',
      source: 'skill',
      originPath: skillDir,
      command: process.execPath,
      args: [runEntry],
      inputMode: 'text-stdin',
      workingDirectory: skillDir,
      entryPath: runEntry,
    },
    transcript: '帮我打开 https://example.com 然后截图看看页面',
    projectRoot: tempDir,
    step: {
      id: 'stepPlaywright',
      title: '运行 Playwright',
      summary: '打开页面并截图',
      status: 'in_progress',
      capabilityType: 'skill',
      capabilityId: 'playwrightSkill',
    },
  });

  assert.equal(prepared.mode, 'execute');
  assert.equal(prepared.inputMode, 'text-stdin');
  assert.deepEqual(prepared.args, [runEntry]);
  assert.match(prepared.textPayload || '', /page\.goto\(targetUrl/);
  assert.match(prepared.textPayload || '', /page\.screenshot/);
});

test('prepareSkillExecution blocks playwright execution when no url is provided', () => {
  const prepared = prepareSkillExecution({
    capability: {
      id: 'playwrightSkill',
      label: 'Playwright Skill',
      type: 'skill',
      keywords: [],
      keywordTerms: ['playwright', 'browser'],
      defaultReason: '用于浏览器自动化。',
      source: 'skill',
      command: process.execPath,
      args: ['run.js'],
      inputMode: 'text-stdin',
      workingDirectory: process.cwd(),
      entryPath: 'run.js',
    },
    transcript: '帮我检查一下这个页面的交互',
    projectRoot: process.cwd(),
    step: {
      id: 'stepPlaywright',
      title: '运行 Playwright',
      summary: '页面检查',
      status: 'in_progress',
      capabilityType: 'skill',
      capabilityId: 'playwrightSkill',
    },
  });

  assert.equal(prepared.mode, 'fallback');
  assert.match(prepared.reason, /url/i);
});

test('prepareSkillExecution routes deepresearch skills to open-link for urls and web-search for plain queries', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celcat-deepresearch-skill-'));
  const skillDir = path.join(tempDir, 'autoglm-deepresearch');
  fs.mkdirSync(skillDir, { recursive: true });
  const openLinkPath = path.join(skillDir, 'open-link.py');
  const webSearchPath = path.join(skillDir, 'web-search.py');
  fs.writeFileSync(openLinkPath, 'print("open-link")', 'utf8');
  fs.writeFileSync(webSearchPath, 'print("web-search")', 'utf8');

  const urlPrepared = prepareSkillExecution({
    capability: {
      id: 'autoglmDeepresearch',
      label: 'Autoglm Deepresearch',
      type: 'skill',
      keywords: [],
      keywordTerms: ['research', 'search'],
      defaultReason: '用于深度检索。',
      source: 'skill',
      originPath: skillDir,
      command: 'py',
      args: ['-3', webSearchPath],
      inputMode: 'transcript-arg',
      workingDirectory: skillDir,
      entryPath: webSearchPath,
    },
    transcript: '帮我读取这个链接 https://example.com/article',
    projectRoot: tempDir,
    step: {
      id: 'stepResearch',
      title: '深度研究',
      summary: '按链接读取',
      status: 'in_progress',
      capabilityType: 'skill',
      capabilityId: 'autoglmDeepresearch',
    },
  });

  assert.equal(urlPrepared.mode, 'execute');
  assert.match(urlPrepared.args.join(' '), /open-link\.py/);
  assert.equal(urlPrepared.args.at(-1), 'https://example.com/article');

  const queryPrepared = prepareSkillExecution({
    capability: {
      id: 'autoglmDeepresearch',
      label: 'Autoglm Deepresearch',
      type: 'skill',
      keywords: [],
      keywordTerms: ['research', 'search'],
      defaultReason: '用于深度检索。',
      source: 'skill',
      originPath: skillDir,
      command: 'py',
      args: ['-3', webSearchPath],
      inputMode: 'transcript-arg',
      workingDirectory: skillDir,
      entryPath: webSearchPath,
    },
    transcript: '帮我搜索一下 2026 年桌宠 agentic 方案',
    projectRoot: tempDir,
    step: {
      id: 'stepResearch',
      title: '深度研究',
      summary: '按查询检索',
      status: 'in_progress',
      capabilityType: 'skill',
      capabilityId: 'autoglmDeepresearch',
    },
  });

  assert.equal(queryPrepared.mode, 'execute');
  assert.match(queryPrepared.args.join(' '), /web-search\.py/);
  assert.equal(queryPrepared.args.at(-1), '帮我搜索一下 2026 年桌宠 agentic 方案');
});
