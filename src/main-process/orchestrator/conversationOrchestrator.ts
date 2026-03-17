import type { SessionEvent } from '../../types/session';
import type { TaskKind, TaskRecord } from '../../types/tasks';
import { UserSettingsStore } from '../config/userSettings';
import { TaskRunner } from '../tasks/taskRunner';
import { InMemoryTaskStore } from '../tasks/taskStore';

type ConversationResult = {
  events: SessionEvent[];
  relatedTask: TaskRecord | null;
  companionRequest: {
    prompt: string;
    fallbackText: string;
  } | null;
};

export class ConversationOrchestrator {
  constructor(
    private readonly taskStore: InMemoryTaskStore,
    private readonly taskRunner: TaskRunner,
    private readonly settingsStore: UserSettingsStore,
  ) {}

  async handleTranscript(transcript: string): Promise<ConversationResult> {
    const normalizedTranscript = transcript.trim();

    if (!normalizedTranscript) {
      return {
        relatedTask: null,
        companionRequest: null,
        events: [
          {
            type: 'assistant-message',
            text: '刚刚这句我没有听清，你可以再说一遍吗？',
          },
        ],
      };
    }

    const latestTask = this.taskStore.getLatestActive();

    if (this.isProgressQuery(normalizedTranscript)) {
      const message = latestTask
        ? `${latestTask.title} 目前的进度是：${latestTask.progressSummary}`
        : '现在还没有正在进行的后台任务，我可以继续陪你聊天或者接新任务。';

      return {
        relatedTask: latestTask,
        companionRequest: null,
        events: [
          {
            type: 'assistant-message',
            text: message,
            relatedTaskId: latestTask?.id ?? null,
          },
        ],
      };
    }

    if (this.isCancelQuery(normalizedTranscript)) {
      if (!latestTask) {
        return {
          relatedTask: null,
          companionRequest: null,
          events: [
            {
              type: 'assistant-message',
              text: '现在没有可以取消的后台任务。',
            },
          ],
        };
      }

      const cancelledTask = this.taskRunner.cancelTask(latestTask.id);
      return {
        relatedTask: cancelledTask,
        companionRequest: null,
        events: [
          {
            type: 'assistant-message',
            text: `${latestTask.title} 已经停下来了。如果你想，我们可以换个方式继续。`,
            relatedTaskId: latestTask.id,
          },
        ],
      };
    }

    if (this.shouldCreateBackgroundTask(normalizedTranscript)) {
      const kind = this.getTaskKind(normalizedTranscript);
      const task = this.taskRunner.startTask({
        kind,
        transcript: normalizedTranscript,
        title: this.getTaskTitle(kind),
        autoExecute: this.settingsStore.get().autoExecute,
      });

      return {
        relatedTask: task,
        companionRequest: null,
        events: [
          {
            type: 'assistant-message',
            text: `好的，我已经把这件事放到后台处理了。你可以继续和我聊天，也可以随时问我“现在进度怎么样”。`,
            relatedTaskId: task.id,
          },
        ],
      };
    }

    return {
      relatedTask: null,
      companionRequest: {
        prompt: normalizedTranscript,
        fallbackText: this.getCompanionReply(normalizedTranscript),
      },
      events: [],
    };
  }

  private isProgressQuery(transcript: string): boolean {
    return /进度|怎么样|到哪了|完成了吗|后台任务|任务列表/.test(transcript);
  }

  private isCancelQuery(transcript: string): boolean {
    return /取消任务|停下|先别做了|停止任务/.test(transcript);
  }

  private shouldCreateBackgroundTask(transcript: string): boolean {
    return /(帮我|请你|去|分析|总结|整理|生成|写|创建|检查|实现|修改|运行|启动|查一下|搜一下|处理)/.test(transcript);
  }

  private getTaskKind(transcript: string): TaskKind {
    if (/(代码|实现|修复|脚本|项目|仓库|测试|启动)/.test(transcript)) {
      return 'codex';
    }

    if (/(打开|搜索|查询|调用|执行|抓取|下载)/.test(transcript)) {
      return 'tool';
    }

    return 'claude';
  }

  private getTaskTitle(kind: TaskKind): string {
    if (kind === 'codex') {
      return '后台编码任务';
    }

    if (kind === 'tool' || kind === 'mcp') {
      return '后台工具任务';
    }

    return '后台分析任务';
  }

  private getCompanionReply(transcript: string): string {
    if (/累|烦|难受|压力|焦虑/.test(transcript)) {
      return '我在呢。你可以慢一点说，我们先把最让你难受的那一件事拎出来。';
    }

    if (/你好|在吗|陪我聊聊|陪我说说话/.test(transcript)) {
      return '我在，今天想聊点轻松的，还是想让我帮你一起理一理事情？';
    }

    if (/谢谢|多谢/.test(transcript)) {
      return '不用客气，我会一直在这边接着你。';
    }

    return `我听到了：“${transcript}”。如果你希望我认真处理它，可以直接说“帮我处理这件事”。`;
  }
}
