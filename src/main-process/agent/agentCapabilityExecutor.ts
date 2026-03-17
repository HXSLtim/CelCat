import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveCapabilityDefinitionById } from './agentCapabilityCatalog';
import { executeExternalCapability } from './externalCapabilityBridge';
import { prepareSkillExecution } from './skillInvocationAdapter';
import type {
  AgentWorkspace,
  AgentWorkspaceArtifact,
  AgentWorkspaceStep,
  TaskKind,
} from '../../types/tasks';

const execFileAsync = promisify(execFile);

type ExecuteStepInput = {
  transcript: string;
  kind: TaskKind;
  autoExecute: boolean;
  workspace: AgentWorkspace;
  step: AgentWorkspaceStep;
  projectRoot?: string;
};

export type ExecuteStepResult = {
  workspace: AgentWorkspace;
  progressSummary?: string;
  observation?: string;
  artifactTone?: AgentWorkspaceArtifact['tone'];
};

export async function executeWorkspaceStep(
  input: ExecuteStepInput,
): Promise<ExecuteStepResult> {
  const projectRoot = input.projectRoot || process.cwd();
  const step = input.step;
  const capability = step.capabilityId
    ? resolveCapabilityDefinitionById(step.capabilityId, { cwd: projectRoot })
    : null;

  if (step.capabilityId === 'filesystem') {
    const artifact = await buildFilesystemArtifact(projectRoot);
    return {
      workspace: appendWorkspaceArtifact(input.workspace, artifact),
      progressSummary: '已读取工作区文件结构和项目脚本。',
      observation: deriveObservationFromArtifact(step, artifact, '已拿到工程目录和脚本概览。'),
      artifactTone: artifact.tone,
    };
  }

  if (step.capabilityId === 'terminal') {
    const artifact = await buildTerminalArtifact({
      transcript: input.transcript,
      autoExecute: input.autoExecute,
      projectRoot,
    });
    return {
      workspace: appendWorkspaceArtifact(input.workspace, artifact),
      progressSummary: artifact.tone === 'success'
        ? '已完成命令执行并整理终端结果。'
        : '已整理终端能力结果。',
      observation: deriveObservationFromArtifact(
        step,
        artifact,
        artifact.tone === 'success' ? '命令执行已完成。' : '命令执行出现告警。',
      ),
      artifactTone: artifact.tone,
    };
  }

  if (step.capabilityType === 'mcp' && capability?.command) {
    const externalResult = await executeExternalCapability({
      capability,
      transcript: input.transcript,
      step,
      autoExecute: input.autoExecute,
      projectRoot,
    });
    return {
      workspace: appendWorkspaceArtifact(input.workspace, externalResult.artifact),
      progressSummary: externalResult.progressSummary,
      observation: deriveObservationFromArtifact(step, externalResult.artifact, externalResult.progressSummary),
      artifactTone: externalResult.artifact.tone,
    };
  }

  if (step.capabilityType === 'skill') {
    if (capability?.command) {
      const preparedSkill = prepareSkillExecution({
        capability,
        transcript: input.transcript,
        step,
        projectRoot,
      });

      if (preparedSkill.mode === 'fallback') {
        const fallbackArtifact: AgentWorkspaceArtifact = {
          id: `${capability.id}SkillFallback`,
          label: `${capability.label} Skill`,
          content: [
            preparedSkill.reason,
            capability.originPath ? `目录：${capability.originPath}` : '',
            capability.description ? `描述：${capability.description}` : '',
          ].filter(Boolean).join('\n'),
          tone: 'warning',
        };

        return {
          workspace: appendWorkspaceArtifact(
            appendWorkspaceNote(
              input.workspace,
              preparedSkill.note || buildCapabilityExecutionNote('skill', capability, step),
            ),
            fallbackArtifact,
          ),
          progressSummary: `${capability.label} 当前未满足自动执行条件，已保留技能信息。`,
          observation: deriveObservationFromArtifact(
            step,
            fallbackArtifact,
            `${capability.label} 需要补充输入或改用更合适的执行方式。`,
          ),
          artifactTone: fallbackArtifact.tone,
        };
      }

      const externalResult = await executeExternalCapability({
        capability,
        transcript: input.transcript,
        step,
        autoExecute: input.autoExecute,
        projectRoot,
        invocationOverride: preparedSkill,
      });
      return {
        workspace: appendWorkspaceNote(
          appendWorkspaceArtifact(input.workspace, externalResult.artifact),
          preparedSkill.note || buildCapabilityExecutionNote('skill', capability, step),
        ),
        progressSummary: externalResult.progressSummary,
        observation: deriveObservationFromArtifact(step, externalResult.artifact, externalResult.progressSummary),
        artifactTone: externalResult.artifact.tone,
      };
    }

    if (capability?.originPath) {
      const artifact = {
        id: `${capability.id}Profile`,
        label: `${capability.label} Profile`,
        content: [
          `目录：${capability.originPath}`,
          capability.description ? `描述：${capability.description}` : '',
          `当前步骤：${step.summary}`,
        ].filter(Boolean).join('\n'),
        tone: 'info',
      } satisfies AgentWorkspaceArtifact;
      return {
        workspace: appendWorkspaceArtifact(
          appendWorkspaceNote(
            input.workspace,
            buildCapabilityExecutionNote('skill', capability, step),
          ),
          artifact,
        ),
        progressSummary: `已装载 ${capability.label} 的技能画像。`,
        observation: deriveObservationFromArtifact(step, artifact, `已载入 ${capability.label} 的技能信息。`),
        artifactTone: artifact.tone,
      };
    }

    return {
      workspace: appendWorkspaceNote(
        input.workspace,
        buildCapabilityExecutionNote('skill', capability, step),
      ),
      progressSummary: `已完成 ${step.title} 的策略整理。`,
      observation: `${step.title} 已完成策略整理。`,
    };
  }

  if (step.capabilityType === 'mcp') {
    return {
      workspace: appendWorkspaceNote(
        input.workspace,
        buildCapabilityExecutionNote('mcp', capability, step),
      ),
      progressSummary: `已推进 ${step.title}。`,
      observation: `${step.title} 已推进，当前以执行上下文整理为主。`,
    };
  }

  return {
    workspace: appendWorkspaceNote(
      input.workspace,
      `步骤「${step.title}」已推进：${step.summary}`,
    ),
    progressSummary: step.summary,
    observation: `${step.title} 已推进。${step.summary}`,
  };
}

