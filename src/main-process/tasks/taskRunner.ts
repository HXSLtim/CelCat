import type { TaskKind, TaskRecord, TaskStatus } from '../../types/tasks';
import { InMemoryTaskStore } from './taskStore';
import { AgentPlanner } from '../agent/agentPlanner';
import type { AgentWorkspace, AgentWorkspaceStep } from '../../types/tasks';
import { executeWorkspaceStep } from '../agent/agentCapabilityExecutor';
import { compressWorkspaceContext } from '../agent/contextCompressor';
import { AgentMemoryStore } from '../agent/agentMemoryStore';

type RunTaskInput = {
  kind: TaskKind;
  transcript: string;
  title: string;
  autoExecute: boolean;
};

export class TaskRunner {
  private readonly timers = new Map<string, NodeJS.Timeout[]>();
  private readonly cancelledTasks = new Set<string>();
  private readonly pendingExecutions = new Map<string, { input: RunTaskInput; workspace: AgentWorkspace }>();
  private readonly agentPlanner: AgentPlanner;

  constructor(
    private readonly taskStore: InMemoryTaskStore,
    agentPlanner: AgentPlanner | undefined = undefined,
    private readonly agentMemoryStore?: AgentMemoryStore,
  ) {
    this.agentPlanner = agentPlanner ?? new AgentPlanner(undefined, agentMemoryStore);
  }

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

