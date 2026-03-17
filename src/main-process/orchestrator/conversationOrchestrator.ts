import type { SessionEvent } from '../../types/session';
import type { TaskKind, TaskRecord } from '../../types/tasks';
import type { AgentPlanningMemoryContext, CompanionIdentityProfile } from '../agent/agentMemoryStore';
import { AgentIntentRouter } from '../agent/agentIntentRouter';
import { UserSettingsStore } from '../config/userSettings';
import { TaskRunner } from '../tasks/taskRunner';
import { InMemoryTaskStore } from '../tasks/taskStore';
import { logDebug, truncateDebugText } from '../../shared/debugLogger';

type ConversationResult = {
  events: SessionEvent[];
  relatedTask: TaskRecord | null;
  companionRequest: {
    prompt: string;
    fallbackText: string;
  } | null;
};

type CompanionMemoryStore = Pick<{
  getPlanningContext: (query?: string, kind?: TaskKind) => AgentPlanningMemoryContext;
  getCompanionIdentity: () => CompanionIdentityProfile;
  updateCompanionIdentity: (update: {
    displayName?: string;
    identityNotes?: string[];
  }) => CompanionIdentityProfile;
}, 'getPlanningContext' | 'getCompanionIdentity' | 'updateCompanionIdentity'>;

export class ConversationOrchestrator {
  constructor(
    private readonly taskStore: InMemoryTaskStore,
    private readonly taskRunner: TaskRunner,
    private readonly settingsStore: UserSettingsStore,
    private readonly memoryStore?: CompanionMemoryStore,
    private readonly intentRouter: AgentIntentRouter = new AgentIntentRouter(),
  ) {}

  async handleTranscript(transcript: string): Promise<ConversationResult> {
    const normalizedTranscript = transcript.trim();
    logDebug('orchestrator', 'Handling transcript', {
      transcript: truncateDebugText(normalizedTranscript, 200),
    });

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
      logDebug('orchestrator', 'Resolved transcript as progress query', {
        transcript: truncateDebugText(normalizedTranscript, 200),
        relatedTaskId: latestTask?.id ?? null,
      });
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
      logDebug('orchestrator', 'Resolved transcript as cancellation query', {
        transcript: truncateDebugText(normalizedTranscript, 200),
        relatedTaskId: latestTask?.id ?? null,
      });
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

    const routedIntent = await this.intentRouter.routeTranscript({
      transcript: normalizedTranscript,
      latestTaskTitle: latestTask?.title ?? null,
      companionIdentity: this.memoryStore?.getCompanionIdentity?.() ?? null,
      memoryContext: this.memoryStore?.getPlanningContext?.(normalizedTranscript, 'claude'),
    });
    if (routedIntent?.mode === 'identity' && routedIntent.action === 'renameCompanion' && routedIntent.displayName) {
      logDebug('orchestrator', 'AI router resolved transcript as companion identity update', {
        transcript: truncateDebugText(normalizedTranscript, 200),
        displayName: routedIntent.displayName,
        confidence: routedIntent.confidence,
        reason: routedIntent.reason,
      });
      const renameResult = this.renameCompanionFromSystem(routedIntent.displayName);
      if (renameResult) {
        return renameResult;
      }
    }

    if (routedIntent?.mode === 'agent') {
      logDebug('orchestrator', 'AI router routed transcript to background agent task', {
        transcript: truncateDebugText(normalizedTranscript, 200),
        kind: routedIntent.kind ?? 'claude',
        confidence: routedIntent.confidence,
        reason: routedIntent.reason,
      });
      return this.createBackgroundTaskResult(
        routedIntent.transcript || normalizedTranscript,
        routedIntent.kind ?? 'claude',
      );
    }

    const prompt = this.buildCompanionPrompt(normalizedTranscript, latestTask);
    logDebug('orchestrator', 'Built companion prompt with agent handoff injection', {
      transcript: truncateDebugText(normalizedTranscript, 200),
      promptLength: prompt.length,
      companionDisplayName: this.memoryStore?.getCompanionIdentity?.().displayName || 'CelCat',
      hasLatestTask: Boolean(latestTask),
      promptPreview: truncateDebugText(prompt, 220),
    });
    return {
      relatedTask: null,
      companionRequest: {
        prompt,
        fallbackText: this.getCompanionReply(normalizedTranscript),
      },
      events: [],
    };
  }

