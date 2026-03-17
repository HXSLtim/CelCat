import * as PIXI from 'pixi.js';
import { install as installPixiUnsafeEval } from '@pixi/unsafe-eval';
import { inferAssistantExpressionDetail, type AssistantExpressionInference } from './assistantExpression';
import { mergeAssistantMessages, shouldContinueAssistantStream } from './assistantMessageStream';
import { getPixiApplicationOptions, getViewportSize } from './pixiConfig';
import {
  getNextMenuOpenState,
  getWindowMenuItems,
  type WindowMenuActionId,
} from './windowMenu';
import { getWindowChromeState } from './windowChrome';
import {
  createDragSession,
  getWindowPositionForPointer,
  isValidWindowPosition,
  type DragSession,
} from './windowDrag';
import { VoiceRecognitionController } from './voice/voiceRecognition';
import { PcmAudioPlayer } from './voice/pcmAudioPlayer';
import type { VoiceUiState } from './voice/voiceUi';
import type { SessionEvent, SessionSnapshot } from '../types/session';
import type { UserSettings } from '../types/settings';
import type { WindowStateEvent, WindowStateSnapshot } from '../types/windowState';
import { safeConsoleLog } from '../shared/debugLogger';

const LONG_PRESS_DRAG_DELAY_MS = 260;
const LONG_PRESS_DRAG_MOVE_TOLERANCE_PX = 12;

type Live2DManagerInstance = {
  loadModel(): Promise<void>;
  onTouch(position: PIXI.IPointData): void;
  refitModel(): void;
  playAssistantExpression(expressionName: string | null, options?: { force?: boolean; intensity?: number }): boolean;
  setSpeechLevel(level: number): void;
};

type Live2DModule = {
  Live2DManager: new (app: PIXI.Application) => Live2DManagerInstance;
};

(globalThis as typeof globalThis & { __CELCAT_DEBUG__?: boolean }).__CELCAT_DEBUG__ =
  process.argv.includes('--dev');
(window as typeof window & { PIXI?: typeof PIXI }).PIXI = PIXI;
installPixiUnsafeEval(PIXI as unknown as { ShaderSystem: typeof PIXI.ShaderSystem });

const { Live2DManager } = require('./live2d/live2d') as Live2DModule;

class DesktopCompanion {
  private app: PIXI.Application | null = null;
  private live2d: Live2DManagerInstance | null = null;
  private voiceRecognition: VoiceRecognitionController | null = null;
  private assistantAudioPlayer = new PcmAudioPlayer(window);
  private menuOpen = false;
  private isFullscreen = false;
  private dragSession: DragSession | null = null;
  private hoveringWindow = false;
  private providerAudioSeen = false;
  private pendingAssistantStatusText = '';
  private assistantStatusFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAssistantStatusAt = 0;
  private lastAssistantExpression: AssistantExpressionInference | null = null;
  private lastAssistantExpressionAt = 0;
  private pendingLongPressDrag:
    | {
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
    this.app!.stage.on('pointerdown', (event: PIXI.InteractionEvent) => {
      this.live2d!.onTouch(event.data.global);
    });

    this.setupWindowChrome();
    this.setupVoiceRecognition();
    void this.bootstrapAssistant();
    const appRoot = document.getElementById('app');
    appRoot?.addEventListener('mouseenter', () => {
      this.hoveringWindow = true;
      this.syncWindowChrome();
    });
    appRoot?.addEventListener('mouseleave', () => {
      this.hoveringWindow = false;
      this.syncWindowChrome();
    });
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
    const menuButton = document.getElementById('menu-button') as HTMLButtonElement | null;
    const menu = document.getElementById('window-menu');
    const menuActions = document.getElementById('window-menu-actions');
    const autoExecuteToggle = document.getElementById('auto-execute-toggle') as HTMLInputElement | null;

    if (!appRoot || !menuButton || !menu || !menuActions) {
      return;
    }

    this.renderWindowMenuItems();

    appRoot.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement | null;
      if (event.button !== 0 || !target) {
        return;
      }

      if (target.closest('#window-menu, #menu-button, button, input, label, a')) {
        return;
      }

      this.cancelPendingLongPressDrag();
      this.pendingLongPressDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        timer: setTimeout(() => {
          void this.beginLongPressDrag();
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

      if (!this.dragSession) {
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

    const stopDragging = () => {
      this.cancelPendingLongPressDrag();
      this.dragSession = null;
    };

    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('blur', stopDragging);

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setMenuOpen(getNextMenuOpenState(this.menuOpen, 'toggle'));
    });

    menu.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    autoExecuteToggle?.addEventListener('change', async () => {
      const nextSettings = await window.electronAPI.settings.update({
        autoExecute: autoExecuteToggle.checked,
      });
      this.syncAutoExecuteSettings(nextSettings);
    });

    document.addEventListener('click', () => {
      this.setMenuOpen(getNextMenuOpenState(this.menuOpen, 'close'));
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'F11') {
        event.preventDefault();
        void this.toggleFullscreen();
        return;
      }

      if (event.key === 'Escape') {
        if (this.menuOpen) {
          this.setMenuOpen(getNextMenuOpenState(this.menuOpen, 'close'));
          return;
        }

        if (this.isFullscreen) {
          void this.setFullscreen(false);
        }
      }
    });

    this.syncWindowChrome();
  }

