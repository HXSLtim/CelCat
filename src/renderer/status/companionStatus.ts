import type { SessionSnapshot } from '../../types/session';
import type { TaskRecord } from '../../types/tasks';
import type { VoiceUiState } from '../voice/voiceUi';

export type CompanionStatusTone = 'idle' | 'processing' | 'speaking' | 'result' | 'error';

export type CompanionStatus = {
  key:
    | 'error'
    | 'waiting_user'
    | 'delegated'
    | 'assistant_speaking'
    | 'assistant_thinking'
    | 'user_listening'
    | 'idle'
    | 'hidden';
  text: string;
  tone: CompanionStatusTone;
  visible: boolean;
};

export type CompanionStatusInput = {
  sessionSnapshot: SessionSnapshot | null;
  voiceUiState: VoiceUiState | null;
  task: TaskRecord | null;
  assistantSpeakingText: string;
};

const ACTIVE_TASK_STATUSES = new Set(['queued', 'running', 'waiting_user']);

export function selectRelevantTask(tasks: TaskRecord[], activeTaskId: string | null): TaskRecord | null {
  const activeTasks = tasks
    .filter((task) => ACTIVE_TASK_STATUSES.has(task.status))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  if (!activeTasks.length) {
    return null;
  }

  if (activeTaskId) {
    const matchingTask = activeTasks.find((task) => task.id === activeTaskId);
    if (matchingTask) {
      return matchingTask;
    }
  }

  const waitingUserTask = activeTasks.find((task) => task.status === 'waiting_user');
  if (waitingUserTask) {
    return waitingUserTask;
  }

  return activeTasks[0] || null;
}

export function selectCompanionStatus(input: CompanionStatusInput): CompanionStatus {
  const sessionError = input.sessionSnapshot?.status === 'error'
    ? input.sessionSnapshot.error || '会话出了点问题。'
    : '';
  const voiceError = input.voiceUiState?.statusTone === 'error'
    ? input.voiceUiState.statusText
    : '';
  const taskError = input.task?.status === 'failed'
    ? input.task.errorMessage || input.task.resultSummary || input.task.progressSummary || '后台任务执行失败了。'
    : '';

  if (sessionError || voiceError || taskError) {
    return {
      key: 'error',
      text: sessionError || voiceError || taskError,
      tone: 'error',
      visible: true,
    };
  }

  if (input.task?.status === 'waiting_user') {
    return {
      key: 'waiting_user',
      text: input.task.progressSummary || input.task.workspace?.summary || '我这边需要你确认下一步。',
      tone: 'result',
      visible: true,
    };
  }

  if (input.task && (input.task.status === 'queued' || input.task.status === 'running')) {
    return {
      key: 'delegated',
      text: input.task.progressSummary || '我已经把这件事交给后台处理中。',
      tone: 'processing',
      visible: true,
    };
  }

  if (input.assistantSpeakingText.trim()) {
    return {
      key: 'assistant_speaking',
      text: input.assistantSpeakingText.trim(),
      tone: 'speaking',
      visible: true,
    };
  }

  if (input.sessionSnapshot?.status === 'processing') {
    return {
      key: 'assistant_thinking',
      text: '我在整理你刚刚说的话。',
      tone: 'processing',
      visible: true,
    };
  }

  if (input.voiceUiState?.showStatus) {
    return {
      key: 'user_listening',
      text: input.voiceUiState.statusText,
      tone: input.voiceUiState.statusTone === 'listening'
        ? 'idle'
        : input.voiceUiState.statusTone,
      visible: true,
    };
  }

  if (input.sessionSnapshot?.status === 'listening' && !input.sessionSnapshot.error) {
    return {
      key: 'idle',
      text: '我在听，也可以直接交给我一个后台任务。',
      tone: 'idle',
      visible: true,
    };
  }

  return {
    key: 'hidden',
    text: '',
    tone: 'idle',
    visible: false,
  };
}