function appendWorkspaceArtifact(
  workspace: AgentWorkspace,
  artifact: AgentWorkspaceArtifact,
): AgentWorkspace {
  const nextArtifacts = workspace.artifacts.some((item) => item.id === artifact.id)
    ? workspace.artifacts.map((item) => (item.id === artifact.id ? artifact : item))
    : [...workspace.artifacts, artifact];

  return {
    ...workspace,
    artifacts: nextArtifacts,
  };
}

function appendWorkspaceNote(
  workspace: AgentWorkspace,
  note: string,
): AgentWorkspace {
  if (workspace.notes.includes(note)) {
    return workspace;
  }

  return {
    ...workspace,
    notes: [...workspace.notes, note],
  };
}

async function buildFilesystemArtifact(projectRoot: string): Promise<AgentWorkspaceArtifact> {
  const rootEntries = fs.readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .slice(0, 8)
    .map((entry) => `${entry.isDirectory() ? 'dir' : 'file'}:${entry.name}`);

  const packageJsonPath = path.join(projectRoot, 'package.json');
  let packageSummary = '未检测到 package.json。';
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    packageSummary = [
      `项目名：${packageJson.name || 'unknown'}`,
      `脚本：${Object.keys(packageJson.scripts || {}).join(', ') || 'none'}`,
    ].join('；');
  }

  return {
    id: 'filesystemSnapshot',
    label: 'Filesystem Snapshot',
    content: `${packageSummary}\n根目录：${rootEntries.join(' | ') || 'empty'}`,
    tone: 'info',
  };
}

