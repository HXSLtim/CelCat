import { spawn } from 'node:child_process';
import type { AgentWorkspaceArtifact, AgentWorkspaceStep } from '../../types/tasks';
import type { CapabilityDefinition } from './agentCapabilityCatalog';

type ExecuteExternalCapabilityInput = {
  capability: CapabilityDefinition;
  transcript: string;
  step: AgentWorkspaceStep;
  autoExecute: boolean;
  projectRoot: string;
  invocationOverride?: {
    command?: string;
    args?: string[];
    inputMode?: NonNullable<CapabilityDefinition['inputMode']>;
    workingDirectory?: string;
    inputPayload?: string;
    textPayload?: string;
  };
};

type ExecuteExternalCapabilityResult = {
  artifact: AgentWorkspaceArtifact;
  progressSummary: string;
};

export async function executeExternalCapability(
  input: ExecuteExternalCapabilityInput,
): Promise<ExecuteExternalCapabilityResult> {
  const capabilityLabel = input.capability.label;
  const resolvedCommand = input.invocationOverride?.command || input.capability.command;
  const resolvedArgs = input.invocationOverride?.args ?? input.capability.args ?? [];

  if (!resolvedCommand) {
    return {
      artifact: {
        id: `${input.capability.id}Bridge`,
        label: `${capabilityLabel} Bridge`,
        content: [
          '当前能力已被发现，但还没有可执行命令。',
          input.capability.originPath ? `来源目录：${input.capability.originPath}` : '',
          input.capability.description ? `描述：${input.capability.description}` : '',
        ].filter(Boolean).join('\n'),
        tone: 'warning',
      },
      progressSummary: `已识别 ${capabilityLabel}，但还没有可执行桥接命令。`,
    };
  }

  if (!input.autoExecute) {
    return {
      artifact: {
        id: `${input.capability.id}Bridge`,
        label: `${capabilityLabel} Bridge`,
        content: [
          '检测到外部能力命令，但当前未开启自动执行。',
          `命令：${resolvedCommand}${resolvedArgs.length ? ` ${resolvedArgs.join(' ')}` : ''}`,
        ].join('\n'),
        tone: 'warning',
      },
      progressSummary: `已识别 ${capabilityLabel} 的外部命令桥接。`,
    };
  }

  const payload = JSON.stringify({
    transcript: input.transcript,
    step: {
      id: input.step.id,
      title: input.step.title,
      summary: input.step.summary,
    },
    capability: {
      id: input.capability.id,
      label: input.capability.label,
      type: input.capability.type,
      source: input.capability.source,
    },
  }, null, 2);
  const defaultTextPayload = [
    `任务请求：${input.transcript}`,
    `步骤标题：${input.step.title}`,
    `步骤摘要：${input.step.summary}`,
    `能力：${input.capability.label} (${input.capability.type}/${input.capability.source})`,
    '请输出本次执行的关键信息与结果。',
  ].join('\n');
  const command = resolvedCommand;
  const args = resolvedArgs;
  const inputMode = input.invocationOverride?.inputMode || input.capability.inputMode || 'json-stdin';
  const workingDirectory = input.invocationOverride?.workingDirectory || input.capability.workingDirectory || input.projectRoot;
  const inputPayload = input.invocationOverride?.inputPayload || payload;
  const textPayload = input.invocationOverride?.textPayload || defaultTextPayload;

  const result = await runExternalCommand({
    command,
    args,
    projectRoot: workingDirectory,
    inputPayload,
    textPayload,
    inputMode,
    capability: input.capability,
    step: input.step,
    transcript: input.transcript,
  });

  return {
    artifact: {
      id: `${input.capability.id}Bridge`,
      label: `${capabilityLabel} Output`,
      content: result.output,
      tone: result.success ? 'success' : 'warning',
    },
    progressSummary: result.success
      ? `已通过 ${capabilityLabel} 执行${input.capability.type === 'skill' ? '技能' : '外部能力'}。`
      : `${capabilityLabel} 已尝试执行，但返回了异常结果。`,
  };
}

async function runExternalCommand(input: {
  command: string;
  args: string[];
  projectRoot: string;
  inputPayload: string;
  textPayload: string;
  inputMode: NonNullable<CapabilityDefinition['inputMode']>;
  capability: CapabilityDefinition;
  step: AgentWorkspaceStep;
  transcript: string;
}): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const commandArgs = buildCommandArgs(input.args, input.inputMode, input.transcript);
    const child = spawn(input.command, commandArgs, {
      cwd: input.projectRoot,
      env: {
        ...process.env,
        CELCAT_AGENT_REQUEST: input.transcript,
        CELCAT_AGENT_STEP_ID: input.step.id,
        CELCAT_AGENT_STEP_TITLE: input.step.title,
        CELCAT_AGENT_STEP_SUMMARY: input.step.summary,
        CELCAT_AGENT_CAPABILITY_ID: input.capability.id,
        CELCAT_AGENT_CAPABILITY_LABEL: input.capability.label,
        CELCAT_AGENT_CAPABILITY_TYPE: input.capability.type,
        CELCAT_AGENT_CAPABILITY_SOURCE: input.capability.source,
        CELCAT_AGENT_INPUT_MODE: input.inputMode,
      },
      stdio: 'pipe',
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      resolve({
        success: false,
        output: '外部能力执行超时，已终止进程。',
      });
    }, 45000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        success: false,
        output: `外部能力启动失败：${error.message}`,
      });
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const normalizedStdout = compactText(stdout.trim(), 1800);
      const normalizedStderr = compactText(stderr.trim(), 1200);
      const lines = [
        `命令：${input.command}${commandArgs.length ? ` ${commandArgs.join(' ')}` : ''}`,
        code === 0 ? '状态：执行成功' : `状态：退出码 ${code ?? 'unknown'}`,
        normalizedStdout ? `stdout:\n${normalizedStdout}` : '',
        normalizedStderr ? `stderr:\n${normalizedStderr}` : '',
      ].filter(Boolean);

      resolve({
        success: code === 0,
        output: lines.join('\n\n'),
      });
    });

    if (input.inputMode === 'json-stdin' || input.inputMode === 'text-stdin') {
      child.stdin.write(input.inputMode === 'json-stdin' ? input.inputPayload : input.textPayload);
    }
    child.stdin.end();
  });
}

function buildCommandArgs(
  args: string[],
  inputMode: NonNullable<CapabilityDefinition['inputMode']>,
  transcript: string,
): string[] {
  if (inputMode === 'transcript-arg') {
    return [...args, transcript];
  }
  return args;
}

function compactText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}