  async handleRealtimeProviderTranscript(transcript: string): Promise<ConversationResult | null> {
    const result = await this.handleTranscript(transcript);
    if (result.companionRequest) {
      return null;
    }

    return result;
  }

  startAgentTaskFromSystem(input: {
    transcript: string;
    kind?: TaskKind;
  }): ConversationResult {
    const normalizedTranscript = input.transcript.trim();
    const kind = input.kind ?? 'claude';
    logDebug('orchestrator', 'System requested background agent task', {
      transcript: truncateDebugText(normalizedTranscript, 200),
      kind,
    });
    return this.createBackgroundTaskResult(normalizedTranscript, kind);
  }

  renameCompanionFromSystem(displayName: string): ConversationResult | null {
    const normalizedName = displayName.trim();
    if (!normalizedName || !this.memoryStore?.updateCompanionIdentity) {
      return null;
    }

    logDebug('orchestrator', 'System requested companion rename', {
      displayName: normalizedName,
    });
    const profile = this.memoryStore.updateCompanionIdentity({
      displayName: normalizedName,
      identityNotes: [
        `系统将你的当前名字更新为${normalizedName}。`,
        `之后和用户聊天时，自然地以${normalizedName}的身份陪伴对方。`,
      ],
    });

    return {
      relatedTask: null,
      companionRequest: null,
      events: [
        {
          type: 'assistant-message',
          text: `记住啦，我以后就叫${profile.displayName}。`,
        },
      ],
    };
  }

  resolveCompanionReply(transcript: string, reply: string): ConversationResult | null {
    const handoff = this.extractAgentHandoff(reply);
    if (!handoff) {
      logDebug('orchestrator', 'Companion reply stayed in chat mode', {
        transcript: truncateDebugText(transcript, 200),
        reply: truncateDebugText(reply, 240),
      });
      return null;
    }

    logDebug('orchestrator', 'Companion reply requested background agent handoff', {
      transcript: truncateDebugText(transcript, 200),
      handoffKind: handoff.kind,
      handoffTranscript: truncateDebugText(handoff.transcript, 240),
    });
    const taskTranscript = handoff.transcript || transcript;
    return this.createBackgroundTaskResult(taskTranscript, handoff.kind);
  }

  getCompanionIdentity(): CompanionIdentityProfile | null {
    return this.memoryStore?.getCompanionIdentity?.() ?? null;
  }

  getVoiceChatSessionContext(): {
    companionIdentity: CompanionIdentityProfile | null;
    memoryContext: AgentPlanningMemoryContext | null;
    latestTask: Pick<TaskRecord, 'id' | 'title' | 'progressSummary'> | null;
  } {
    const latestTask = this.taskStore.getLatestActive();
    return {
      companionIdentity: this.memoryStore?.getCompanionIdentity?.() ?? null,
      memoryContext: this.memoryStore?.getPlanningContext?.('', 'claude') ?? null,
      latestTask: latestTask
        ? {
            id: latestTask.id,
            title: latestTask.title,
            progressSummary: latestTask.progressSummary,
          }
        : null,
    };
  }

  private isProgressQuery(transcript: string): boolean {
    return /进度|怎么样|到哪了|完成了吗|后台任务|任务列表/.test(transcript);
  }

