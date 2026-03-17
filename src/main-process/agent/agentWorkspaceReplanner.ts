import type {
  AgentWorkspace,
  AgentWorkspaceCapability,
  AgentWorkspaceStep,
} from '../../types/tasks';
import type { ExecuteStepResult } from './agentCapabilityExecutor';

type ReplanWorkspaceInput = {
  workspace: AgentWorkspace;
  stepIndex: number;
  executionResult: Pick<ExecuteStepResult, 'observation' | 'artifactTone' | 'progressSummary'>;
};

export function replanWorkspaceAfterStep(
  input: ReplanWorkspaceInput,
): AgentWorkspace {
  const step = input.workspace.steps[input.stepIndex];
  if (!step || !input.executionResult.observation) {
    return input.workspace;
  }

  let workspace = appendWorkspaceNote(
    input.workspace,
    `步骤观察（${step.title}）：${input.executionResult.observation}`,
  );

  workspace = annotateNextStepWithObservation(
    workspace,
    input.stepIndex,
    input.executionResult.observation,
    input.executionResult.artifactTone,
  );

  if (input.executionResult.artifactTone === 'warning') {
    workspace = applyWarningReplan(workspace, input.stepIndex, step, input.executionResult.observation);
  } else {
    workspace = assignCapabilityToUpcomingStep(workspace, input.stepIndex, step);
  }

  return workspace;
}

function annotateNextStepWithObservation(
  workspace: AgentWorkspace,
  stepIndex: number,
  observation: string,
  tone?: ExecuteStepResult['artifactTone'],
): AgentWorkspace {
  const nextStep = workspace.steps[stepIndex + 1];
  if (!nextStep || nextStep.summary.includes('上一步')) {
    return workspace;
  }

  const prefix = tone === 'warning'
    ? `上一步出现告警：${observation}。`
    : `上一步结果：${observation}。`;

  return {
    ...workspace,
    steps: workspace.steps.map((candidateStep, candidateIndex) =>
      candidateIndex === stepIndex + 1
        ? {
          ...candidateStep,
          summary: compactText(`${prefix}${candidateStep.summary}`, 160),
        }
        : candidateStep,
    ),
  };
}

function applyWarningReplan(
  workspace: AgentWorkspace,
  stepIndex: number,
  step: AgentWorkspaceStep,
  observation: string,
): AgentWorkspace {
  if (isGeneratedAdjustmentStep(step)) {
    return workspace;
  }

  const nextStep = workspace.steps[stepIndex + 1];
  const replanCapability = selectReplanCapability(workspace, step);

  if (nextStep && !isGeneratedAdjustmentStep(nextStep)) {
    const replanStepId = `stepReplan${stepIndex + 1}`;
    if (!workspace.steps.some((candidateStep) => candidateStep.id === replanStepId)) {
      workspace = {
        ...workspace,
        notes: appendNoteValue(
          workspace.notes,
          `计划调整（${step.title}）：已插入纠偏步骤，先复核输入与执行路径，再继续原计划。`,
        ),
        steps: [
          ...workspace.steps.slice(0, stepIndex + 1),
          {
            id: replanStepId,
            title: `复核并调整「${step.title}」`,
            summary: compactText(
              `上一步出现告警：${observation}。先复核输入、环境与执行路径，再继续后续步骤。`,
              160,
            ),
            status: 'pending',
            capabilityType: replanCapability?.type,
            capabilityId: replanCapability?.id,
          },
          ...workspace.steps.slice(stepIndex + 1),
        ],
      };
    }

    return reannotateDeferredSteps(workspace, stepIndex + 2, observation);
  }

  const recoveryStepId = `stepRecovery${stepIndex + 1}`;
  if (workspace.steps.some((candidateStep) => candidateStep.id === recoveryStepId)) {
    return workspace;
  }

  return {
    ...workspace,
    notes: appendNoteValue(
      workspace.notes,
      `计划调整（${step.title}）：末尾出现告警，已补充恢复步骤。`,
    ),
    steps: [
      ...workspace.steps,
      {
        id: recoveryStepId,
        title: `处理「${step.title}」中的告警`,
        summary: compactText(
          `补齐缺失输入或调整执行方案。当前观察：${observation}`,
          160,
        ),
        status: 'pending',
        capabilityType: replanCapability?.type,
        capabilityId: replanCapability?.id,
      },
    ],
  };
}

