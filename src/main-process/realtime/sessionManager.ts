import type { SessionEvent, SessionSnapshot, StreamingAudioFrame, UserAudioPayload } from '../../types/session';
import { logDebug, truncateDebugText } from '../../shared/debugLogger';
import { ConversationOrchestrator } from '../orchestrator/conversationOrchestrator';
import type { CompanionProvider, ProviderEvent } from './providerClient';

type SessionManagerDependencies = {
  transcribeAudio(input: UserAudioPayload): Promise<{ text: string }>;
  orchestrator: ConversationOrchestrator;
  companionProvider: CompanionProvider;
  emitEvent(event: SessionEvent): void;
  estimateSpeechDelayMs?(text: string): number;
  realtimeRoutingDecisionDeadlineMs?: number;
};

type BufferedProviderEvent =
  | {
      type: 'assistant-message';
      text: string;
      isFinal?: boolean;
    }
  | {
      type: 'assistant-audio';
      pcmBase64: string;
      sampleRate: number;
      channels: number;
      format: 'pcm_s16le';
    }
  | {
      type: 'tool-call';
      toolName: string;
      arguments: Record<string, unknown>;
      rawText?: string;
    }
  | {
      type: 'error';
      message: string;
    };

const DEFAULT_SNAPSHOT: SessionSnapshot = {
  status: 'idle',
  connected: false,
  lastTranscript: '',
  lastAssistantMessage: '',
  activeTaskId: null,
  error: '',
};

const DEFAULT_REALTIME_ROUTING_DECISION_DEADLINE_MS = 1600;
const REALTIME_ROUTING_BUFFER_MAX_MS = 4000;

export class SessionManager {
  private snapshot: SessionSnapshot = DEFAULT_SNAPSHOT;
  private totalForwardedAudioFrames = 0;
  private forwardedFramesSinceLastCommit = 0;
  private lastSyncedCompanionDisplayName: string | null = null;
  private pendingCompanionIdentitySync: {
    displayName: string;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private suppressedProviderReply: {
    transcript: string;
    startedAt: number;
    reason: string;
  } | null = null;
  private pendingProviderTurn: {
    id: number;
    transcript: string;
    startedAt: number;
    bufferedEvents: BufferedProviderEvent[];
    bufferLogEmitted: boolean;
    stats: {
      assistantMessageCount: number;
      assistantAudioCount: number;
      toolCallCount: number;
      errorCount: number;
      lastAssistantPreview: string | null;
    };
    deadlineTimer: ReturnType<typeof setTimeout>;
  } | null = null;
  private pendingProviderTurnId = 0;

  constructor(private readonly dependencies: SessionManagerDependencies) {
    logDebug('session', 'Registering realtime provider event sink');
    this.dependencies.companionProvider.setEventSink((event) => {
      this.handleProviderEvent(event);
    });
  }

  async startSession(): Promise<SessionSnapshot> {
    logDebug('session', 'Starting session');
    const providerEnabled = this.dependencies.companionProvider.isEnabled();
    logDebug('session', 'Realtime provider availability', {
      enabled: providerEnabled,
    });
    this.setSnapshot({
      status: 'connecting',
      connected: false,
      error: '',
    });

    if (!providerEnabled) {
      this.setSnapshot({
        status: 'listening',
        connected: false,
        error: '',
      });
      logDebug('session', 'Starting in browser-only mode because realtime provider is disabled');
      return this.getSnapshot();
    }

    await this.syncCompanionIdentityImmediately();
    await this.dependencies.companionProvider.connect();
    await this.dependencies.companionProvider.startSession();

    this.setSnapshot({
      status: 'listening',
      connected: true,
      error: '',
    });
    logDebug('session', 'Session started successfully');

    return this.getSnapshot();
  }

  async stopSession(): Promise<SessionSnapshot> {
    logDebug('session', 'Stopping session');
    this.clearPendingCompanionIdentitySync();
    await this.dependencies.companionProvider.disconnect();
    this.snapshot = {
      ...DEFAULT_SNAPSHOT,
    };
    this.emitState();
    return this.getSnapshot();
  }

  async submitUserAudio(payload: UserAudioPayload): Promise<void> {
    logDebug('session', 'Submitting user audio blob', {
      mimeType: payload.mimeType,
      byteLength: payload.audioBuffer.byteLength,
    });
    this.setSnapshot({
      status: 'processing',
      connected: true,
      error: '',
    });

    try {
      const result = await this.dependencies.transcribeAudio(payload);
      await this.handleTranscript(result.text.trim());
    } catch (error: any) {
      const message = error?.message || '语音处理失败';
      this.setSnapshot({
        status: 'error',
        error: message,
      });
      this.dependencies.emitEvent({
        type: 'error',
        message,
      });
      logDebug('session', 'Audio submission failed', {
        message,
      });
    }
  }

  async submitUserTranscript(transcript: string): Promise<void> {
    logDebug('session', 'Submitting user transcript', {
      transcript: truncateDebugText(transcript),
    });
    this.setSnapshot({
      status: 'processing',
      connected: true,
      error: '',
    });

    await this.handleTranscript(transcript.trim());
  }

  async appendInputAudioFrame(frame: StreamingAudioFrame): Promise<void> {
    if (!this.dependencies.companionProvider.isEnabled()) {
      return;
    }

    this.totalForwardedAudioFrames += 1;
    this.forwardedFramesSinceLastCommit += 1;
    await this.dependencies.companionProvider.appendInputAudioFrame(frame);
  }

  async commitInputAudio(): Promise<void> {
    if (!this.dependencies.companionProvider.isEnabled()) {
      return;
    }

    this.forwardedFramesSinceLastCommit = 0;
    await this.dependencies.companionProvider.commitInputAudio();
  }

  getSnapshot(): SessionSnapshot {
    return {
      ...this.snapshot,
    };
  }

  private setSnapshot(patch: Partial<SessionSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
    };
    this.emitState();
  }