  private isCancelQuery(transcript: string): boolean {
    return /取消任务|停下|先别做了|停止任务/.test(transcript);
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

  private buildCompanionPrompt(transcript: string, latestTask: TaskRecord | null): string {
    const memoryContext = this.memoryStore?.getPlanningContext(transcript, 'claude');
    const companionIdentity = this.memoryStore?.getCompanionIdentity();
    if (!memoryContext && !companionIdentity) {
      return transcript;
    }

    const displayName = companionIdentity?.displayName || 'CelCat';
    const identityNotes = companionIdentity?.identityNotes.slice(0, 3) || [];
    const preferences = [
      ...(memoryContext?.stablePreferences.slice(0, 3) || []),
      ...((memoryContext?.longTermMemories || [])
        .filter((memory) => memory.category === 'preferences')
        .slice(0, 2)
        .map((memory) => memory.summary)),
    ].map((item) => this.compactText(item, 60));

    const memoryHighlights = memoryContext?.relevantMemories.length
      ? memoryContext.relevantMemories.slice(0, 2).map((memory) => memory.summary)
      : (memoryContext?.recentMemories.slice(0, 1).map((memory) =>
        this.compactText(
          `${memory.sourceTranscript} | ${memory.compressedContext || memory.resultSummary}`,
          100,
        ),
      ) || []);

    const promptSections = [
      `你是 ${displayName}，一个有持续身份认知的中文桌宠 companion，正在和熟悉的用户进行实时语音聊天。`,
      `你现在对用户自称“${displayName}”。`,
      identityNotes.length ? `你的自我认知：${identityNotes.join('；')}` : '',
      '请保持自然、温柔、口语化、简洁，不要生硬复述设定，不要提到“根据记忆”或“系统提示”。',
      '如果用户是在交代需要实际执行、持续处理或多步骤完成的任务，而不是单纯闲聊，不要口头假装已经做完。',
      '对于代码修改、项目排查、运行命令、搜索资料、浏览网页、打开浏览器、访问网站、抓取内容、调用 skill 或 MCP、生成方案/文档等执行型任务，应交给系统提供的工具调用或后台执行能力。',
      '如果只是普通聊天，就自然接话，不要生硬提到系统、提示词、工具或后台。',
      preferences.length ? `用户长期偏好：${preferences.join('；')}` : '',
      memoryHighlights.length ? `最近相关上下文：${memoryHighlights.join('；')}` : '',
      latestTask ? `当前后台任务：${latestTask.title}，进度：${this.compactText(latestTask.progressSummary, 80)}` : '',
      `用户刚刚说：${transcript}`,
      '请直接像桌宠 companion 一样接话，可以自然带出熟悉感和身份认知。',
    ].filter(Boolean);

    return this.compactText(promptSections.join('\n'), 900);
  }

  private createBackgroundTaskResult(transcript: string, kind: TaskKind): ConversationResult {
    const task = this.taskRunner.startTask({
      kind,
      transcript,
      title: this.getTaskTitle(kind),
      autoExecute: this.settingsStore.get().autoExecute,
    });

    return {
      relatedTask: task,
      companionRequest: null,
      events: [
        {
          type: 'assistant-message',
          text: '好的，我已经把这件事放到后台处理中，交给后台 agent 处理了。你可以继续和我聊天，也可以随时问我“现在进度怎么样”。',
          relatedTaskId: task.id,
        },
      ],
    };
  }

  private extractAgentHandoff(reply: string): { kind: TaskKind; transcript: string } | null {
    const match = reply.trim().match(/^\[\[CELCAT_AGENT\s+kind=(codex|tool|claude|mcp)\]\]\s*(.+)$/is);
    if (!match) {
      return null;
    }

    const kind = match[1].toLowerCase() as TaskKind;
    const transcript = match[2].trim();
    if (!transcript) {
      return null;
    }

    return {
      kind,
      transcript,
    };
  }

  private getCompanionReply(transcript: string): string {
    const displayName = this.memoryStore?.getCompanionIdentity?.().displayName || 'CelCat';
    if (/累|烦|难受|压力|焦虑/.test(transcript)) {
      return '我在呢。你可以慢一点说，我们先把最让你难受的那一件事拎出来。';
    }

    if (/你好|在吗|陪我聊聊|陪我说说话/.test(transcript)) {
      return '我在，今天想聊点轻松的，还是想让我帮你一起理一理事情？';
    }

    if (/谢谢|多谢/.test(transcript)) {
      return '不用客气，我会一直在这边接着你。';
    }

    return `${displayName}听到了：“${transcript}”。如果你希望我认真处理它，可以直接说“帮我处理这件事”。`;
  }

  private compactText(text: string, maxLength: number): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
  }
}