    void this.runTaskLifecycle(task.id, input);
    return queued;
  }

  cancelTask(taskId: string): TaskRecord | null {
    this.cancelledTasks.add(taskId);
    this.pendingExecutions.delete(taskId);
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

  approveTask(taskId: string): TaskRecord | null {
    const pendingExecution = this.pendingExecutions.get(taskId);
    const task = this.taskStore.get(taskId);
    if (!pendingExecution || !task) {
      return task;
    }

    this.pendingExecutions.delete(taskId);
    const executingWorkspace = {
      ...pendingExecution.workspace,
      mode: 'executing',
      compressedContext: this.compressWorkspace(taskId, pendingExecution.workspace, {
        status: 'running',
        progressSummary: '已收到确认，agent 开始执行工作区步骤。',
      }),
    } satisfies AgentWorkspace;

    const updatedTask = this.taskStore.setStatus(taskId, 'running', {
      progressSummary: '已收到确认，agent 开始执行工作区步骤。',
      internalDetail: 'User approved workspace execution',
      workspace: executingWorkspace,
    }) ?? task;

    void this.executeWorkspace(taskId, executingWorkspace, pendingExecution.input)
      .finally(() => {
        this.timers.delete(taskId);
        this.cancelledTasks.delete(taskId);
      });

    return updatedTask;
  }

  private getRiskLevel(kind: TaskKind): 'low' | 'medium' | 'high' {
    if (kind === 'tool' || kind === 'mcp') {
      return 'medium';
    }

    return 'low';
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

  private async runTaskLifecycle(taskId: string, input: RunTaskInput): Promise<void> {
    try {
      const riskLevel = this.getRiskLevel(input.kind);
      const workspace = await this.agentPlanner.planTask({
        transcript: input.transcript,
        kind: input.kind,
        riskLevel,
        autoExecute: input.autoExecute,
      });

      if (this.cancelledTasks.has(taskId)) {
        return;
      }

      const shouldWaitForUser = workspace.requiresConfirmation && !input.autoExecute;
      const plannedWorkspace = {
        ...workspace,
        mode: shouldWaitForUser ? 'blocked' : 'executing',
        compressedContext: this.compressWorkspace(taskId, workspace, {
          status: shouldWaitForUser ? 'waiting_user' : 'running',
          progressSummary: shouldWaitForUser
            ? '工作区计划已生成，等待你确认后再继续执行。'
            : '工作区已建立，agent 正在执行步骤。',
        }),
      } satisfies AgentWorkspace;

      this.taskStore.setStatus(taskId, shouldWaitForUser ? 'waiting_user' : 'running', {
        progressSummary: shouldWaitForUser
          ? '工作区计划已生成，等待你确认后再继续执行。'
          : '工作区已建立，agent 正在执行步骤。',
        internalDetail: shouldWaitForUser
          ? 'Execution paused for user confirmation'
          : 'Execution started with planned workspace',
        workspace: plannedWorkspace,
      });

      if (shouldWaitForUser) {
        this.pendingExecutions.set(taskId, {
          input,
          workspace: plannedWorkspace,
        });
        return;
      }

      await this.executeWorkspace(taskId, plannedWorkspace, input);
    } catch (error: any) {
      if (this.cancelledTasks.has(taskId)) {
        return;
      }

      this.taskStore.setStatus(taskId, 'failed', {
        progressSummary: '任务执行失败。',
        internalDetail: error?.message || 'Agent task failed',
        errorMessage: error?.message || 'Agent task failed',
      });
    } finally {
      this.timers.delete(taskId);
      this.cancelledTasks.delete(taskId);
    }
  }

  private async executeWorkspace(
    taskId: string,
    workspace: AgentWorkspace,
    input: RunTaskInput,
  ): Promise<void> {
    const timers: NodeJS.Timeout[] = [];
    this.timers.set(taskId, timers);

    for (let index = 0; index < workspace.steps.length; index += 1) {
      if (this.cancelledTasks.has(taskId)) {
        return;
      }

      const updatedWorkspace = {
        ...workspace,
        mode: 'executing',
        steps: workspace.steps.map((step, stepIndex) =>
          this.getNextStepState(step, stepIndex, index),
        ),
      } satisfies AgentWorkspace;
      workspace = updatedWorkspace;

      const executionResult = await executeWorkspaceStep({
        transcript: input.transcript,
        kind: input.kind,
        autoExecute: input.autoExecute,
        workspace,
        step: workspace.steps[index],
      });
      workspace = {
        ...executionResult.workspace,
        compressedContext: this.compressWorkspace(taskId, executionResult.workspace, {
          status: 'running',
          progressSummary: executionResult.progressSummary || executionResult.workspace.steps[index]?.summary || 'Agent 正在推进任务。',
        }),
      };

      this.taskStore.update(taskId, {
        progressSummary: executionResult.progressSummary || workspace.steps[index]?.summary || 'Agent 正在推进任务。',
        internalDetail: `Running workspace step ${index + 1}/${workspace.steps.length}`,
        workspace,
      });

      await this.wait(taskId, this.getStepDelay(workspace.steps[index]), timers);
    }

    const completedWorkspace = {
      ...workspace,
      mode: 'completed',
      steps: workspace.steps.map((step) => ({
        ...step,
        status: step.status === 'blocked' ? 'blocked' : 'completed',
      })),
    } satisfies AgentWorkspace;

    const resultSummary = this.getResultSummary(input.kind, input.transcript);
    const existingTask = this.taskStore.get(taskId);
    const completedTaskPreview: TaskRecord = {
      ...(existingTask ?? {
        id: taskId,
        kind: input.kind,
        title: input.title,
        status: 'completed' as TaskStatus,
        progressSummary: '任务已完成',
        internalDetail: 'Task completed with structured workspace',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        autoExecute: input.autoExecute,
        riskLevel: this.getRiskLevel(input.kind),
        sourceTranscript: input.transcript,
      }),
      status: 'completed',
      resultSummary,
      workspace: completedWorkspace,
    };
    const compressedContext = compressWorkspaceContext(completedTaskPreview);
    const memoryRefs = this.agentMemoryStore?.recordTaskMemory({
      ...completedTaskPreview,
      workspace: {
        ...completedWorkspace,
        compressedContext,
        memoryRefs: [],
      },
    }) ?? [];

    this.taskStore.setStatus(taskId, 'completed', {
      progressSummary: '任务已完成，工作区结果已经整理好了。',
      internalDetail: 'Task completed with structured workspace',
      resultSummary,
      resultPayload: {
        completedSteps: completedWorkspace.steps.length,
        skills: completedWorkspace.skills.map((skill) => skill.label),
        mcps: completedWorkspace.mcps.map((mcp) => mcp.label),
      },
      workspace: {
        ...completedWorkspace,
        compressedContext,
        memoryRefs,
      },
    });
  }

  private getNextStepState(
    step: AgentWorkspaceStep,
    stepIndex: number,
    activeStepIndex: number,
  ): AgentWorkspaceStep {
    if (stepIndex < activeStepIndex) {
      return {
        ...step,
        status: 'completed',
      };
    }

    if (stepIndex === activeStepIndex) {
      return {
        ...step,
        status: 'in_progress',
      };
    }

    return {
      ...step,
      status: 'pending',
    };
  }

  private getStepDelay(step?: AgentWorkspaceStep): number {
    if (!step) {
      return 400;
    }

    if (step.capabilityType === 'mcp') {
      return 900;
    }

    if (step.capabilityType === 'skill') {
      return 720;
    }

    return 560;
  }

  private wait(taskId: string, delayMs: number, timers: NodeJS.Timeout[]): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, delayMs);
      timers.push(timer);
    });
  }

  private compressWorkspace(
    taskId: string,
    workspace: AgentWorkspace,
    snapshot: {
      status: TaskStatus;
      progressSummary: string;
      resultSummary?: string;
    },
  ): string {
    const existingTask = this.taskStore.get(taskId);
    const taskPreview: TaskRecord = {
      ...(existingTask ?? {
        id: taskId,
        kind: 'claude',
        title: 'Agent Task',
        status: snapshot.status,
        progressSummary: snapshot.progressSummary,
        internalDetail: 'Workspace compression preview',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        autoExecute: false,
        riskLevel: 'low',
        sourceTranscript: workspace.mission,
      }),
      status: snapshot.status,
      progressSummary: snapshot.progressSummary,
      resultSummary: snapshot.resultSummary ?? existingTask?.resultSummary,
      workspace,
    };

    return compressWorkspaceContext(taskPreview);
  }
}
