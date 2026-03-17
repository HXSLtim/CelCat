import type { SessionEvent, SessionSnapshot, StreamingAudioFrame, UserAudioPayload } from '../../types/session';
import { logDebug, truncateDebugText } from '../../shared/debugLogger';
import { ConversationOrchestrator } from '../orchestrator/conversationOrchestrator';
import type { CompanionProvider } from './providerClient';

type SessionManagerDependencies = {
  transcribeAudio(input: UserAudioPayload): Promise<{ text: string }>;
  orchestrator: ConversationOrchestrator;
  companionProvider: CompanionProvider;
  emitEvent(event: SessionEvent): void;
};

const DEFAULT_SNAPSHOT: SessionSnapshot = {
  status: 'idle',
  connected: false,
  lastTranscript: '',
  lastAssistantMessage: '',
  activeTaskId: null,
  error: '',
};

export class SessionManager {
  private snapshot: SessionSnapshot = DEFAULT_SNAPSHOT;
  private totalForwardedAudioFrames = 0;
  private forwardedFramesSinceLastCommit = 0;

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

  private handleProviderEvent(event: {
    type: 'transcript' | 'assistant-message' | 'assistant-audio' | 'error';
    text?: string;
    isFinal?: boolean;
    message?: string;
    pcmBase64?: string;
    sampleRate?: number;
    channels?: number;
    format?: 'pcm_s16le';
  }): void {
    if (
      event.type === 'transcript'
      || event.type === 'error'
      || (event.type === 'assistant-message' && event.isFinal !== false)
    ) {
      logDebug('session', 'Received provider event', {
        type: event.type,
        text: event.text ? truncateDebugText(event.text) : undefined,
        message: event.message,
      });
    }
    if (event.type === 'transcript' && event.text) {
      this.setSnapshot({
        lastTranscript: event.text,
      });
      this.dependencies.emitEvent({
        type: 'transcript',
        transcript: event.text,
      });
      return;
    }

    if (event.type === 'assistant-message' && event.text) {
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

    if (
      event.type === 'assistant-audio'
      && event.pcmBase64
      && event.sampleRate
      && event.channels
      && event.format
    ) {
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

  private async handleTranscript(transcript: string): Promise<void> {
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

      if (this.dependencies.companionProvider.isEnabled()) {
        try {
          reply = await this.dependencies.companionProvider.generateReply(conversation.companionRequest.prompt)
            || conversation.companionRequest.fallbackText;
        } catch (error: any) {
          logDebug('session', 'Realtime provider reply failed, falling back to local companion reply', {
            message: error?.message || 'unknown error',
          });
          reply = conversation.companionRequest.fallbackText;
        }
      } else {
        logDebug('session', 'Realtime provider unavailable, using local companion reply');
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

    this.setSnapshot({
      status: 'listening',
      error: '',
    });
  }
}