  private emitState(): void {
    this.dependencies.emitEvent({
      type: 'session-state',
      snapshot: this.getSnapshot(),
    });
  }

  private handleProviderEvent(event: ProviderEvent): void {
    const eventText = 'text' in event ? event.text : undefined;
    const eventMessage = 'message' in event ? event.message : undefined;
    if (
      event.type === 'transcript'
      || event.type === 'error'
      || (event.type === 'assistant-message' && event.isFinal !== false)
    ) {
      logDebug('session', 'Received provider event', {
        type: event.type,
        text: eventText ? truncateDebugText(eventText) : undefined,
        message: eventMessage,
      });
    }
    if (event.type === 'transcript' && event.text) {
      if (this.pendingProviderTurn) {
        this.discardBufferedProviderTurn('superseded-by-new-transcript');
      }

      this.setSnapshot({
        lastTranscript: event.text,
      });
      this.dependencies.emitEvent({
        type: 'transcript',
        transcript: event.text,
      });
      const turnId = ++this.pendingProviderTurnId;
      this.pendingProviderTurn = {
        id: turnId,
        transcript: event.text,
        startedAt: Date.now(),
        bufferedEvents: [],
        bufferLogEmitted: false,
        stats: {
          assistantMessageCount: 0,
          assistantAudioCount: 0,
          toolCallCount: 0,
          errorCount: 0,
          lastAssistantPreview: null,
        },
        deadlineTimer: setTimeout(() => {
          if (this.pendingProviderTurn?.id !== turnId) {
            return;
          }
          this.flushBufferedProviderTurn('routing-deadline-exceeded');
        }, this.getRealtimeRoutingDecisionDeadlineMs()),
      };
      void this.handleRealtimeProviderTranscript(event.text, turnId);
      return;
    }

    if (event.type === 'assistant-message' && event.text) {
      const bufferedEvent: BufferedProviderEvent = {
        type: 'assistant-message',
        text: event.text,
        isFinal: event.isFinal,
      };
      if (this.shouldBufferProviderEvent(bufferedEvent)) {
        this.pendingProviderTurn?.bufferedEvents.push(bufferedEvent);
        return;
      }

      if (this.isProviderReplySuppressed()) {
        logDebug('session', 'Suppressing provider assistant message because local orchestrator already took over', {
          transcript: truncateDebugText(this.suppressedProviderReply?.transcript || '', 200),
          reason: this.suppressedProviderReply?.reason || 'unknown',
          text: truncateDebugText(event.text, 200),
          isFinal: event.isFinal,
        });
        if (event.isFinal !== false) {
          this.clearProviderReplySuppression();
        }
        return;
      }

      this.setSnapshot({
        status: 'speaking',
        lastAssistantMessage: event.text,
      });
      this.dependencies.emitEvent({
        type: 'assistant-message',
        text: event.text,
        isFinal: event.isFinal,
      });
      if (event.isFinal !== false) {
        this.setSnapshot({
          status: 'listening',
          error: '',
        });
      }
      return;
    }

    if (event.type === 'tool-call') {
      if (this.pendingProviderTurn) {
        logDebug('session', 'Provider emitted tool call while routing was still pending; prioritizing tool execution', {
          transcript: truncateDebugText(this.pendingProviderTurn.transcript, 200),
          toolName: event.toolName,
        });
        this.discardBufferedProviderTurn('provider-tool-call');
      }

      const bufferedEvent: BufferedProviderEvent = {
        type: 'tool-call',
        toolName: event.toolName,
        arguments: event.arguments,
        rawText: event.rawText,
      };
      if (this.shouldBufferProviderEvent(bufferedEvent)) {
        this.pendingProviderTurn?.bufferedEvents.push(bufferedEvent);
        return;
      }

      if (this.isProviderReplySuppressed()) {
        logDebug('session', 'Suppressing provider tool call because local orchestrator already took over', {
          transcript: truncateDebugText(this.suppressedProviderReply?.transcript || '', 200),
          reason: this.suppressedProviderReply?.reason || 'unknown',
          toolName: event.toolName,
        });
        return;
      }

      void this.handleProviderToolCall(event);
      return;
    }

    if (
      event.type === 'assistant-audio'
      && event.pcmBase64
      && event.sampleRate
      && event.channels
      && event.format
    ) {
      const bufferedEvent: BufferedProviderEvent = {
        type: 'assistant-audio',
        pcmBase64: event.pcmBase64,
        sampleRate: event.sampleRate,
        channels: event.channels,
        format: event.format,
      };
      if (this.shouldBufferProviderEvent(bufferedEvent)) {
        this.pendingProviderTurn?.bufferedEvents.push(bufferedEvent);
        return;
      }

      if (this.isProviderReplySuppressed()) {
        return;
      }

      this.dependencies.emitEvent({
        type: 'assistant-audio',
        pcmBase64: event.pcmBase64,
        sampleRate: event.sampleRate,
        channels: event.channels,
        format: event.format,
      });
      return;
    }

    if (event.type === 'error' && event.message) {
      const bufferedEvent: BufferedProviderEvent = {
        type: 'error',
        message: event.message,
      };
      if (this.shouldBufferProviderEvent(bufferedEvent)) {
        this.pendingProviderTurn?.bufferedEvents.push(bufferedEvent);
        return;
      }

      this.setSnapshot({
        status: 'error',
        error: event.message,
      });
      this.dependencies.emitEvent({
        type: 'error',
        message: event.message,
      });
    }
  }