  private async beginLongPressDrag(): Promise<void> {
    if (!this.pendingLongPressDrag || this.dragSession) {
      return;
    }

    const pending = this.pendingLongPressDrag;
    this.pendingLongPressDrag = null;
    const [windowX, windowY] = await window.electronAPI.windowDrag.getPosition();
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

  private async handleMenuAction(action: WindowMenuActionId): Promise<void> {
    if (action === 'refit-model') {
      this.live2d?.refitModel();
    }

    if (action === 'toggle-fullscreen') {
      await this.toggleFullscreen();
    }

    if (action === 'open-control-panel') {
      await window.electronAPI.controlPanel.open();
    }

    if (action === 'close-window') {
      window.close();
      return;
    }

    this.setMenuOpen(false);
  }

  private setMenuOpen(nextOpen: boolean): void {
    this.menuOpen = nextOpen;

    const menu = document.getElementById('window-menu');
    const menuButton = document.getElementById('menu-button') as HTMLButtonElement | null;

    menu?.classList.toggle('hidden', !nextOpen);
    menu?.setAttribute('aria-hidden', String(!nextOpen));
    menuButton?.setAttribute('aria-expanded', String(nextOpen));
    this.syncWindowChrome();
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
      this.syncSessionSnapshot(sessionSnapshot);
    }

    const settings = await window.electronAPI.settings.get();

    this.syncSessionSnapshot(sessionSnapshot);
    this.syncAutoExecuteSettings(settings);

    window.electronAPI.session.onEvent((event) => {
      this.handleSessionEvent(event);
    });
  }

  private handleSessionEvent(event: SessionEvent): void {
    if (event.type === 'session-state') {
      this.syncSessionSnapshot(event.snapshot);
      return;
    }

    if (event.type === 'transcript') {
      this.clearPendingAssistantStatus();
      this.syncPrimaryStatus(`你刚刚说：${event.transcript}`, 'result');
      return;
    }

    if (event.type === 'assistant-message') {
      this.queueAssistantStatus(event.text, event.isFinal !== false);
      return;
    }

    if (event.type === 'assistant-audio') {
      this.providerAudioSeen = true;
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
      this.syncPrimaryStatus(event.message, 'error');
    }
  }

  private syncSessionSnapshot(snapshot: SessionSnapshot): void {
    if (snapshot.status === 'listening' && !snapshot.lastAssistantMessage && !snapshot.error) {
      this.syncPrimaryStatus('我在听，也可以直接交给我一个后台任务。', 'idle');
      return;
    }

    if (snapshot.status === 'processing') {
      this.clearPendingAssistantStatus();
      this.syncPrimaryStatus('我在整理你刚刚说的话。', 'processing');
      return;
    }

    if (snapshot.status === 'error') {
      this.clearPendingAssistantStatus();
      this.syncPrimaryStatus(snapshot.error || '会话出了点问题。', 'error');
    }
  }

  private syncWindowChrome(): void {
    const chrome = document.getElementById('window-chrome');
    const chromeState = getWindowChromeState({
      hovering: this.hoveringWindow || this.isFullscreen,
      menuOpen: this.menuOpen,
    });

    chrome?.classList.toggle('chrome-visible', chromeState.visible);
  }

  private renderWindowMenuItems(): void {
    const menuActions = document.getElementById('window-menu-actions');
    if (!menuActions) {
      return;
    }

    menuActions.innerHTML = '';
    for (const item of getWindowMenuItems({ isFullscreen: this.isFullscreen })) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'window-menu-item';
      button.dataset.action = item.id;
      button.setAttribute('role', 'menuitem');
      button.textContent = item.label;
      button.addEventListener('click', () => {
        void this.handleMenuAction(item.id);
      });
      menuActions.appendChild(button);
    }
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
    this.renderWindowMenuItems();
    this.syncWindowChrome();
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
    if (state.statusTone !== 'error' || !state.showStatus) {
      return;
    }

    this.clearPendingAssistantStatus();
    this.syncPrimaryStatus(state.statusText, 'error', true);
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

  private syncAutoExecuteSettings(settings: UserSettings): void {
    const autoExecuteToggle = document.getElementById('auto-execute-toggle') as HTMLInputElement | null;
    const autoExecuteHint = document.getElementById('auto-execute-hint');

    if (autoExecuteToggle) {
      autoExecuteToggle.checked = settings.autoExecute;
    }

    if (autoExecuteHint) {
      autoExecuteHint.textContent = settings.autoExecute
        ? '当前会自动执行中低风险任务。'
        : '当前会先确认中高风险任务。';
    }
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
    this.syncPrimaryStatus(text, 'speaking');
    if (!this.providerAudioSeen) {
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
