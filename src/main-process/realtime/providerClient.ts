import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { logDebug, truncateDebugText } from '../../shared/debugLogger';
import {
  buildChatTextQueryFrame,
  buildFinishConnectionFrame,
  buildFinishSessionFrame,
  buildSayHelloFrame,
  buildStartConnectionFrame,
  buildStartSessionFrame,
  buildTaskRequestFrame,
  parseRealtimeResponse,
} from './protocol';

type PendingReply = {
  resolve: (value: string | null) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
  textParts: string[];
};

type ProviderEvent =
  | { type: 'transcript'; text: string }
  | { type: 'assistant-message'; text: string; isFinal?: boolean }
  | { type: 'assistant-audio'; pcmBase64: string; sampleRate: number; channels: number; format: 'pcm_s16le' }
  | { type: 'error'; message: string };

type VolcengineRealtimeConfig = {
  enabled: boolean;
  address: string;
  uri: string;
  appId: string;
  appKey: string;
  accessToken: string;
  resourceId: string;
  uid: string;
  botName: string;
  headersJson: string;
  appendEventName: string;
  commitEventName: string;
  systemRole: string;
  speakingStyle: string;
  speaker: string;
  ttsFormat: 'pcm' | 'pcm_s16le';
  ttsSampleRate: number;
};

type RealtimeHeaderMap = Record<string, string>;
const VOLCENGINE_FIXED_APP_KEY = 'PlgvMymc7f3tQnJ6';

export type CompanionProvider = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  startSession(): Promise<void>;
  generateReply(input: string): Promise<string | null>;
  appendInputAudioFrame(frame: { pcmBase64: string; sampleRate: number; channels: number }): Promise<void>;
  commitInputAudio(): Promise<void>;
  isEnabled(): boolean;
  setEventSink(listener: ((event: ProviderEvent) => void) | null): void;
};

export function readVolcengineRealtimeConfig(env: NodeJS.ProcessEnv): VolcengineRealtimeConfig {
  return {
    enabled: env.VOLCENGINE_REALTIME_ENABLED === 'true',
    address: env.VOLCENGINE_REALTIME_ADDRESS || 'wss://openspeech.bytedance.com',
    uri: env.VOLCENGINE_REALTIME_URI || '/api/v3/realtime/dialogue',
    appId: env.VOLCENGINE_APP_ID || '',
    appKey: env.VOLCENGINE_PROTOCOL_APP_KEY || VOLCENGINE_FIXED_APP_KEY,
    accessToken: env.VOLCENGINE_ACCESS_KEY || env.VOLCENGINE_ACCESS_TOKEN || '',
    resourceId: env.VOLCENGINE_RESOURCE_ID || 'volc.speech.dialog',
    uid: env.VOLCENGINE_UID || `celcat-${process.pid}`,
    botName: env.VOLCENGINE_BOT_NAME || '豆包',
    headersJson: env.VOLCENGINE_REALTIME_HEADERS_JSON || '',
    appendEventName: env.VOLCENGINE_REALTIME_APPEND_EVENT || 'input_audio_buffer.append',
    commitEventName: env.VOLCENGINE_REALTIME_COMMIT_EVENT || 'input_audio_buffer.commit',
    systemRole: env.VOLCENGINE_SYSTEM_ROLE || '你是一个温柔自然的中文语音助手。',
    speakingStyle: env.VOLCENGINE_SPEAKING_STYLE || '你的说话风格简洁自然，语速适中。',
    speaker: env.VOLCENGINE_TTS_SPEAKER || 'zh_female_vv_jupiter_bigtts',
    ttsFormat: env.VOLCENGINE_TTS_FORMAT === 'pcm' ? 'pcm' : 'pcm_s16le',
    ttsSampleRate: Number.parseInt(env.VOLCENGINE_TTS_SAMPLE_RATE || '24000', 10) || 24000,
  };
}

export function buildVolcengineRealtimeHeaders(
  config: VolcengineRealtimeConfig,
  connectId: string,
): RealtimeHeaderMap {
  const extraHeaders = parseHeadersJson(config.headersJson);

  return {
    'X-Api-App-ID': config.appId,
    'X-Api-App-Key': config.appKey,
    'X-Api-Access-Key': config.accessToken,
    'X-Api-Resource-Id': config.resourceId,
    'X-Api-Connect-Id': connectId,
    ...extraHeaders,
  };
}