  private async handleRealtimeProviderTranscript(transcript: string, turnId: number): Promise<void> {
    await this.flushPendingCompanionIdentitySync();
    const conversation = await this.dependencies.orchestrator.handleRealtimeProviderTranscript?.(transcript);
    if (!this.pendingProviderTurn || this.pendingProviderTurn.id !== turnId) {
      if (
        conversation
        && this.pendingProviderTurnId === turnId
      ) {
        logDebug('session', 'Applying late local routing decision after provider turn was already released', {
          transcript: truncateDebugText(transcript, 200),
          hasRelatedTask: Boolean(conversation.relatedTask),
          eventCount: conversation.events.length,
        });
        this.applyRealtimeConversationTakeover(transcript, conversation);
      }
      return;
    }

    if (!conversation) {
      this.flushBufferedProviderTurn('no-local-takeover');
      return;
    }

    this.applyRealtimeConversationTakeover(transcript, conversation);
  }

  private applyRealtimeConversationTakeover(
    transcript: string,
    conversation: NonNullable<Awaited<ReturnType<ConversationOrchestrator['handleRealtimeProviderTranscript']>>>,
  ): void {
    logDebug('session', 'Realtime provider transcript was intercepted by local orchestrator', {
      transcript: truncateDebugText(transcript, 200),
      hasRelatedTask: Boolean(conversation.relatedTask),
      eventCount: conversation.events.length,
    });

    this.suppressedProviderReply = {
      transcript,
      startedAt: Date.now(),
      reason: conversation.relatedTask ? 'background-task' : 'local-control-intent',
    };
    if (this.pendingProviderTurn) {
      clearTimeout(this.pendingProviderTurn.deadlineTimer);
      this.pendingProviderTurn = null;
    }

    if (conversation.relatedTask) {
      this.setSnapshot({
        activeTaskId: conversation.relatedTask.id,
      });
    }

    for (const localEvent of conversation.events) {
      if (localEvent.type === 'assistant-message') {
        this.setSnapshot({
          status: 'speaking',
          lastAssistantMessage: localEvent.text,
          activeTaskId: localEvent.relatedTaskId ?? this.snapshot.activeTaskId,
        });
      }
      this.dependencies.emitEvent(localEvent);
    }
    this.queueCompanionIdentitySyncFromConversation(conversation.events);

    this.setSnapshot({
      status: 'listening',
      error: '',
    });
  }

