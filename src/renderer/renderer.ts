import * as PIXI from 'pixi.js';
import { install as installPixiUnsafeEval } from '@pixi/unsafe-eval';
import { mergeAssistantMessages, shouldContinueAssistantStream } from './assistantMessageStream';
import { getPixiApplicationOptions } from './pixiConfig';
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
import type { TaskRecord } from '../types/tasks';

type Live2DManagerInstance = {
  loadModel(): Promise<void>;
  onTouch(position: PIXI.IPointData): void;
  refitModel(): void;
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
  private dragSession: DragSession | null = null;
  private hoveringWindow = false;
  private activeTask: TaskRecord | null = null;
  private providerAudioSeen = false;
  private pendingAssistantStatusText = '';
  private assistantStatusFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAssistantStatusAt = 0;

  constructor() {
    void this.init();
  }

  async init(): Promise<void> {
    try {
      await this.setupPixi();
      await this.setupLive2D();
      this.setupEvents();
    } catch (error) {
      console.error('Renderer failed to initialize:', error);
      this.showFatalError(error);
    }
  }

  async setupPixi(): Promise<void> {
    const canvas = document.getElementById('live2d-canvas') as HTMLCanvasElement;
    this.app = new PIXI.Application(
      getPixiApplicationOptions(canvas, window.devicePixelRatio),
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
      this.live2d?.refitModel();
    });
    this.app?.ticker.add(() => {
      this.live2d?.setSpeechLevel(this.assistantAudioPlayer.getCurrentLevel());
    });
  }

  private setupWindowChrome(): void {
    const dragButton = document.getElementById('drag-button');
    const menuButton = document.getElementById('menu-button') as HTMLButtonElement | null;
    const menu = document.getElementById('window-menu');
    const menuActions = document.getElementById('window-menu-actions');
    const autoExecuteToggle = document.getElementById('auto-execute-toggle') as HTMLInputElement | null;

    if (!dragButton || !menuButton || !menu || !menuActions) {
      return;
    }

    menuActions.innerHTML = '';
    for (const item of getWindowMenuItems()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'window-menu-item';
      button.dataset.action = item.id;
      button.setAttribute('role', 'menuitem');
      button.textContent = item.label;
      button.addEventListener('click', () => {
        this.handleMenuAction(item.id);
      });
      menuActions.appendChild(button);
    }

    dragButton.addEventListener('pointerdown', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const [windowX, windowY] = await window.electronAPI.windowDrag.getPosition();
      this.dragSession = createDragSession(
        { x: windowX, y: windowY },
        { x: event.screenX, y: event.screenY },
      );
      dragButton.classList.add('dragging');
    });

    window.addEventListener('pointermove', (event) => {
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
      this.dragSession = null;
      dragButton.classList.remove('dragging');
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
      if (event.key === 'Escape') {
        this.setMenuOpen(getNextMenuOpenState(this.menuOpen, 'close'));
      }
    });

    this.syncWindowChrome();
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

  private handleMenuAction(action: WindowMenuActionId): void {
    if (action === 'refit-model') {
      this.live2d?.refitModel();
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

  private async bootstrapAssistant(): Promise<void> {
    let sessionSnapshot: SessionSnapshot;

    try {
      [sessionSnapshot] = await Promise.all([
        window.electronAPI.session.start(),
      ]);
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

    const [tasks, settings] = await Promise.all([
      window.electronAPI.tasks.list(),
      window.electronAPI.settings.get(),
    ]);

    this.syncSessionSnapshot(sessionSnapshot);
    this.syncTaskList(tasks);
    this.syncAutoExecuteSettings(settings);

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
      this.clearPendingAssistantStatus();
      this.syncPrimaryStatus(`你刚刚说：${event.transcript}`, 'result');
      return;
    }

    if (event.type === 'assistant-message') {
      this.queueAssistantStatus(event.text);
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

  private handleTaskUpdate(task: TaskRecord): void {
    const activeTask = task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed'
      ? null
      : task;

    this.activeTask = activeTask ?? (this.activeTask?.id === task.id ? null : this.activeTask);
    this.syncTaskStatus(task);
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
      hovering: this.hoveringWindow,
      menuOpen: this.menuOpen,
    });

    chrome?.classList.toggle('chrome-visible', chromeState.visible);
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

  private syncTaskList(tasks: TaskRecord[]): void {
    const latestTask = tasks.find((task) => task.status === 'queued' || task.status === 'running' || task.status === 'waiting_user')
      ?? tasks[0]
      ?? null;

    if (latestTask) {
      this.activeTask = latestTask;
      this.syncTaskStatus(latestTask);
    }
  }

  private syncTaskStatus(task: TaskRecord | null): void {
    const taskStatus = document.getElementById('task-status');
    if (!taskStatus) {
      return;
    }

    if (!task) {
      taskStatus.textContent = '';
      taskStatus.classList.remove('is-visible');
      delete taskStatus.dataset.tone;
      return;
    }

    taskStatus.textContent = `${task.title}：${task.progressSummary}`;
    taskStatus.dataset.tone = task.status === 'completed'
      ? 'completed'
      : task.status === 'failed'
        ? 'error'
        : task.status === 'cancelled'
          ? 'idle'
          : 'running';
    taskStatus.classList.add('is-visible');
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

  private queueAssistantStatus(text: string): void {
    const now = Date.now();
    if (shouldContinueAssistantStream(this.lastAssistantStatusAt, now, this.pendingAssistantStatusText)) {
      this.pendingAssistantStatusText = mergeAssistantMessages(this.pendingAssistantStatusText, text);
    } else {
      this.pendingAssistantStatusText = text.trim();
    }

    this.lastAssistantStatusAt = now;
    if (this.assistantStatusFlushTimer) {
      clearTimeout(this.assistantStatusFlushTimer);
    }

    this.assistantStatusFlushTimer = setTimeout(() => {
      this.flushAssistantStatus();
    }, 320);
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