export class VolcengineRealtimeProviderClient implements CompanionProvider {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private sessionStartPromise: Promise<void> | null = null;
  private pendingReply: PendingReply | null = null;
  private eventSink: ((event: ProviderEvent) => void) | null = null;
  private totalAudioFrameCount = 0;
  private audioFramesSinceLastCommit = 0;
  private bufferedAssistantText = '';
  private bufferedAssistantTextTimer: NodeJS.Timeout | null = null;
  private lastEmittedAssistantText = '';
  private lastFinalAssistantText = '';
  private lastFinalAssistantTextAt = 0;
  private hasCommittedUserAudio = false;
  private sessionStarted = false;
  private inputAudioReady = false;
  private connectId = randomUUID();
  private sessionId = randomUUID();
  private readonly pendingEventWaiters = new Map<number, Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout | null;
  }>>();

  constructor(
    private readonly config: VolcengineRealtimeConfig = readVolcengineRealtimeConfig(process.env),
  ) {}

  isEnabled(): boolean {
    return this.config.enabled
      && Boolean(this.config.appId)
      && Boolean(this.config.appKey)
      && Boolean(this.config.accessToken)
      && Boolean(this.config.resourceId);
  }

  setEventSink(listener: ((event: ProviderEvent) => void) | null): void {
    this.eventSink = listener;
  }

  async connect(): Promise<void> {
    if (!this.isEnabled()) {
      logDebug('provider', 'Skipping connect because realtime provider is disabled');
      return;
    }

    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    const url = `${this.config.address}${this.config.uri}`;
    const headers = this.getHeaders();
    logDebug('provider', 'Opening realtime websocket', {
      url,
      connectId: this.connectId,
      appKey: this.config.appKey,
      headerKeys: Object.keys(headers),
    });

    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { headers });

      const handleOpen = () => {
        this.socket = socket;
        this.bindSocket(socket);
        this.connectPromise = null;
        logDebug('provider', 'Realtime websocket connected');
        resolve();
      };

      const handleError = (error: Error) => {
        this.connectPromise = null;
        logDebug('provider', 'Realtime websocket connect failed', {
          message: error.message,
        });
        reject(error);
      };

      socket.once('open', handleOpen);
      socket.once('error', handleError);
    });

    return this.connectPromise;
  }

  async disconnect(): Promise<void> {
    const socket = this.socket;
    if (!socket) {
      return;
    }

    logDebug('provider', 'Closing realtime websocket');
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(buildFinishSessionFrame(this.sessionId));
        socket.send(buildFinishConnectionFrame());
      } catch {
        // Ignore teardown errors while closing.
      }
    }
    await new Promise<void>((resolve) => {
      this.socket = null;
      socket.once('close', () => resolve());
      socket.close();
      setTimeout(resolve, 300);
    });
    this.connectId = randomUUID();
    this.sessionId = randomUUID();
    this.resetBufferedAssistantText();
    this.hasCommittedUserAudio = false;
    this.sessionStarted = false;
    this.inputAudioReady = false;
    this.rejectPendingEventWaiters(new Error('实时语音连接已关闭'));
  }

  async startSession(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    if (this.sessionStarted && this.inputAudioReady) {
      return;
    }

    if (this.sessionStartPromise) {
      return this.sessionStartPromise;
    }

    this.sessionStartPromise = this.startSessionInternal()
      .finally(() => {
        this.sessionStartPromise = null;
      });

    return this.sessionStartPromise;
  }

  async generateReply(input: string): Promise<string | null> {
    if (!this.isEnabled()) {
      return null;
    }

    await this.startSession();

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return null;
    }

    if (this.pendingReply) {
      throw new Error('实时语音模型仍在处理上一条消息');
    }

    const requestId = randomUUID();
    logDebug('provider', 'Sending ChatTextQuery event', {
      requestId,
      prompt: truncateDebugText(input),
    });

    return new Promise<string | null>((resolve, reject) => {
      this.pendingReply = {
        resolve,
        reject,
        timer: null,
        textParts: [],
      };

      this.sendMessage(buildChatTextQueryFrame(this.sessionId, input), 'ChatTextQuery');

      this.pendingReply!.timer = setTimeout(() => {
        const text = this.pendingReply?.textParts.join('').trim() || null;
        this.finishPendingReply(text);
      }, 8000);
    });
  }

  async appendInputAudioFrame(frame: { pcmBase64: string; sampleRate: number; channels: number }): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    if (!this.sessionStarted || !this.inputAudioReady) {
      if (!this.sessionStartPromise) {
        void this.startSession().catch((error: Error) => {
          this.eventSink?.({
            type: 'error',
            message: error.message,
          });
        });
      }
      return;
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.totalAudioFrameCount += 1;
    this.audioFramesSinceLastCommit += 1;
    this.sendMessage(
      buildTaskRequestFrame(this.sessionId, Buffer.from(frame.pcmBase64, 'base64')),
      'TaskRequest',
    );
  }

  async commitInputAudio(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    if (!this.sessionStarted || !this.inputAudioReady) {
      if (!this.sessionStartPromise) {
        void this.startSession().catch((error: Error) => {
          this.eventSink?.({
            type: 'error',
            message: error.message,
          });
        });
      }
      return;
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.hasCommittedUserAudio = this.hasCommittedUserAudio || this.audioFramesSinceLastCommit > 0;
    this.audioFramesSinceLastCommit = 0;
  }

  private bindSocket(socket: WebSocket): void {
    socket.on('message', (rawMessage: WebSocket.RawData) => {
      this.handleMessage(Buffer.isBuffer(rawMessage) ? rawMessage : Buffer.from(rawMessage as ArrayBuffer));
    });

    socket.on('close', () => {
      logDebug('provider', 'Realtime websocket closed');
      this.socket = null;
      this.flushBufferedAssistantText();
      this.hasCommittedUserAudio = false;
      this.sessionStarted = false;
      this.inputAudioReady = false;
      this.rejectPendingEventWaiters(new Error('实时语音连接已关闭'));
      if (this.pendingReply) {
        this.finishPendingReply(this.pendingReply.textParts.join('').trim() || null);
      }
    });

    socket.on('error', (error: Error) => {
      logDebug('provider', 'Realtime websocket emitted error', {
        message: error?.message || 'unknown error',
      });
      if (this.pendingReply) {
        this.pendingReply.reject(error instanceof Error ? error : new Error('实时语音连接失败'));
        this.pendingReply = null;
      }
      this.rejectPendingEventWaiters(error instanceof Error ? error : new Error('实时语音连接失败'));
      this.eventSink?.({
        type: 'error',
        message: error?.message || '实时语音连接失败',
      });
    });
  }

  private handleMessage(rawMessage: Buffer): void {
    try {
      const response = parseRealtimeResponse(rawMessage);
      const responseEvent = 'event' in response ? response.event : undefined;
      const payload = isRecord(response.payload) ? response.payload : {};
      this.resolvePendingEventWaiters(responseEvent);
      const transcript = extractTranscriptFromProviderPayload(payload);
      const assistantText = extractAssistantTextFromProviderPayload(payload);
      const assistantAudio = extractAssistantAudioChunk(response);
      const terminal = isTerminalProviderPayload(payload) || isTerminalEvent(responseEvent);
      if (responseEvent === 150) {
        this.sessionStarted = true;
      }
      if (responseEvent === 450) {
        this.resetBufferedAssistantText();
      }
      if (responseEvent === 359) {
        this.inputAudioReady = true;
      }

      if (transcript) {
        this.eventSink?.({
          type: 'transcript',
          text: transcript,
        });
      }

      if (assistantAudio && this.shouldEmitRealtimeAssistantOutputs()) {
        this.eventSink?.(assistantAudio);
      }

      if (assistantText && !this.pendingReply && this.shouldEmitRealtimeAssistantText(responseEvent)) {
        this.bufferAssistantText(assistantText, terminal);
      }

      if (this.pendingReply && assistantText) {
        this.pendingReply.textParts.push(assistantText);
        if (this.pendingReply.timer) {
          clearTimeout(this.pendingReply.timer);
        }
        this.pendingReply.timer = setTimeout(() => {
          this.finishPendingReply(this.pendingReply?.textParts.join('').trim() || null);
        }, 240);
      }

      if (this.pendingReply && terminal) {
        this.finishPendingReply(this.pendingReply.textParts.join('').trim() || null);
      }
      if (terminal) {
        this.flushBufferedAssistantText();
      }
      if (response.messageType === 'SERVER_ERROR') {
        const message = extractErrorMessage(response.payload);
        this.eventSink?.({
          type: 'error',
          message,
        });
      }
    } catch (error: any) {
      logDebug('provider', 'Failed to parse provider payload', {
        message: error?.message || 'unknown error',
      });
    }
  }

  private async startSessionInternal(): Promise<void> {
    await this.connect();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (this.sessionStarted && this.inputAudioReady) {
      return;
    }

    logDebug('provider', 'Sending StartConnection frame');
    this.sendMessage(buildStartConnectionFrame(), 'StartConnection');
    await this.waitForProviderEvent(50, 4000).catch(() => {
      logDebug('provider', 'StartConnection acknowledgement timed out; continuing');
    });

    logDebug('provider', 'Sending StartSession frame', {
      botName: this.config.botName,
      uid: this.config.uid,
      sessionId: this.sessionId,
    });
    this.sendMessage(buildStartSessionFrame(this.sessionId, createStartSessionPayload(this.config)), 'StartSession');
    await this.waitForProviderEvent(150, 4000).catch(() => {
      logDebug('provider', 'StartSession acknowledgement timed out; continuing');
    });
    this.sessionStarted = true;

    if (this.inputAudioReady) {
      return;
    }

    logDebug('provider', 'Sending SayHello frame');
    this.sendMessage(
      buildSayHelloFrame(this.sessionId, '你好，我是豆包，有什么可以帮助你的？'),
      'SayHello',
    );
    await this.waitForProviderEvent(359, 12000).catch(() => {
      logDebug('provider', 'SayHello completion timed out; enabling microphone streaming anyway');
    });
    this.inputAudioReady = true;
  }

  private sendMessage(payload: Buffer, label = 'binary-frame'): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('实时语音连接尚未建立');
    }

    if (label !== 'TaskRequest') {
      logDebug('provider', 'Sending provider payload', {
        event: label,
        byteLength: payload.byteLength,
      });
    }
    this.socket.send(payload);
  }

  private getHeaders(): Record<string, string> {
    return buildVolcengineRealtimeHeaders(this.config, this.connectId);
  }

  private finishPendingReply(text: string | null): void {
    if (!this.pendingReply) {
      return;
    }

    if (this.pendingReply.timer) {
      clearTimeout(this.pendingReply.timer);
    }

    logDebug('provider', 'Completing pending provider reply', {
      reply: text ? truncateDebugText(text) : null,
    });
    this.pendingReply.resolve(text);
    this.pendingReply = null;
  }

  private bufferAssistantText(text: string, terminal: boolean): void {
    this.bufferedAssistantText = mergeRealtimeAssistantText(this.bufferedAssistantText, text);
    if (terminal) {
      this.flushBufferedAssistantText(true);
      return;
    }

    this.emitBufferedAssistantText(false);
    if (this.bufferedAssistantTextTimer) {
      clearTimeout(this.bufferedAssistantTextTimer);
    }

    this.bufferedAssistantTextTimer = setTimeout(() => {
      this.flushBufferedAssistantText(true);
    }, 260);
  }

  private flushBufferedAssistantText(isFinal = true): void {
    if (this.bufferedAssistantTextTimer) {
      clearTimeout(this.bufferedAssistantTextTimer);
      this.bufferedAssistantTextTimer = null;
    }

    const text = this.bufferedAssistantText.trim();
    if (!text) {
      this.bufferedAssistantText = '';
      return;
    }

    this.emitBufferedAssistantText(isFinal);
    if (isFinal) {
      this.bufferedAssistantText = '';
      this.lastEmittedAssistantText = '';
    }
  }

  private resetBufferedAssistantText(): void {
    if (this.bufferedAssistantTextTimer) {
      clearTimeout(this.bufferedAssistantTextTimer);
      this.bufferedAssistantTextTimer = null;
    }
    this.bufferedAssistantText = '';
    this.lastEmittedAssistantText = '';
  }

  private emitBufferedAssistantText(isFinal: boolean): void {
    const text = normalizeRealtimeAssistantEmission(
      this.bufferedAssistantText.trim(),
      isFinal ? this.lastFinalAssistantText : '',
      isFinal ? this.lastFinalAssistantTextAt : 0,
    );
    if (!text) {
      return;
    }

    if (!isFinal && text === this.lastEmittedAssistantText) {
      return;
    }

    this.lastEmittedAssistantText = text;
    if (isFinal) {
      this.lastFinalAssistantText = text;
      this.lastFinalAssistantTextAt = Date.now();
    }
    this.eventSink?.({
      type: 'assistant-message',
      text,
      isFinal,
    });
  }

  private shouldEmitRealtimeAssistantText(event?: number): boolean {
    if (this.pendingReply) {
      return false;
    }

    if (!this.inputAudioReady && !this.hasCommittedUserAudio) {
      return false;
    }

    if (event === 359 && !this.hasCommittedUserAudio) {
      return false;
    }

    return event === 550 || event === 559 || event === 551 || event === 552;
  }

  private shouldEmitRealtimeAssistantOutputs(): boolean {
    return this.inputAudioReady || this.hasCommittedUserAudio || Boolean(this.pendingReply);
  }

  private waitForProviderEvent(event: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: () => {
          if (waiter.timer) {
            clearTimeout(waiter.timer);
          }
          resolve();
        },
        reject: (error: Error) => {
          if (waiter.timer) {
            clearTimeout(waiter.timer);
          }
          reject(error);
        },
        timer: setTimeout(() => {
          this.removePendingEventWaiter(event, waiter);
          reject(new Error(`等待事件 ${event} 超时`));
        }, timeoutMs),
      };

      const waiters = this.pendingEventWaiters.get(event) ?? [];
      waiters.push(waiter);
      this.pendingEventWaiters.set(event, waiters);
    });
  }

  private resolvePendingEventWaiters(event?: number): void {
    if (event === undefined) {
      return;
    }

    const waiters = this.pendingEventWaiters.get(event);
    if (!waiters?.length) {
      return;
    }

    this.pendingEventWaiters.delete(event);
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }

  private rejectPendingEventWaiters(error: Error): void {
    for (const [event, waiters] of this.pendingEventWaiters.entries()) {
      this.pendingEventWaiters.delete(event);
      for (const waiter of waiters) {
        waiter.reject(error);
      }
    }
  }

  private removePendingEventWaiter(
    event: number,
    waiter: { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout | null },
  ): void {
    const waiters = this.pendingEventWaiters.get(event);
    if (!waiters?.length) {
      return;
    }

    const nextWaiters = waiters.filter((candidate) => candidate !== waiter);
    if (nextWaiters.length) {
      this.pendingEventWaiters.set(event, nextWaiters);
      return;
    }

    this.pendingEventWaiters.delete(event);
  }
}