  private async handleTranscript(transcript: string): Promise<void> {
    await this.flushPendingCompanionIdentitySync();
    logDebug('session', 'Handling transcript', {
      transcript: truncateDebugText(transcript),
    });
    this.setSnapshot({
      lastTranscript: transcript,
    });

    this.dependencies.emitEvent({
      type: 'transcript',
      transcript,
    });

    const conversation = await this.dependencies.orchestrator.handleTranscript(transcript);
    if (conversation.relatedTask) {
      this.setSnapshot({
        activeTaskId: conversation.relatedTask.id,
      });
    }
    logDebug('session', 'Conversation orchestrator produced result', {
      hasCompanionRequest: Boolean(conversation.companionRequest),
      eventCount: conversation.events.length,
      relatedTaskId: conversation.relatedTask?.id ?? null,
    });

    this.setSnapshot({
      status: 'speaking',
    });

    if (conversation.companionRequest) {
      let reply = conversation.companionRequest.fallbackText;
      let providerToolCall: {
        name: string;
        arguments: Record<string, unknown>;
        rawText?: string;
      } | null = null;

      if (this.dependencies.companionProvider.isEnabled()) {
        try {
          await this.syncCompanionIdentityImmediately();
          if (this.dependencies.companionProvider.generateReplyPayload) {
            const replyPayload = await this.dependencies.companionProvider.generateReplyPayload(
              conversation.companionRequest.prompt,
            );
            providerToolCall = replyPayload.toolCall;
            reply = replyPayload.message || conversation.companionRequest.fallbackText;
            logDebug('session', 'Received structured realtime provider reply payload', {
              transcript: truncateDebugText(transcript, 200),
              reply: replyPayload.message ? truncateDebugText(replyPayload.message, 320) : null,
              toolCall: providerToolCall?.name || null,
            });
          } else {
            reply = await this.dependencies.companionProvider.generateReply(conversation.companionRequest.prompt)
              || conversation.companionRequest.fallbackText;
            logDebug('session', 'Received realtime provider reply for companion prompt', {
              transcript: truncateDebugText(transcript, 200),
              reply: truncateDebugText(reply, 320),
            });
          }
        } catch (error: any) {
          logDebug('session', 'Realtime provider reply failed, falling back to local companion reply', {
            message: error?.message || 'unknown error',
          });
          reply = conversation.companionRequest.fallbackText;
        }
      } else {
        logDebug('session', 'Realtime provider unavailable, using local companion reply');
      }

      if (providerToolCall) {
        await this.handleProviderToolCall({
          type: 'tool-call',
          toolName: providerToolCall.name,
          arguments: providerToolCall.arguments,
          rawText: providerToolCall.rawText,
        });
        this.setSnapshot({
          status: 'listening',
          error: '',
        });
        return;
      }

      const handoffResult = this.dependencies.orchestrator.resolveCompanionReply?.(transcript, reply) ?? null;
      if (handoffResult) {
        logDebug('session', 'Resolved companion reply into background agent handoff', {
          transcript: truncateDebugText(transcript, 200),
          relatedTaskId: handoffResult.relatedTask?.id ?? null,
        });
        if (handoffResult.relatedTask) {
          this.setSnapshot({
            activeTaskId: handoffResult.relatedTask.id,
          });
        }

        for (const event of handoffResult.events) {
          if (event.type === 'assistant-message') {
            this.setSnapshot({
              lastAssistantMessage: event.text,
              activeTaskId: event.relatedTaskId ?? this.snapshot.activeTaskId,
            });
          }
          this.dependencies.emitEvent(event);
        }

        this.setSnapshot({
          status: 'listening',
          error: '',
        });
        return;
      }

      this.setSnapshot({
        lastAssistantMessage: reply,
      });

      this.dependencies.emitEvent({
        type: 'assistant-message',
        text: reply,
      });
      logDebug('session', 'Emitted companion reply', {
        reply: truncateDebugText(reply),
      });
    }

    for (const event of conversation.events) {
      if (event.type === 'assistant-message') {
        this.setSnapshot({
          lastAssistantMessage: event.text,
          activeTaskId: event.relatedTaskId ?? this.snapshot.activeTaskId,
        });
      }
      this.dependencies.emitEvent(event);
    }
    this.queueCompanionIdentitySyncFromConversation(conversation.events);

    this.setSnapshot({
      status: 'listening',
      error: '',
    });
  }