async function buildTerminalArtifact(input: {
  transcript: string;
  autoExecute: boolean;
  projectRoot: string;
}): Promise<AgentWorkspaceArtifact> {
  const wantsBuild = /构建|build/i.test(input.transcript);
  const wantsTest = /测试|test/i.test(input.transcript);

  if (!input.autoExecute || (!wantsBuild && !wantsTest)) {
    return {
      id: 'terminalSnapshot',
      label: 'Terminal Snapshot',
      content: '当前未触发实际命令执行；如需运行构建或测试，可在自动执行打开后继续推进。',
      tone: 'warning',
    };
  }

  const command = wantsTest ? 'test' : 'build';
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  try {
    const { stdout, stderr } = await execFileAsync(npmCommand, ['run', command], {
      cwd: input.projectRoot,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });

    return {
      id: 'terminalSnapshot',
      label: `Terminal ${command}`,
      content: compactTerminalOutput(stdout || stderr || `npm run ${command} completed`),
      tone: 'success',
    };
  } catch (error: any) {
    const output = [error?.stdout, error?.stderr, error?.message]
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      .join('\n');

    return {
      id: 'terminalSnapshot',
      label: `Terminal ${command}`,
      content: compactTerminalOutput(output || `npm run ${command} failed`),
      tone: 'warning',
    };
  }
}

function compactTerminalOutput(output: string, maxLength = 640): string {
  const normalized = output.replace(/\r/g, '').trim();
  if (!normalized) {
    return '命令没有输出内容。';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function buildCapabilityExecutionNote(
  capabilityType: 'skill' | 'mcp',
  capability: ReturnType<typeof resolveCapabilityDefinitionById>,
  step: AgentWorkspaceStep,
): string {
  if (!capability) {
    return `${capabilityType === 'mcp' ? 'MCP' : 'Skill'} ${step.capabilityId || step.title} 已纳入执行上下文：${step.summary}`;
  }

  const sourceDetail = capability.source === 'skill'
    ? capability.command
      ? `${capability.command}${capability.args?.length ? ` ${capability.args.join(' ')}` : ''}`
      : capability.originPath || '本机技能目录'
    : capability.command
      ? `${capability.command}${capability.args?.length ? ` ${capability.args.join(' ')}` : ''}`
      : '内置能力';

  return [
    `${capabilityType === 'mcp' ? 'MCP' : 'Skill'} ${capability.label} 已纳入执行上下文。`,
    `用途：${capability.defaultReason}`,
    `来源：${sourceDetail}`,
    `当前步骤：${step.summary}`,
  ].join(' ');
}

function deriveObservationFromArtifact(
  step: AgentWorkspaceStep,
  artifact: AgentWorkspaceArtifact,
  fallback: string,
): string {
  const focusLine = extractArtifactFocusLine(artifact.content);
  if (!focusLine) {
    return fallback;
  }

  return compactTerminalOutput(`${step.title}：${focusLine}`, 180);
}

function extractArtifactFocusLine(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) =>
      !/^命令[:：]/.test(line)
      && !/^状态[:：]/.test(line)
      && !/^stdout[:：]?$/i.test(line)
      && !/^stderr[:：]?$/i.test(line)
      && !/^目录[:：]/.test(line)
      && !/^描述[:：]/.test(line)
      && !/^当前步骤[:：]/.test(line),
    );

  if (!lines.length) {
    return '';
  }

  const preferred = lines.find((line) => !/^[{\[]/.test(line)) || lines[0];
  return preferred.length > 140 ? `${preferred.slice(0, 137)}...` : preferred;
}