function reannotateDeferredSteps(
  workspace: AgentWorkspace,
  fromIndex: number,
  observation: string,
): AgentWorkspace {
  if (fromIndex >= workspace.steps.length) {
    return workspace;
  }

  return {
    ...workspace,
    steps: workspace.steps.map((step, index) => {
      if (index < fromIndex || step.summary.includes('重规划提示')) {
        return step;
      }

      return {
        ...step,
        summary: compactText(`重规划提示：${observation}。${step.summary}`, 160),
      };
    }),
  };
}

function assignCapabilityToUpcomingStep(
  workspace: AgentWorkspace,
  stepIndex: number,
  currentStep: AgentWorkspaceStep,
): AgentWorkspace {
  const nextStep = workspace.steps[stepIndex + 1];
  if (!nextStep || nextStep.capabilityId || isGeneratedAdjustmentStep(nextStep)) {
    return workspace;
  }

  const candidateCapability = inferCapabilityForStep(workspace, nextStep, currentStep);
  if (!candidateCapability) {
    return workspace;
  }

  return {
    ...workspace,
    notes: appendNoteValue(
      workspace.notes,
      `计划调整（${nextStep.title}）：已补充 ${candidateCapability.label} 来承接后续步骤。`,
    ),
    steps: workspace.steps.map((step, index) =>
      index === stepIndex + 1
        ? {
          ...step,
          capabilityType: candidateCapability.type,
          capabilityId: candidateCapability.id,
        }
        : step,
    ),
  };
}

function inferCapabilityForStep(
  workspace: AgentWorkspace,
  nextStep: AgentWorkspaceStep,
  currentStep: AgentWorkspaceStep,
): AgentWorkspaceCapability | null {
  const content = `${nextStep.title} ${nextStep.summary}`.toLowerCase();

  if (/构建|测试|验证|检查|回归|运行/.test(content)) {
    return findCapability(workspace, 'mcp', ['terminal', 'browser']) || null;
  }

  if (/文件|目录|工作区|仓库|配置|读取|写入/.test(content)) {
    return findCapability(workspace, 'mcp', ['filesystem']) || null;
  }

  if (/页面|浏览器|截图|ui|layout|fullscreen|全屏/.test(content)) {
    return findCapability(workspace, 'skill', ['playwrightSkill', 'frontendDesign'])
      || findCapability(workspace, 'mcp', ['browser'])
      || null;
  }

  if (/规划|设计|总结|方案|agentic|workflow|skill|mcp/.test(content)) {
    return findCapability(workspace, 'skill', ['architectureDesigner', 'codingWorkflow', 'frontendDesign']) || null;
  }

  if (/实现|编码|修复|重构|脚本/.test(content)) {
    return findCapability(workspace, 'skill', ['codingWorkflow']) || null;
  }

  if (currentStep.capabilityId) {
    const inheritedCapability = findCapabilityById(workspace, currentStep.capabilityId);
    if (inheritedCapability) {
      return inheritedCapability;
    }
  }

  return workspace.skills[0] || workspace.mcps[0] || null;
}

function selectReplanCapability(
  workspace: AgentWorkspace,
  currentStep: AgentWorkspaceStep,
): AgentWorkspaceCapability | null {
  if (currentStep.capabilityType === 'skill') {
    return findCapability(workspace, 'mcp', ['terminal', 'filesystem', 'browser'])
      || workspace.mcps[0]
      || null;
  }

  if (currentStep.capabilityType === 'mcp') {
    return findCapability(workspace, 'skill', ['codingWorkflow', 'architectureDesigner', 'frontendDesign'])
      || workspace.skills[0]
      || null;
  }

  return workspace.skills[0] || workspace.mcps[0] || null;
}

function findCapability(
  workspace: AgentWorkspace,
  type: AgentWorkspaceCapability['type'],
  ids: string[],
): AgentWorkspaceCapability | undefined {
  const pool = type === 'skill' ? workspace.skills : workspace.mcps;
  for (const id of ids) {
    const match = pool.find((capability) => capability.id === id);
    if (match) {
      return match;
    }
  }
  return pool[0];
}

function findCapabilityById(
  workspace: AgentWorkspace,
  id: string,
): AgentWorkspaceCapability | null {
  return [...workspace.skills, ...workspace.mcps].find((capability) => capability.id === id) || null;
}

function appendWorkspaceNote(workspace: AgentWorkspace, note: string): AgentWorkspace {
  if (workspace.notes.includes(note)) {
    return workspace;
  }

  return {
    ...workspace,
    notes: [...workspace.notes, note],
  };
}

function appendNoteValue(notes: string[], note: string): string[] {
  return notes.includes(note) ? notes : [...notes, note];
}

function isGeneratedAdjustmentStep(step: AgentWorkspaceStep): boolean {
  return /^step(?:Replan|Recovery)/.test(step.id);
}

function compactText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}
