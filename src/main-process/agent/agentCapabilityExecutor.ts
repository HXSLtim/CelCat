import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

type ExecuteStepResult = {
  workspace: AgentWorkspace;
  progressSummary?: string;
};

export async function executeWorkspaceStep(
  input: ExecuteStepInput,
): Promise<ExecuteStepResult> {
  const projectRoot = input.projectRoot || process.cwd();
  const step = input.step;

  if (step.capabilityId === 'filesystem') {
    return {
      workspace: appendWorkspaceArtifact(input.workspace, await buildFilesystemArtifact(projectRoot)),
      progressSummary: '已读取工作区文件结构和项目脚本。',
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
    };
  }

  if (step.capabilityType === 'skill') {
    return {
      workspace: appendWorkspaceNote(
        input.workspace,
        `Skill ${step.capabilityId || step.title} 已纳入执行上下文：${step.summary}`,
      ),
      progressSummary: `已完成 ${step.title} 的策略整理。`,
    };
  }

  if (step.capabilityType === 'mcp') {
    return {
      workspace: appendWorkspaceNote(
        input.workspace,
        `MCP ${step.capabilityId || step.title} 已参与任务执行：${step.summary}`,
      ),
      progressSummary: `已推进 ${step.title}。`,
    };
  }

  return {
    workspace: appendWorkspaceNote(
      input.workspace,
      `步骤「${step.title}」已推进：${step.summary}`,
    ),
    progressSummary: step.summary,
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