  private getCompanionIdentityDisplayName(): string | null {
    const identity = this.dependencies.orchestrator.getCompanionIdentity?.();
    const displayName = identity?.displayName?.trim();
    return displayName || null;
  }

  private async syncCompanionIdentityImmediately(displayName = this.getCompanionIdentityDisplayName()): Promise<void> {
    const nextDisplayName = displayName?.trim();
    if (!nextDisplayName) {
      return;
    }

    this.clearPendingCompanionIdentitySync();
    await this.dependencies.companionProvider.syncCompanionIdentity({
      displayName: nextDisplayName,
    });
    this.lastSyncedCompanionDisplayName = nextDisplayName;
  }

  private queueCompanionIdentitySyncFromConversation(events: SessionEvent[]): void {
    const displayName = this.getCompanionIdentityDisplayName();
    if (!displayName || displayName === this.lastSyncedCompanionDisplayName) {
      return;
    }

    const assistantMessage = [...events]
      .reverse()
      .find((event) => event.type === 'assistant-message')?.text || '';
    this.queueCompanionIdentitySync(displayName, assistantMessage);
  }

  private queueCompanionIdentitySync(displayName: string, assistantMessage = ''): void {
    const nextDisplayName = displayName.trim();
    if (!nextDisplayName || nextDisplayName === this.lastSyncedCompanionDisplayName) {
      return;
    }

    const delayMs = assistantMessage
      ? this.getSpeechDelayMs(assistantMessage)
      : 0;
    this.clearPendingCompanionIdentitySync();
    const timer = setTimeout(() => {
      void this.flushPendingCompanionIdentitySync();
    }, delayMs);
    this.pendingCompanionIdentitySync = {
      displayName: nextDisplayName,
      timer,
    };
    logDebug('session', 'Queued deferred companion identity sync', {
      displayName: nextDisplayName,
      delayMs,
      assistantMessage: assistantMessage ? truncateDebugText(assistantMessage, 200) : null,
    });
  }

  private async flushPendingCompanionIdentitySync(): Promise<void> {
    if (!this.pendingCompanionIdentitySync) {
      return;
    }

    const { displayName } = this.pendingCompanionIdentitySync;
    this.clearPendingCompanionIdentitySync();
    await this.syncCompanionIdentityImmediately(displayName);
  }