function parseHeadersJson(raw: string): Record<string, string> {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function createStartSessionPayload(config: VolcengineRealtimeConfig): Record<string, unknown> {
  return {
    asr: {
      extra: {
        end_smooth_window_ms: 1500,
      },
    },
    tts: {
      speaker: config.speaker,
      audio_config: {
        channel: 1,
        format: config.ttsFormat,
        sample_rate: config.ttsSampleRate,
      },
    },
    dialog: {
      bot_name: config.botName,
      system_role: config.systemRole,
      speaking_style: config.speakingStyle,
      location: {
        city: '北京',
      },
      extra: {
        strict_audit: false,
        recv_timeout: 10,
        input_mod: 'audio',
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Buffer.isBuffer(value);
}

function isTerminalEvent(event?: number): boolean {
  return event === 152 || event === 153 || event === 359 || event === 459;
}

function extractAssistantAudioChunk(
  response: ReturnType<typeof parseRealtimeResponse>,
): Extract<ProviderEvent, { type: 'assistant-audio' }> | null {
  if (response.messageType !== 'SERVER_ACK' || !Buffer.isBuffer(response.rawPayload) || !response.rawPayload.length) {
    return null;
  }

  return {
    type: 'assistant-audio',
    pcmBase64: response.rawPayload.toString('base64'),
    sampleRate: 24000,
    channels: 1,
    format: 'pcm_s16le',
  };
}

function extractErrorMessage(payload: unknown): string {
  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }

  if (isRecord(payload)) {
    const candidate = payload.message ?? payload.error ?? payload.detail ?? payload.msg;
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return '实时语音服务返回错误';
}

function extractAssistantTextFromProviderPayload(payload: Record<string, any>): string {
  return collectNestedText(payload, [
    'reply',
    'text',
    'content',
    'message',
    'reply_text',
    'tts_text',
    'sentence',
    'utterance',
    'answer',
    'delta',
    'value',
  ]);
}

function extractTranscriptFromProviderPayload(payload: Record<string, any>): string {
  return collectNestedText(payload, [
    'transcript',
    'asr',
    'asr_text',
    'user_text',
    'query',
    'input',
  ]);
}

function isTerminalProviderPayload(payload: Record<string, any>): boolean {
  const statusCandidates = [
    payload.status,
    payload.event,
    payload.type,
    payload.payload?.status,
    payload.data?.status,
    payload.dialog?.status,
  ];

  return statusCandidates.some((candidate) =>
    typeof candidate === 'string' && /(finish|final|done|complete|completed|end|stopped|stop)/i.test(candidate),
  );
}

function mergeRealtimeAssistantText(current: string, next: string): string {
  const currentText = current.trim();
  const nextText = next.trim();

  if (!currentText) {
    return nextText;
  }

  if (!nextText) {
    return currentText;
  }

  if (nextText.includes(currentText)) {
    return nextText;
  }

  if (currentText.includes(nextText)) {
    return currentText;
  }

  const overlapLength = getRealtimeAssistantTextOverlap(currentText, nextText);
  if (overlapLength > 0) {
    return `${currentText}${nextText.slice(overlapLength)}`;
  }

  return `${currentText}${nextText}`;
}

function normalizeRealtimeAssistantEmission(
  text: string,
  previousFinalText: string,
  previousFinalAt: number,
): string {
  if (!text) {
    return '';
  }

  if (
    isPunctuationOnlyText(text)
    && previousFinalText
    && Date.now() - previousFinalAt <= 1500
  ) {
    return `${previousFinalText}${text}`;
  }

  return text;
}

function isPunctuationOnlyText(text: string): boolean {
  return /^[，。！？、；：,.!?;:~～…"'“”‘’\s()（）-]+$/.test(text);
}

function getRealtimeAssistantTextOverlap(current: string, next: string): number {
  const maxOverlap = Math.min(current.length, next.length);

  for (let overlapLength = maxOverlap; overlapLength > 0; overlapLength -= 1) {
    if (current.slice(-overlapLength) === next.slice(0, overlapLength)) {
      return overlapLength;
    }
  }

  return 0;
}

function collectNestedText(
  payload: Record<string, any>,
  preferredKeys: string[],
  maxDepth = 4,
): string {
  const collected = new Set<string>();
  const preferredKeySet = new Set(preferredKeys);
  const visited = new Set<unknown>();

  const visit = (value: unknown, depth: number, parentKey = ''): void => {
    if (depth > maxDepth || value == null) {
      return;
    }

    if (typeof value === 'string') {
      const text = value.trim();
      if (!text || looksLikeStructuredValue(text)) {
        return;
      }

      if (!parentKey || preferredKeySet.has(parentKey)) {
        collected.add(text);
      }
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1, parentKey);
      }
      return;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      visit(child, depth + 1, key);
    }
  };

  visit(payload, 0);
  return Array.from(collected).join(' ').trim();
}

function looksLikeStructuredValue(text: string): boolean {
  return /^[\[{]/.test(text)
    || /^(assistant|user|system|server|client)$/i.test(text)
    || text.length > 240;
}
