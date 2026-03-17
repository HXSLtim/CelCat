import fs from 'node:fs';
import path from 'node:path';
import type { AgentWorkspaceStep } from '../../types/tasks';
import type { CapabilityDefinition } from './agentCapabilityCatalog';

export type PreparedSkillExecution =
  | {
      mode: 'execute';
      command: string;
      args: string[];
      inputMode: NonNullable<CapabilityDefinition['inputMode']>;
      workingDirectory: string;
      inputPayload?: string;
      textPayload?: string;
      note?: string;
    }
  | {
      mode: 'fallback';
      reason: string;
      note?: string;
    };

type PrepareSkillExecutionInput = {
  capability: CapabilityDefinition;
  transcript: string;
  step: AgentWorkspaceStep;
  projectRoot: string;
};

export function prepareSkillExecution(
  input: PrepareSkillExecutionInput,
): PreparedSkillExecution {
  const capability = input.capability;
  const skillKey = [
    capability.id,
    capability.label,
    capability.originPath ? path.basename(capability.originPath) : '',
  ].join(' ').toLowerCase();

  if (skillKey.includes('playwright')) {
    return preparePlaywrightSkillExecution(input);
  }

  if (skillKey.includes('autoglm-open-link') || skillKey.includes('openlink')) {
    return prepareOpenLinkExecution(input);
  }

  if (skillKey.includes('autoglm-websearch') || skillKey.includes('websearch')) {
    return prepareTranscriptArgExecution(input, 'websearch.py', '已将请求作为网页搜索查询提交给 skill。');
  }

  if (skillKey.includes('autoglm-search-image') || skillKey.includes('searchimage')) {
    return prepareTranscriptArgExecution(input, 'search-image.py', '已将请求作为图片搜索查询提交给 skill。');
  }

  if (skillKey.includes('autoglm-generate-image') || skillKey.includes('generateimage')) {
    return prepareTranscriptArgExecution(input, 'generate-image.py', '已将请求作为生图提示词提交给 skill。');
  }

  if (skillKey.includes('autoglm-deepresearch') || skillKey.includes('deepresearch')) {
    return prepareDeepResearchExecution(input);
  }

  if (!capability.command) {
    return {
      mode: 'fallback',
      reason: '当前 skill 已识别，但还没有找到可安全执行的入口命令。',
    };
  }

  return {
    mode: 'execute',
    command: capability.command,
    args: capability.args ?? [],
    inputMode: capability.inputMode || 'json-stdin',
    workingDirectory: capability.workingDirectory || input.projectRoot,
  };
}

function preparePlaywrightSkillExecution(
  input: PrepareSkillExecutionInput,
): PreparedSkillExecution {
  const runEntryPath = input.capability.entryPath || input.capability.args?.find((value) => /run\.(?:c|m)?js$/i.test(value));
  if (!runEntryPath || !input.capability.command) {
    return {
      mode: 'fallback',
      reason: 'Playwright skill 缺少可执行入口，暂时只能展示能力信息。',
    };
  }

  const targetUrl = extractFirstUrl(input.transcript);
  if (!targetUrl) {
    return {
      mode: 'fallback',
      reason: 'Playwright skill 需要明确的页面 URL，当前请求里没有检测到可访问地址。',
      note: '建议在请求里补充目标网页 URL，这样 agent 才能生成可执行的浏览器脚本。',
    };
  }

  return {
    mode: 'execute',
    command: input.capability.command,
    args: [runEntryPath],
    inputMode: 'text-stdin',
    workingDirectory: input.capability.workingDirectory || input.projectRoot,
    textPayload: buildPlaywrightScript(input.transcript, targetUrl, input.step),
    note: `已将请求转换成 Playwright 页面脚本，目标地址：${targetUrl}`,
  };
}

function prepareOpenLinkExecution(
  input: PrepareSkillExecutionInput,
): PreparedSkillExecution {
  const targetUrl = extractFirstUrl(input.transcript);
  if (!targetUrl) {
    return {
      mode: 'fallback',
      reason: 'Open Link skill 需要 URL 输入，当前请求中没有检测到链接。',
    };
  }

  return prepareTranscriptArgExecution(
    input,
    'open-link.py',
    `已将链接 ${targetUrl} 交给 Open Link skill 读取。`,
    targetUrl,
  );
}

