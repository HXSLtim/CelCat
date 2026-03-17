import type { AgentWorkspace, TaskRecord } from '../../types/tasks';

export function compressWorkspaceContext(task: TaskRecord): string {
  const workspace = task.workspace;
  if (!workspace) {
    return '';
  }

  const completedSteps = workspace.steps
    .filter((step) => step.status === 'completed')
    .map((step) => step.title)
    .slice(0, 4);
  const activeStep = workspace.steps.find((step) => step.status === 'in_progress');
  const artifactSummary = workspace.artifacts
    .slice(0, 2)
    .map((artifact) => `${artifact.label}: ${compactText(artifact.content, 110)}`);
  const capabilities = [
    ...workspace.skills.map((skill) => `skill:${skill.label}`),
    ...workspace.mcps.map((mcp) => `mcp:${mcp.label}`),
  ].slice(0, 6);
  const outcome = workspace.outcome;

  return [
    `Mission: ${workspace.mission}`,
    `Mode: ${workspace.mode}`,
    capabilities.length ? `Capabilities: ${capabilities.join(', ')}` : '',
    completedSteps.length ? `Completed: ${completedSteps.join(' -> ')}` : '',
    activeStep ? `Current: ${activeStep.title} - ${activeStep.summary}` : '',
    artifactSummary.length ? `Artifacts: ${artifactSummary.join(' | ')}` : '',
    outcome ? `Outcome: ${outcome.status} @ ${Math.round(outcome.confidence * 100)}%` : '',
    outcome?.blockers.length ? `Blockers: ${outcome.blockers.join(' | ')}` : '',
    task.resultSummary ? `Result: ${compactText(task.resultSummary, 140)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function compactText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}
