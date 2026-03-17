import type {
  AgentWorkspace,
  AgentWorkspaceArtifact,
  AgentWorkspaceOutcome,
  AgentWorkspaceOutcomeStatus,
} from '../../types/tasks';

export function synthesizeWorkspaceOutcome(
  workspace: AgentWorkspace,
): AgentWorkspaceOutcome {
  const completedSteps = workspace.steps.filter((step) => step.status === 'completed');
  const pendingSteps = workspace.steps.filter((step) => step.status === 'pending' || step.status === 'in_progress');
  const warningArtifacts = workspace.artifacts.filter((artifact) => artifact.tone === 'warning');
  const successArtifacts = workspace.artifacts.filter((artifact) => artifact.tone === 'success');

  const blockers = dedupeStrings([
    ...warningArtifacts.map((artifact) => extractArtifactSignal(artifact)),
    ...workspace.steps
      .filter((step) => step.status === 'blocked')
      .map((step) => `${step.title} 仍处于阻塞状态。`),
  ]).slice(0, 4);

  const highlights = dedupeStrings([
    ...completedSteps.slice(-3).map((step) => `${step.title} 已完成。`),
    ...successArtifacts.slice(0, 2).map((artifact) => extractArtifactSignal(artifact)),
  ]).slice(0, 4);

  const nextActions = blockers.length
    ? [
        ...blockers.map((blocker) => `处理阻塞项：${blocker}`),
        ...pendingSteps.slice(0, 2).map((step) => `继续推进：${step.title}`),
      ]
    : pendingSteps.length
      ? pendingSteps.slice(0, 3).map((step) => `继续推进：${step.title}`)
      : ['向用户同步结果，并决定是否进入下一轮任务。'];

  const confidence = calculateConfidence({
    totalSteps: workspace.steps.length,
    completedSteps: completedSteps.length,
    warningCount: warningArtifacts.length,
    successCount: successArtifacts.length,
    blockerCount: blockers.length,
  });

  const status = inferOutcomeStatus({
    pendingCount: pendingSteps.length,
    blockerCount: blockers.length,
  });

  return {
    status,
    summary: buildOutcomeSummary(workspace, status, confidence, completedSteps.length, blockers.length, pendingSteps.length),
    confidence,
    highlights,
    blockers,
    nextActions: dedupeStrings(nextActions).slice(0, 4),
  };
}

function calculateConfidence(input: {
  totalSteps: number;
  completedSteps: number;
  warningCount: number;
  successCount: number;
  blockerCount: number;
}): number {
  const completionRatio = input.totalSteps > 0 ? input.completedSteps / input.totalSteps : 0;
  const rawScore = 0.2
    + completionRatio * 0.45
    + Math.min(input.successCount, 3) * 0.1
    - Math.min(input.warningCount, 3) * 0.12
    - Math.min(input.blockerCount, 3) * 0.1;

  return clampNumber(rawScore, 0.05, 0.98);
}

function inferOutcomeStatus(input: {
  pendingCount: number;
  blockerCount: number;
}): AgentWorkspaceOutcomeStatus {
  if (input.blockerCount > 0) {
    return 'needs_attention';
  }

  if (input.pendingCount > 0) {
    return 'in_progress';
  }

  return 'ready';
}

function buildOutcomeSummary(
  workspace: AgentWorkspace,
  status: AgentWorkspaceOutcomeStatus,
  confidence: number,
  completedCount: number,
  blockerCount: number,
  pendingCount: number,
): string {
  const confidenceLabel = `${Math.round(confidence * 100)}%`;

  if (status === 'needs_attention') {
    return `当前工作区已完成 ${completedCount}/${workspace.steps.length} 个步骤，但仍有 ${blockerCount} 个阻塞项，建议先处理告警后再继续。当前把握度 ${confidenceLabel}。`;
  }

  if (status === 'in_progress') {
    return `当前工作区已完成 ${completedCount}/${workspace.steps.length} 个步骤，还剩 ${pendingCount} 个待推进项，整体方向稳定。当前把握度 ${confidenceLabel}。`;
  }

  return `当前工作区步骤已收敛完成，未检测到新的阻塞项，可以整理结果并决定是否继续扩展。当前把握度 ${confidenceLabel}。`;
}

function extractArtifactSignal(artifact: AgentWorkspaceArtifact): string {
  const normalized = artifact.content
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => Boolean(line) && !/^命令[:：]|^状态[:：]/.test(line));

  const signal = normalized || artifact.label;
  return signal.length > 120 ? `${signal.slice(0, 117)}...` : signal;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