function prepareDeepResearchExecution(
  input: PrepareSkillExecutionInput,
): PreparedSkillExecution {
  const targetUrl = extractFirstUrl(input.transcript);
  if (targetUrl) {
    const openLinkPlan = prepareTranscriptArgExecution(
      input,
      'open-link.py',
      `检测到 URL，已路由到 open-link.py 读取页面：${targetUrl}`,
      targetUrl,
    );
    if (openLinkPlan.mode === 'execute') {
      return openLinkPlan;
    }
  }

  return prepareTranscriptArgExecution(
    input,
    'web-search.py',
    '未检测到 URL，已将请求路由到 web-search.py 做检索。',
  );
}

function prepareTranscriptArgExecution(
  input: PrepareSkillExecutionInput,
  preferredScriptName: string,
  note: string,
  transcriptOverride?: string,
): PreparedSkillExecution {
  const resolvedScript = resolveSkillScriptPath(input.capability, preferredScriptName);
  if (!resolvedScript) {
    if (!input.capability.command) {
      return {
        mode: 'fallback',
        reason: `${input.capability.label} 没有找到可执行脚本 ${preferredScriptName}。`,
      };
    }

    return {
      mode: 'execute',
      command: input.capability.command,
      args: [...(input.capability.args ?? []), transcriptOverride || input.transcript],
      inputMode: 'transcript-arg',
      workingDirectory: input.capability.workingDirectory || input.projectRoot,
      note,
    };
  }

  const pythonRuntime = resolvePythonRuntime();
  return {
    mode: 'execute',
    command: pythonRuntime.command,
    args: [...pythonRuntime.args, resolvedScript, transcriptOverride || input.transcript],
    inputMode: 'transcript-arg',
    workingDirectory: input.capability.workingDirectory || input.projectRoot,
    note,
  };
}

function resolveSkillScriptPath(
  capability: CapabilityDefinition,
  preferredScriptName: string,
): string | null {
  const skillRoot = capability.originPath || capability.workingDirectory;
  if (!skillRoot) {
    return null;
  }

  const directPath = path.join(skillRoot, preferredScriptName);
  if (pathExists(directPath)) {
    return directPath;
  }

  const fallbacks = [
    preferredScriptName.replace(/-/g, ''),
    preferredScriptName.replace(/-/g, '_'),
  ];

  for (const fallbackName of fallbacks) {
    const candidatePath = path.join(skillRoot, fallbackName);
    if (pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function pathExists(targetPath: string): boolean {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolvePythonRuntime(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: 'py', args: ['-3'] };
  }

  return { command: 'python3', args: [] };
}

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match?.[0] ?? null;
}

function buildPlaywrightScript(
  transcript: string,
  targetUrl: string,
  step: AgentWorkspaceStep,
): string {
  const wantsScreenshot = /截图|screenshot|快照|capture/i.test(transcript);
  const wantsLinks = /链接|href|导航|nav/i.test(transcript);
  const wantsMobile = /手机|移动端|mobile|响应式/i.test(transcript);
  const screenshotFilename = `celcat-playwright-${sanitizeFileSegment(step.id)}.png`;

  return [
    `const targetUrl = ${JSON.stringify(targetUrl)};`,
    `const screenshotFilename = ${JSON.stringify(screenshotFilename)};`,
    'const browser = await chromium.launch({ headless: true });',
    `const context = await browser.newContext(${wantsMobile ? "devices['iPhone 13']" : '{}'});`,
    'const page = await context.newPage();',
    "await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });",
    'await page.waitForTimeout(1200);',
    "console.log(`Visited: ${page.url()}`);",
    "console.log(`Title: ${await page.title()}`);",
    wantsLinks
      ? [
          "const topLinks = await page.locator('a').evaluateAll((links) =>",
          "  links.slice(0, 10).map((link) => ({",
          "    text: (link.textContent || '').trim(),",
          "    href: link.href || '',",
          '  }))',
          ');',
          "console.log(`TopLinks: ${JSON.stringify(topLinks, null, 2)}`);",
        ].join('\n')
      : '',
    wantsScreenshot
      ? [
          'await page.screenshot({',
          '  path: screenshotFilename,',
          '  fullPage: true,',
          '});',
          "console.log(`Screenshot: ${screenshotFilename}`);",
        ].join('\n')
      : '',
    'await context.close();',
    'await browser.close();',
  ].filter(Boolean).join('\n');
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'step';
}
