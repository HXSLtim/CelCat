import * as PIXI from 'pixi.js';
import { install as installPixiUnsafeEval } from '@pixi/unsafe-eval';
import { inferAssistantExpressionDetail, type AssistantExpressionInference } from './assistantExpression';
import { mergeAssistantMessages, shouldContinueAssistantStream } from './assistantMessageStream';
import { getPixiApplicationOptions, getViewportSize } from './pixiConfig';
import {
  createDragSession,
  getWindowPositionForPointer,
  isValidWindowPosition,
  type DragSession,
} from './windowDrag';
import { VoiceRecognitionController } from './voice/voiceRecognition';
import { PcmAudioPlayer } from './voice/pcmAudioPlayer';
import type { VoiceUiState } from './voice/voiceUi';
import { selectCompanionStatus, selectRelevantTask } from './status/companionStatus';
import { Live2DManager } from './live2d/live2d';
import type { SessionEvent, SessionSnapshot } from '../types/session';
import type { TaskRecord } from '../types/tasks';
import type { WindowStateEvent, WindowStateSnapshot } from '../types/windowState';
import { safeConsoleLog } from '../shared/debugLogger';

const LONG_PRESS_DRAG_DELAY_MS = 260;
const LONG_PRESS_DRAG_MOVE_TOLERANCE_PX = 12;

type Live2DManagerInstance = Live2DManager;

(globalThis as typeof globalThis & { __CELCAT_DEBUG__?: boolean }).__CELCAT_DEBUG__ =
  Boolean(window.electronAPI.runtime.isDev);
(window as typeof window & { PIXI?: typeof PIXI }).PIXI = PIXI;
installPixiUnsafeEval(PIXI as unknown as { ShaderSystem: typeof PIXI.ShaderSystem });

class DesktopCompanion {
  private app: PIXI.Application | null = null;
  private live2d: Live2DManagerInstance | null = null;
  private voiceRecognition: VoiceRecognitionController | null = null;
  private assistantAudioPlayer = new PcmAudioPlayer(window);
  private isFullscreen = false;
  private sessionSnapshot: SessionSnapshot | null = null;
  private voiceUiState: VoiceUiState | null = null;
  private trackedTasks: TaskRecord[] = [];
  private currentTask: TaskRecord | null = null;
  private dragSession: DragSession | null = null;
  private activeDragPointerId: number | null = null;
  private providerAudioSeenForCurrentTurn = false;
  private assistantSpeakingText = '';
  private pendingAssistantStatusText = '';
  private assistantStatusFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private statusOverrideTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAssistantStatusAt = 0;
  private lastAssistantExpression: AssistantExpressionInference | null = null;
  private lastAssistantExpressionAt = 0;
  private nextLongPressGestureId = 0;
  private activatingLongPressGesture:
    | {
        gestureId: number;
        pointerId: number;
      }
    | null = null;
  private cancelledLongPressGestureIds = new Set<number>();
  private suppressedTapPointerIds = new Set<number>();
  private suppressedTapCleanupTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private pendingLongPressDrag:
    | {
        gestureId: number;
        pointerId: number;
        startX: number;
        startY: number;
        screenX: number;
        screenY: number;
        timer: ReturnType<typeof setTimeout>;
      }
    | null = null;

  constructor() {
    void this.init();
  }

  async init(): Promise<void> {
    try {
      await this.setupPixi();
      await this.setupLive2D();
      this.setupEvents();
      await this.bootstrapWindowState();
    } catch (error) {
      console.error('Renderer failed to initialize:', error);
      this.showFatalError(error);
    }
  }

  async setupPixi(): Promise<void> {
    const canvas = document.getElementById('live2d-canvas') as HTMLCanvasElement;
    this.app = new PIXI.Application(
      getPixiApplicationOptions(canvas, window.devicePixelRatio, window),
    );
  }

  async setupLive2D(): Promise<void> {
    this.live2d = new Live2DManager(this.app!);
    await this.live2d.loadModel();
  }

