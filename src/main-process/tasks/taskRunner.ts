import type { TaskKind, TaskRecord } from '../../types/tasks';
import { InMemoryTaskStore } from './taskStore';

type RunTaskInput = {
  kind: TaskKind;
  transcript: string;
  title: string;
  autoExecute: boolean;
};

export class TaskRunner {
  private readonly timers = new Map<string, NodeJS.Timeout[]>();

  constructor(private readonly taskStore: InMemoryTaskStore) {}

  startTask(input: RunTaskInput): TaskRecord {
    const task = this.taskStore.create({
      kind: input.kind,
      title: input.title,
      progressSummary: '任务已创建，正在整理上下文。',
      internalDetail: `Queued from transcript: ${input.transcript}`,
      autoExecute: input.autoExecute,
      riskLevel: this.getRiskLevel(input.kind),
      sourceTranscript: input.transcript,
    });

    const queued = this.taskStore.setStatus(task.id, 'running', {
      progressSummary: '正在理解你的请求，并拆分成可执行步骤。',
      internalDetail: `Task runner started for ${input.kind}`,
    }) ?? task;

    const timeline = [
      {
        delayMs: 900,
        progressSummary: this.getProgressSummary(input.kind, 1),
        internalDetail: 'Phase 1 complete',
      },
      {
        delayMs: 2200,
        progressSummary: this.getProgressSummary(input.kind, 2),
        internalDetail: 'Phase 2 complete',
      },
      {
        delayMs: 3600,
        status: 'completed' as const,
        progressSummary: '任务已完成，随时可以让我为你复述结果。',
        internalDetail: 'Task completed',
        resultSummary: this.getResultSummary(input.kind, input.transcript),
      },
    ];

    const timers = timeline.map((step) =>
      setTimeout(() => {
        if (step.status === 'completed') {
          this.taskStore.setStatus(task.id, step.status, {
            progressSummary: step.progressSummary,
            internalDetail: step.internalDetail,
            resultSummary: step.resultSummary,
          });
          this.timers.delete(task.id);
          return;
        }

        this.taskStore.update(task.id, {
          progressSummary: step.progressSummary,
          internalDetail: step.internalDetail,
        });
      }, step.delayMs),
    );

    this.timers.set(task.id, timers);
    return queued;
  }

  cancelTask(taskId: string): TaskRecord | null {
    const timers = this.timers.get(taskId) ?? [];
    for (const timer of timers) {
      clearTimeout(timer);
    }
    this.timers.delete(taskId);

    return this.taskStore.setStatus(taskId, 'cancelled', {
      progressSummary: '任务已取消。',
      internalDetail: 'Task cancelled by user',
    });
  }

  private getRiskLevel(kind: TaskKind): 'low' | 'medium' | 'high' {
    if (kind === 'tool' || kind === 'mcp') {
      return 'medium';
    }

    return 'low';
  }

  private getProgressSummary(kind: TaskKind, phase: number): string {
    if (kind === 'codex') {
      return phase === 1
        ? '正在梳理项目上下文，准备编码方案。'
        : '正在生成实现步骤和可执行建议。';
    }

    if (kind === 'tool' || kind === 'mcp') {
      return phase === 1
        ? '正在核对目标操作和执行权限。'
        : '正在排队执行工具请求，并整理结果。';
    }

    return phase === 1
      ? '正在整理上下文和关键问题。'
      : '正在归纳结果，准备对你复述。';
  }

  private getResultSummary(kind: TaskKind, transcript: string): string {
    if (kind === 'codex') {
      return `后台编码任务已整理完毕，下一步可以进入实现阶段。原始请求：${transcript}`;
    }

    if (kind === 'tool' || kind === 'mcp') {
      return `后台工具任务已经跑完，我可以继续向你说明结果或执行下一步。原始请求：${transcript}`;
    }

    return `后台分析任务已完成，我已经整理好了重点。原始请求：${transcript}`;
  }
}