  private clearPendingCompanionIdentitySync(): void {
    if (!this.pendingCompanionIdentitySync) {
      return;
    }

    clearTimeout(this.pendingCompanionIdentitySync.timer);
    this.pendingCompanionIdentitySync = null;
  }

  private getSpeechDelayMs(text: string): number {
    if (this.dependencies.estimateSpeechDelayMs) {
      return Math.max(0, this.dependencies.estimateSpeechDelayMs(text));
    }

    const normalizedLength = text.replace(/\s+/g, '').length;
    return Math.max(900, Math.min(3600, 520 + normalizedLength * 170));
  }

  private getRealtimeRoutingDecisionDeadlineMs(): number {
    return Math.max(
      0,
      this.dependencies.realtimeRoutingDecisionDeadlineMs
        ?? DEFAULT_REALTIME_ROUTING_DECISION_DEADLINE_MS,
    );
  }

  private isProviderReplySuppressed(): boolean {
    if (!this.suppressedProviderReply) {
      return false;
    }

    if (Date.now() - this.suppressedProviderReply.startedAt > 15000) {
      this.clearProviderReplySuppression();
      return false;
    }

    return true;
  }

  private clearProviderReplySuppression(): void {
    this.suppressedProviderReply = null;
  }

  private shouldBufferProviderEvent(event: {
    type: 'assistant-message' | 'assistant-audio' | 'tool-call' | 'error';
    text?: string;
    isFinal?: boolean;
    message?: string;
    pcmBase64?: string;
    sampleRate?: number;
    channels?: number;
    format?: 'pcm_s16le';
    toolName?: string;
  }): boolean {
    if (!this.pendingProviderTurn) {
      return false;
    }

    if (Date.now() - this.pendingProviderTurn.startedAt > REALTIME_ROUTING_BUFFER_MAX_MS) {
      this.flushBufferedProviderTurn('routing-timeout');
      return false;
    }

    this.recordBufferedProviderEvent(event);
    if (!this.pendingProviderTurn.bufferLogEmitted) {
      this.pendingProviderTurn.bufferLogEmitted = true;
      logDebug('session', 'Started buffering realtime provider output while waiting for local routing decision', {
        transcript: truncateDebugText(this.pendingProviderTurn.transcript, 200),
        deadlineMs: this.getRealtimeRoutingDecisionDeadlineMs(),
      });
    }
    return true;
  }

  private flushBufferedProviderTurn(reason: string): void {
    const pendingTurn = this.pendingProviderTurn;
    if (!pendingTurn) {
      return;
    }

    logDebug('session', 'Flushing buffered provider turn after local routing decision', {
      transcript: truncateDebugText(pendingTurn.transcript, 200),
      reason,
      bufferedEventCount: pendingTurn.bufferedEvents.length,
      assistantMessageCount: pendingTurn.stats.assistantMessageCount,
      assistantAudioCount: pendingTurn.stats.assistantAudioCount,
      toolCallCount: pendingTurn.stats.toolCallCount,
      errorCount: pendingTurn.stats.errorCount,
      lastAssistantPreview: pendingTurn.stats.lastAssistantPreview,
    });

    this.pendingProviderTurn = null;
    clearTimeout(pendingTurn.deadlineTimer);
    const filteredEvents = this.filterBufferedProviderEventsBeforeFlush(pendingTurn.bufferedEvents, reason);
    for (const bufferedEvent of filteredEvents) {
      this.handleProviderEvent(bufferedEvent);
    }
  }

  private discardBufferedProviderTurn(reason: string): void {
    const pendingTurn = this.pendingProviderTurn;
    if (!pendingTurn) {
      return;
    }

    logDebug('session', 'Discarding buffered provider turn before local routing completed', {
      transcript: truncateDebugText(pendingTurn.transcript, 200),
      reason,
      bufferedEventCount: pendingTurn.bufferedEvents.length,
      assistantMessageCount: pendingTurn.stats.assistantMessageCount,
      assistantAudioCount: pendingTurn.stats.assistantAudioCount,
      toolCallCount: pendingTurn.stats.toolCallCount,
      errorCount: pendingTurn.stats.errorCount,
    });

    this.pendingProviderTurn = null;
    clearTimeout(pendingTurn.deadlineTimer);
  }