  setupEvents(): void {
    this.app!.stage.interactive = true;
    this.app!.stage.hitArea = this.app!.screen;
    this.app!.stage.on('pointertap', (event: PIXI.InteractionEvent) => {
      const pointerId = this.getInteractionPointerId(event);
      if (pointerId !== null && this.suppressedTapPointerIds.has(pointerId)) {
        this.releaseSuppressedTapPointer(pointerId);
        return;
      }

      this.live2d!.onTouch(event.data.global);
    });

    this.setupWindowChrome();
    this.setupVoiceRecognition();
    void this.bootstrapAssistant();
    window.addEventListener('resize', () => {
      this.resizePixiViewport();
      this.live2d?.refitModel();
    });
    this.app?.ticker.add(() => {
      this.live2d?.setSpeechLevel(this.assistantAudioPlayer.getCurrentLevel());
    });
  }

  private setupWindowChrome(): void {
    const appRoot = document.getElementById('app');
    if (!appRoot) {
      return;
    }

    appRoot.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement | null;
      if (event.button !== 0 || !target) {
        return;
      }

      if (target.closest('button, input, label, a')) {
        return;
      }

      this.cancelPendingLongPressDrag();
      this.pendingLongPressDrag = {
        gestureId: ++this.nextLongPressGestureId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        timer: setTimeout(() => {
          if (!this.pendingLongPressDrag) {
            return;
          }

          void this.beginLongPressDrag(this.pendingLongPressDrag.gestureId);
        }, LONG_PRESS_DRAG_DELAY_MS),
      };
    });

    window.addEventListener('pointermove', (event) => {
      if (
        this.pendingLongPressDrag
        && event.pointerId === this.pendingLongPressDrag.pointerId
        && !this.dragSession
      ) {
        const deltaX = event.clientX - this.pendingLongPressDrag.startX;
        const deltaY = event.clientY - this.pendingLongPressDrag.startY;
        if (Math.hypot(deltaX, deltaY) > LONG_PRESS_DRAG_MOVE_TOLERANCE_PX) {
          this.cancelPendingLongPressDrag();
        } else {
          this.pendingLongPressDrag.screenX = event.screenX;
          this.pendingLongPressDrag.screenY = event.screenY;
        }
      }

      if (!this.dragSession || (this.activeDragPointerId !== null && event.pointerId !== this.activeDragPointerId)) {
        return;
      }

      const nextPosition = getWindowPositionForPointer(this.dragSession, {
        x: event.screenX,
        y: event.screenY,
      });
      if (!isValidWindowPosition(nextPosition)) {
        return;
      }
      window.electronAPI.windowDrag.setPosition(nextPosition.x, nextPosition.y);
    });

    const stopDragging = (event?: PointerEvent) => {
      if (event && this.pendingLongPressDrag && event.pointerId !== this.pendingLongPressDrag.pointerId) {
        return;
      }

      if (
        event
        && this.activatingLongPressGesture
        && event.pointerId === this.activatingLongPressGesture.pointerId
      ) {
        this.cancelledLongPressGestureIds.add(this.activatingLongPressGesture.gestureId);
      }

      if (!event || this.activeDragPointerId === null || event.pointerId === this.activeDragPointerId) {
        this.dragSession = null;
        this.activeDragPointerId = null;
      }

      this.cancelPendingLongPressDrag();
    };

    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
    window.addEventListener('blur', () => {
      if (this.activatingLongPressGesture) {
        this.cancelledLongPressGestureIds.add(this.activatingLongPressGesture.gestureId);
      }
      this.cancelPendingLongPressDrag();
      this.dragSession = null;
      this.activeDragPointerId = null;
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'F11') {
        event.preventDefault();
        void this.toggleFullscreen();
        return;
      }

      if (event.key === 'Escape') {
        if (this.isFullscreen) {
          void this.setFullscreen(false);
        }
      }
    });
  }

  private async beginLongPressDrag(gestureId: number): Promise<void> {
    if (!this.pendingLongPressDrag || this.dragSession || this.pendingLongPressDrag.gestureId !== gestureId) {
      return;
    }

    const pending = this.pendingLongPressDrag;
    this.pendingLongPressDrag = null;
    this.activatingLongPressGesture = {
      gestureId,
      pointerId: pending.pointerId,
    };
    const [windowX, windowY] = await window.electronAPI.windowDrag.getPosition();
    this.activatingLongPressGesture = null;
    if (this.cancelledLongPressGestureIds.has(gestureId)) {
      this.cancelledLongPressGestureIds.delete(gestureId);
      return;
    }

    this.activeDragPointerId = pending.pointerId;
    this.suppressNextTapForPointer(pending.pointerId);
    this.dragSession = createDragSession(
      { x: windowX, y: windowY },
      { x: pending.screenX, y: pending.screenY },
    );
  }

  private cancelPendingLongPressDrag(): void {
    if (!this.pendingLongPressDrag) {
      return;
    }

    clearTimeout(this.pendingLongPressDrag.timer);
    this.pendingLongPressDrag = null;
  }

  private getInteractionPointerId(event: PIXI.InteractionEvent): number | null {
    const interactionData = event.data as PIXI.InteractionData & {
      pointerId?: number;
      originalEvent?: PointerEvent;
    };

    return interactionData.pointerId
      ?? interactionData.originalEvent?.pointerId
      ?? null;
  }

  private suppressNextTapForPointer(pointerId: number): void {
    const existingTimer = this.suppressedTapCleanupTimers.get(pointerId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.suppressedTapPointerIds.add(pointerId);
    const timer = setTimeout(() => {
      this.releaseSuppressedTapPointer(pointerId);
    }, 600);
    this.suppressedTapCleanupTimers.set(pointerId, timer);
  }

  private releaseSuppressedTapPointer(pointerId: number): void {
    const existingTimer = this.suppressedTapCleanupTimers.get(pointerId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.suppressedTapCleanupTimers.delete(pointerId);
    }

    this.suppressedTapPointerIds.delete(pointerId);
  }

  private async bootstrapWindowState(): Promise<void> {
    const snapshot = await window.electronAPI.windowState.get();
    this.syncWindowState(snapshot);
    window.electronAPI.windowState.onChange((event) => {
      this.handleWindowStateEvent(event);
    });
  }

  private setupVoiceRecognition(): void {
    this.voiceRecognition = new VoiceRecognitionController(
      window,
      {
        onStateChange: (state) => {
          this.syncVoiceUi(state);
        },
      },
    );
  }

  private handleWindowStateEvent(event: WindowStateEvent): void {
    if (event.type === 'fullscreen-changed') {
      this.syncWindowState(event.snapshot);
    }
  }

  private async bootstrapAssistant(): Promise<void> {
    let sessionSnapshot: SessionSnapshot;

    try {
      sessionSnapshot = await window.electronAPI.session.start();
    } catch (error: any) {
      console.error('Session failed to start:', error);
      sessionSnapshot = {
        status: 'error',
        connected: false,
        lastTranscript: '',
        lastAssistantMessage: '',
        activeTaskId: null,
        error: error?.message || '实时语音会话启动失败',
      };
    }

    const tasks = await window.electronAPI.tasks.list().catch(() => [] as TaskRecord[]);

    this.trackedTasks = tasks;
    this.syncSessionSnapshot(sessionSnapshot);
    this.syncTrackedTask();

    window.electronAPI.session.onEvent((event) => {
      this.handleSessionEvent(event);
    });
    window.electronAPI.tasks.onUpdate((task) => {
      this.handleTaskUpdate(task);
    });
  }

  private handleSessionEvent(event: SessionEvent): void {
    if (event.type === 'session-state') {
      this.syncSessionSnapshot(event.snapshot);
      return;
    }

    if (event.type === 'transcript') {
      this.providerAudioSeenForCurrentTurn = false;
      this.clearPendingAssistantStatus();
      this.assistantSpeakingText = '';
      this.showStatusOverride(`你刚刚说：${event.transcript}`, 'result');
      return;
    }

    if (event.type === 'assistant-message') {
      this.queueAssistantStatus(event.text, event.isFinal !== false);
      return;
    }

    if (event.type === 'assistant-audio') {
      this.providerAudioSeenForCurrentTurn = true;
      window.speechSynthesis?.cancel?.();
      void this.assistantAudioPlayer.play({
        pcmBase64: event.pcmBase64,
        sampleRate: event.sampleRate,
        channels: event.channels,
        format: event.format,
      });
      return;
    }

    if (event.type === 'error') {
      this.clearPendingAssistantStatus();
      this.assistantSpeakingText = '';
      if (this.statusOverrideTimer) {
        clearTimeout(this.statusOverrideTimer);
        this.statusOverrideTimer = null;
      }
      this.renderDerivedStatus();
    }
  }

  private syncSessionSnapshot(snapshot: SessionSnapshot): void {
    this.sessionSnapshot = snapshot;
    this.syncTrackedTask();
    this.renderDerivedStatus();
  }

  private async toggleFullscreen(): Promise<void> {
    const snapshot = await window.electronAPI.windowState.toggleFullscreen();
    this.syncWindowState(snapshot);
  }

  private async setFullscreen(nextIsFullscreen: boolean): Promise<void> {
    const snapshot = await window.electronAPI.windowState.setFullscreen(nextIsFullscreen);
    this.syncWindowState(snapshot);
  }

  private syncWindowState(snapshot: WindowStateSnapshot): void {
    this.isFullscreen = snapshot.isFullscreen;
    document.body.classList.toggle('is-fullscreen', snapshot.isFullscreen);
    requestAnimationFrame(() => {
      this.resizePixiViewport();
      this.live2d?.refitModel();
    });
  }

  private resizePixiViewport(): void {
    if (!this.app) {
      return;
    }

    const viewport = getViewportSize(window);
    this.app.renderer.resize(viewport.width, viewport.height);
    this.app.stage.hitArea = this.app.screen;
  }

  private syncVoiceUi(state: VoiceUiState): void {
    this.voiceUiState = state;
    this.renderDerivedStatus();
  }

  private syncPrimaryStatus(
    text: string,
    tone: 'idle' | 'processing' | 'speaking' | 'result' | 'error',
    visible = Boolean(text),
  ): void {
    const assistantStatus = document.getElementById('assistant-status');
    if (!assistantStatus) {
      return;
    }

    assistantStatus.textContent = text;
    assistantStatus.dataset.tone = tone;
    assistantStatus.classList.toggle('is-visible', visible);
  }

  private speakAssistantMessage(text: string): void {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  private queueAssistantStatus(text: string, isFinal = true): void {
    const now = Date.now();
    if (shouldContinueAssistantStream(this.lastAssistantStatusAt, now, this.pendingAssistantStatusText)) {
      this.pendingAssistantStatusText = mergeAssistantMessages(this.pendingAssistantStatusText, text);
    } else {
      this.pendingAssistantStatusText = text.trim();
    }

    this.lastAssistantStatusAt = now;
    this.applyAssistantExpression(this.pendingAssistantStatusText, isFinal);
    if (this.assistantStatusFlushTimer) {
      clearTimeout(this.assistantStatusFlushTimer);
    }

    if (isFinal) {
      this.flushAssistantStatus();
      return;
    }

    this.assistantStatusFlushTimer = setTimeout(() => {
      this.flushAssistantStatus();
    }, 180);
  }

  private flushAssistantStatus(): void {
    if (!this.pendingAssistantStatusText) {
      this.assistantStatusFlushTimer = null;
      return;
    }

    const text = this.pendingAssistantStatusText;
    this.pendingAssistantStatusText = '';
    this.assistantStatusFlushTimer = null;
    this.assistantSpeakingText = text;
    this.renderDerivedStatus();
    if (!this.providerAudioSeenForCurrentTurn) {
      this.speakAssistantMessage(text);
    }
  }

  private clearPendingAssistantStatus(): void {
    if (this.assistantStatusFlushTimer) {
      clearTimeout(this.assistantStatusFlushTimer);
      this.assistantStatusFlushTimer = null;
    }
    this.pendingAssistantStatusText = '';
    this.lastAssistantExpression = null;
    this.lastAssistantExpressionAt = 0;
  }

  private handleTaskUpdate(task: TaskRecord): void {
    const nextTasks = this.trackedTasks.filter((candidate) => candidate.id !== task.id);
    nextTasks.push(task);
    this.trackedTasks = nextTasks;
    this.syncTrackedTask();
    this.renderDerivedStatus();
  }

  private syncTrackedTask(): void {
    this.currentTask = selectRelevantTask(
      this.trackedTasks,
      this.sessionSnapshot?.activeTaskId ?? null,
    );
  }

  private showStatusOverride(
    text: string,
    tone: 'idle' | 'processing' | 'speaking' | 'result' | 'error',
    durationMs = 1400,
  ): void {
    if (this.statusOverrideTimer) {
      clearTimeout(this.statusOverrideTimer);
    }

    this.syncPrimaryStatus(text, tone);
    this.statusOverrideTimer = setTimeout(() => {
      this.statusOverrideTimer = null;
      this.renderDerivedStatus();
    }, durationMs);
  }

  private renderDerivedStatus(): void {
    if (this.pendingAssistantStatusText) {
      return;
    }

    const status = selectCompanionStatus({
      sessionSnapshot: this.sessionSnapshot,
      voiceUiState: this.voiceUiState,
      task: this.currentTask,
      assistantSpeakingText: this.assistantSpeakingText,
    });

    if (
      this.statusOverrideTimer
      && status.key !== 'error'
      && status.key !== 'waiting_user'
      && status.key !== 'delegated'
    ) {
      return;
    }

    this.syncPrimaryStatus(status.text, status.tone, status.visible);
  }

  private applyAssistantExpression(text: string, isFinal: boolean): void {
    const inference = inferAssistantExpressionDetail(text);
    if (!inference) {
      return;
    }

    const now = Date.now();
    const shouldApply = this.shouldApplyAssistantExpression(inference, now, isFinal);
    if (!shouldApply) {
      return;
    }

    const applied = this.live2d?.playAssistantExpression(inference.name, {
      force: isFinal,
      intensity: Math.max(0.45, Math.min(1, inference.confidence + 0.12)),
    });
    if (!applied) {
      return;
    }

    this.lastAssistantExpression = inference;
    this.lastAssistantExpressionAt = now;
    safeConsoleLog(
      `[celcat:emotion] assistant expression ${JSON.stringify({
        expression: inference.name,
        confidence: Number(inference.confidence.toFixed(2)),
        score: Number(inference.score.toFixed(2)),
        phase: isFinal ? 'final' : 'stream',
        cues: inference.matchedCues,
        text,
      })}`,
    );
  }

  private shouldApplyAssistantExpression(
    nextInference: AssistantExpressionInference,
    now: number,
    isFinal: boolean,
  ): boolean {
    if (isFinal || !this.lastAssistantExpression) {
      return true;
    }

    if (nextInference.name === this.lastAssistantExpression.name) {
      return now - this.lastAssistantExpressionAt > 1200 && nextInference.confidence >= 0.72;
    }

    if (nextInference.confidence < 0.52) {
      return false;
    }

    if (now - this.lastAssistantExpressionAt < 360) {
      return false;
    }

    return nextInference.confidence >= this.lastAssistantExpression.confidence + 0.12
      || nextInference.score >= this.lastAssistantExpression.score + 1;
  }

  private showFatalError(error: unknown): void {
    const errorMessage = document.createElement('div');
    errorMessage.id = 'fatal-error';
    errorMessage.textContent = `Renderer failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    errorMessage.setAttribute(
      'style',
      'position:absolute;left:12px;right:12px;bottom:12px;padding:10px 12px;border-radius:12px;background:rgba(20,24,34,0.88);color:#fff;font:12px/1.4 sans-serif;-webkit-app-region:no-drag;',
    );
    document.body.appendChild(errorMessage);
  }
}

new DesktopCompanion();
