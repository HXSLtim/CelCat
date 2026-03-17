export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskKind = 'claude' | 'codex' | 'tool' | 'mcp';
export type TaskRiskLevel = 'low' | 'medium' | 'high';

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
};

export type CreateTaskInput = {
  kind: TaskKind;
  title: string;
  progressSummary: string;
  internalDetail: string;
  autoExecute: boolean;
  riskLevel: TaskRiskLevel;
  sourceTranscript: string;
};