  private filterBufferedProviderEventsBeforeFlush(
    bufferedEvents: BufferedProviderEvent[],
    reason: string,
  ): BufferedProviderEvent[] {
    const hasCompatibilityDirectiveLeak = bufferedEvents.some((event) =>
      event.type === 'assistant-message' && looksLikeCompatibilityDirectiveLeak(event.text),
    );
    if (!hasCompatibilityDirectiveLeak) {
      return bufferedEvents;
    }

    logDebug('session', 'Dropping malformed compatibility directive fragments before provider turn flush', {
      reason,
      droppedEventCount: bufferedEvents.filter((event) =>
        event.type === 'assistant-message'
        || event.type === 'assistant-audio',
      ).length,
    });

    return bufferedEvents.filter((event) => {
      if (event.type === 'assistant-message') {
        return !looksLikeCompatibilityDirectiveLeak(event.text);
      }

      if (event.type === 'assistant-audio') {
        return false;
      }

      return true;
    });
  }

  private recordBufferedProviderEvent(event: {
    type: 'assistant-message' | 'assistant-audio' | 'tool-call' | 'error';
    text?: string;
  }): void {
    if (!this.pendingProviderTurn) {
      return;
    }

    if (event.type === 'assistant-message') {
      this.pendingProviderTurn.stats.assistantMessageCount += 1;
      this.pendingProviderTurn.stats.lastAssistantPreview = event.text
        ? truncateDebugText(event.text, 80)
        : this.pendingProviderTurn.stats.lastAssistantPreview;
      return;
    }

    if (event.type === 'assistant-audio') {
      this.pendingProviderTurn.stats.assistantAudioCount += 1;
      return;
    }

    if (event.type === 'tool-call') {
      this.pendingProviderTurn.stats.toolCallCount += 1;
      return;
    }

    this.pendingProviderTurn.stats.errorCount += 1;
  }

  private async handleProviderToolCall(event: {
    type: 'tool-call';
    toolName: string;
    arguments: Record<string, unknown>;
    rawText?: string;
  }): Promise<void> {
    logDebug('session', 'Handling provider tool call', {
      toolName: event.toolName,
      arguments: event.arguments,
      rawText: event.rawText ? truncateDebugText(event.rawText, 320) : undefined,
    });

    const toolExecution = await this.dependencies.companionProvider.executeToolCall?.({
      name: event.toolName,
      arguments: event.arguments,
      rawText: event.rawText,
    });

    if (!toolExecution) {
      this.dependencies.emitEvent({
        type: 'error',
        message: `工具调用失败：${event.toolName}`,
      });
      return;
    }

    if (toolExecution.relatedTaskId) {
      this.setSnapshot({
        activeTaskId: toolExecution.relatedTaskId,
      });
    }

    if (toolExecution.syncCompanionIdentity) {
      this.queueCompanionIdentitySync(
        toolExecution.syncCompanionIdentity,
        toolExecution.assistantMessage || '',
      );
    }

    if (toolExecution.assistantMessage) {
      this.setSnapshot({
        status: 'speaking',
        lastAssistantMessage: toolExecution.assistantMessage,
        activeTaskId: toolExecution.relatedTaskId ?? this.snapshot.activeTaskId,
      });
      this.dependencies.emitEvent({
        type: 'assistant-message',
        text: toolExecution.assistantMessage,
        relatedTaskId: toolExecution.relatedTaskId,
      });
    }

    this.setSnapshot({
      status: 'listening',
      error: '',
    });
  }
}

function looksLikeCompatibilityDirectiveLeak(text: string): boolean {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return false;
  }

  const lowered = normalizedText.toLowerCase();
  if (!(lowered.includes('celcat') && lowered.includes('name='))) {
    return false;
  }

  return lowered.includes('openbrowser')
    || lowered.includes('renamecompanion')
    || lowered.includes('startagenttask')
    || lowered.includes('tool');
}
