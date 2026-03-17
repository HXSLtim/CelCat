export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskKind = 'claude' | 'codex' | 'tool' | 'mcp';
export type TaskRiskLevel = 'low' | 'medium' | 'high';
export type AgentWorkspaceMode = 'planning' | 'executing' | 'completed' | 'blocked';
export type AgentWorkspaceCapabilityType = 'skill' | 'mcp';
export type AgentWorkspaceStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';
export type AgentWorkspaceArtifactTone = 'info' | 'success' | 'warning';

export type AgentWorkspaceCapability = {
  id: string;
  label: string;
  type: AgentWorkspaceCapabilityType;
  reason: string;
};

export type AgentWorkspaceStep = {
  id: string;
  title: string;
  summary: string;
  status: AgentWorkspaceStepStatus;
  capabilityType?: AgentWorkspaceCapabilityType;
  capabilityId?: string;
};

export type AgentWorkspaceArtifact = {
  id: string;
  label: string;
  content: string;
  tone: AgentWorkspaceArtifactTone;
};

export type AgentWorkspaceMemoryRef = {
  id: string;
  label: string;
  path: string;
  summary: string;
};

export type AgentWorkspace = {
  mission: string;
  summary: string;
  model: string;
  mode: AgentWorkspaceMode;
  requiresConfirmation: boolean;
  notes: string[];
  skills: AgentWorkspaceCapability[];
  mcps: AgentWorkspaceCapability[];
  steps: AgentWorkspaceStep[];
  artifacts: AgentWorkspaceArtifact[];
  compressedContext: string;
  memoryRefs: AgentWorkspaceMemoryRef[];
};

export type TaskRecord = {
  id: string;
  kind: TaskKind;
  title: string;
  status: TaskStatus;
  progressSummary: string;
  internalDetail: string;
  createdAt: string;
  updatedAt: string;
  autoExecute: boolean;
  riskLevel: TaskRiskLevel;
  sourceTranscript: string;
  resultSummary?: string;
  resultPayload?: unknown;
  errorMessage?: string;
  workspace?: AgentWorkspace;
};

export type CreateTaskInput = {
  kind: TaskKind;
  title: string;
  progressSummary: string;
  internalDetail: string;
  autoExecute: boolean;
  riskLevel: TaskRiskLevel;
  sourceTranscript: string;
  workspace?: AgentWorkspace;
};
