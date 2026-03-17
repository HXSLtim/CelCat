import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { CreateTaskInput, TaskRecord, TaskStatus } from '../../types/tasks';

type TaskStoreEvents = {
  updated: (task: TaskRecord) => void;
};

export class InMemoryTaskStore {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly emitter = new EventEmitter();

  create(input: CreateTaskInput): TaskRecord {
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      ...input,
    };

    this.tasks.set(task.id, task);
    this.emitter.emit('updated', task);
    return task;
  }

  get(taskId: string): TaskRecord | null {
    return this.tasks.get(taskId) ?? null;
  }

  list(): TaskRecord[] {
    return Array.from(this.tasks.values()).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  getLatestActive(): TaskRecord | null {
    return this.list().find((task) => task.status === 'queued' || task.status === 'running' || task.status === 'waiting_user') ?? null;
  }

  update(taskId: string, patch: Partial<Omit<TaskRecord, 'id' | 'createdAt'>>): TaskRecord | null {
    const existing = this.tasks.get(taskId);
    if (!existing) {
      return null;
    }

    const nextTask: TaskRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    this.tasks.set(taskId, nextTask);
    this.emitter.emit('updated', nextTask);
    return nextTask;
  }

  setStatus(
    taskId: string,
    status: TaskStatus,
    patch: Partial<Omit<TaskRecord, 'id' | 'createdAt' | 'status'>> = {},
  ): TaskRecord | null {
    return this.update(taskId, {
      ...patch,
      status,
    });
  }

  onUpdated(listener: TaskStoreEvents['updated']): () => void {
    this.emitter.on('updated', listener);
    return () => {
      this.emitter.off('updated', listener);
    };
  }
}
