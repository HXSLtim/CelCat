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
import type { AgentCapabilityCatalogEntry, AgentWorkspaceArtifact, AgentWorkspaceCapability, AgentWorkspaceMemoryRef, AgentWorkspaceStep, TaskRecord } from '../types/tasks';
import type { WindowStateEvent, WindowStateSnapshot } from '../types/windowState';
import { safeConsoleLog } from '../shared/debugLogger';

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
  private activeTask: TaskRecord | null = null;
  private workspaceTask: TaskRecord | null = null;
  private providerAudioSeen = false;
  private discoveredCapabilities: AgentCapabilityCatalogEntry[] = [];
  private pendingAssistantStatusText = '';
  private assistantStatusFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAssistantStatusAt = 0;
  private lastAssistantExpression: AssistantExpressionInference | null = null;
  private lastAssistantExpressionAt = 0;

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
    const dragButton = document.getElementById('drag-button');
    const menuButton = document.getElementById('menu-button') as HTMLButtonElement | null;
    const menu = document.getElementById('window-menu');
    const menuActions = document.getElementById('window-menu-actions');
    const autoExecuteToggle = document.getElementById('auto-execute-toggle') as HTMLInputElement | null;

    if (!dragButton || !menuButton || !menu || !menuActions) {
      return;
    }

    this.renderWindowMenuItems();

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

    const [tasks, discoveredCapabilities, settings] = await Promise.all([
      window.electronAPI.tasks.list(),
      window.electronAPI.agentCapabilities.list(),
      window.electronAPI.settings.get(),
    ]);

    this.syncSessionSnapshot(sessionSnapshot);
    this.syncTaskList(tasks);
    this.discoveredCapabilities = discoveredCapabilities;
    this.syncAutoExecuteSettings(settings);
    this.syncWorkspace(this.workspaceTask);

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

  private handleTaskUpdate(task: TaskRecord): void {
    const activeTask = task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed'
      ? null
      : task;

    this.activeTask = activeTask ?? (this.activeTask?.id === task.id ? null : this.activeTask);
    this.workspaceTask = task;
    this.syncTaskStatus(task);
    this.syncWorkspace(task);
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

  private syncTaskList(tasks: TaskRecord[]): void {
    const latestTask = tasks.find((task) => task.status === 'queued' || task.status === 'running' || task.status === 'waiting_user')
      ?? tasks[0]
      ?? null;

    if (latestTask) {
      this.activeTask = latestTask;
      this.workspaceTask = latestTask;
      this.syncTaskStatus(latestTask);
      this.syncWorkspace(latestTask);
      return;
    }

    this.workspaceTask = null;
    this.syncWorkspace(null);
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

  private syncWorkspace(task: TaskRecord | null): void {
    const workspacePanel = document.getElementById('workspace-panel');
    const workspaceTitle = document.getElementById('workspace-title');
    const workspaceModeBadge = document.getElementById('workspace-mode-badge');
    const workspaceSummary = document.getElementById('workspace-summary');
    const workspaceMission = document.getElementById('workspace-mission');
    const workspaceSkills = document.getElementById('workspace-skills');
    const workspaceMcps = document.getElementById('workspace-mcps');
    const workspaceCapabilityCatalog = document.getElementById('workspace-capability-catalog');
    const workspaceSteps = document.getElementById('workspace-steps');
    const workspaceArtifacts = document.getElementById('workspace-artifacts');
    const workspaceContext = document.getElementById('workspace-context');
    const workspaceMemory = document.getElementById('workspace-memory');
    const workspaceNotes = document.getElementById('workspace-notes');
    const workspaceResult = document.getElementById('workspace-result');
    const workspaceActions = document.getElementById('workspace-actions');
    const workspaceApproveButton = document.getElementById('workspace-approve-button') as HTMLButtonElement | null;

    if (
      !workspacePanel
      || !workspaceTitle
      || !workspaceModeBadge
      || !workspaceSummary
      || !workspaceMission
      || !workspaceSkills
      || !workspaceMcps
      || !workspaceCapabilityCatalog
      || !workspaceSteps
      || !workspaceArtifacts
      || !workspaceContext
      || !workspaceMemory
      || !workspaceNotes
      || !workspaceResult
      || !workspaceActions
    ) {
      return;
    }

    if (!task?.workspace) {
      workspacePanel.classList.remove('is-visible');
      workspaceTitle.textContent = '等待任务';
      workspaceModeBadge.textContent = '空闲';
      workspaceSummary.textContent = '当你交给我一个后台任务时，这里会显示 agent 的执行工作区、步骤、技能和 MCP 能力。';
      workspaceMission.textContent = '暂无任务目标';
      workspaceResult.textContent = '任务完成后，这里会显示整理好的结果摘要。';
      this.renderWorkspaceCapabilities(workspaceSkills, []);
      this.renderWorkspaceCapabilities(workspaceMcps, []);
      this.renderCapabilityCatalog(workspaceCapabilityCatalog, this.discoveredCapabilities);
      this.renderWorkspaceSteps(workspaceSteps, []);
      this.renderWorkspaceArtifacts(workspaceArtifacts, []);
      workspaceContext.textContent = '任务执行过程中，这里会生成压缩上下文。';
      this.renderWorkspaceMemory(workspaceMemory, []);
      this.renderWorkspaceNotes(workspaceNotes, []);
      workspaceActions.classList.remove('is-visible');
      return;
    }

    workspacePanel.classList.add('is-visible');
    workspaceTitle.textContent = task.title;
    workspaceModeBadge.textContent = this.getWorkspaceModeLabel(task);
    workspaceSummary.textContent = task.workspace.summary;
    workspaceMission.textContent = task.workspace.mission;
    workspaceResult.textContent = this.formatWorkspaceResult(task);
    this.renderWorkspaceCapabilities(workspaceSkills, task.workspace.skills);
    this.renderWorkspaceCapabilities(workspaceMcps, task.workspace.mcps);
    this.renderCapabilityCatalog(workspaceCapabilityCatalog, this.discoveredCapabilities, task.workspace);
    this.renderWorkspaceSteps(workspaceSteps, task.workspace.steps, task.workspace);
    this.renderWorkspaceArtifacts(workspaceArtifacts, task.workspace.artifacts);
    workspaceContext.textContent = task.workspace.compressedContext || '当前还没有生成压缩上下文。';
    this.renderWorkspaceMemory(workspaceMemory, task.workspace.memoryRefs);
    this.renderWorkspaceNotes(workspaceNotes, task.workspace.notes);

    const shouldShowApprove = task.status === 'waiting_user';
    workspaceActions.classList.toggle('is-visible', shouldShowApprove);
    if (workspaceApproveButton) {
      workspaceApproveButton.disabled = !shouldShowApprove;
      workspaceApproveButton.onclick = shouldShowApprove
        ? async () => {
          workspaceApproveButton.disabled = true;
          await window.electronAPI.tasks.approve(task.id);
        }
        : null;
    }
  }

  private renderWorkspaceCapabilities(
    container: HTMLElement,
    capabilities: AgentWorkspaceCapability[],
  ): void {
    container.innerHTML = '';
    if (!capabilities.length) {
      container.appendChild(this.createWorkspaceEmpty('当前没有选中的能力。'));
      return;
    }

    for (const capability of capabilities) {
      const item = document.createElement('div');
      item.className = 'workspace-chip';
      if (capability.source) {
        item.dataset.source = capability.source;
      }

      const label = document.createElement('span');
      label.className = 'workspace-chip-label';
      label.textContent = capability.label;

      const reason = document.createElement('span');
      reason.className = 'workspace-chip-reason';
      reason.textContent = capability.reason;

      if (capability.source) {
        const meta = document.createElement('span');
        meta.className = 'workspace-chip-meta';
        meta.textContent = this.getCapabilitySourceLabel(capability.source);
        item.append(label, meta, reason);
      } else {
        item.append(label, reason);
      }
      container.appendChild(item);
    }
  }

  private renderCapabilityCatalog(
    container: HTMLElement,
    capabilities: AgentCapabilityCatalogEntry[],
    workspace?: TaskRecord['workspace'],
  ): void {
    container.innerHTML = '';
    if (!capabilities.length) {
      container.appendChild(this.createWorkspaceEmpty('当前还没有发现可用的 skill 或 MCP。'));
      return;
    }

    const prioritized = [...capabilities].sort((left, right) => {
      const leftSelected = this.isCapabilitySelected(workspace, left.id) ? 1 : 0;
      const rightSelected = this.isCapabilitySelected(workspace, right.id) ? 1 : 0;
      if (leftSelected !== rightSelected) {
        return rightSelected - leftSelected;
      }
      return left.label.localeCompare(right.label);
    }).slice(0, 8);

    for (const capability of prioritized) {
      const item = document.createElement('div');
      item.className = 'workspace-chip';
      item.dataset.source = capability.source;

      const label = document.createElement('span');
      label.className = 'workspace-chip-label';
      label.textContent = capability.label;

      const meta = document.createElement('span');
      meta.className = 'workspace-chip-meta';
      meta.textContent = this.isCapabilitySelected(workspace, capability.id)
        ? `已选中 · ${this.getCapabilitySourceLabel(capability.source)}`
        : this.getCapabilitySourceLabel(capability.source);

      const reason = document.createElement('span');
      reason.className = 'workspace-chip-reason';
      reason.textContent = capability.description || capability.defaultReason;

      item.append(label, meta, reason);
      container.appendChild(item);
    }
  }

  private renderWorkspaceSteps(
    container: HTMLElement,
    steps: AgentWorkspaceStep[],
    workspace?: TaskRecord['workspace'],
  ): void {
    container.innerHTML = '';
    if (!steps.length) {
      container.appendChild(this.createWorkspaceEmpty('计划生成后，这里会出现步骤列表。'));
      return;
    }

    for (const step of steps) {
      const item = document.createElement('div');
      item.className = 'workspace-step';
      item.dataset.status = step.status;

      const head = document.createElement('div');
      head.className = 'workspace-step-head';

      const title = document.createElement('span');
      title.className = 'workspace-step-title';
      title.textContent = step.title;

      const status = document.createElement('span');
      status.className = 'workspace-step-status';
      status.textContent = this.getWorkspaceStepStatusLabel(step.status);

      head.append(title, status);

      const summary = document.createElement('div');
      summary.className = 'workspace-step-summary';
      summary.textContent = step.summary;

      item.append(head, summary);

      if (step.capabilityId) {
        const capability = document.createElement('div');
        capability.className = 'workspace-step-capability';
        const capabilityLabel = this.getWorkspaceCapabilityLabel(workspace, step.capabilityId, step.capabilityType);
        capability.textContent = `${step.capabilityType === 'mcp' ? 'MCP' : 'Skill'}: ${capabilityLabel}`;
        item.appendChild(capability);
      }

      container.appendChild(item);
    }
  }

  private getWorkspaceCapabilityLabel(
    workspace: TaskRecord['workspace'] | undefined,
    capabilityId: string,
    capabilityType?: AgentWorkspaceStep['capabilityType'],
  ): string {
    if (!workspace) {
      return capabilityId;
    }

    const candidates = capabilityType === 'mcp'
      ? workspace.mcps
      : capabilityType === 'skill'
        ? workspace.skills
        : [...workspace.skills, ...workspace.mcps];

    return candidates.find((capability) => capability.id === capabilityId)?.label || capabilityId;
  }

  private isCapabilitySelected(
    workspace: TaskRecord['workspace'] | undefined,
    capabilityId: string,
  ): boolean {
    if (!workspace) {
      return false;
    }

    return [...workspace.skills, ...workspace.mcps].some((capability) => capability.id === capabilityId);
  }

  private getCapabilitySourceLabel(source: AgentCapabilityCatalogEntry['source']): string {
    if (source === 'skill') {
      return 'Skill';
    }
    if (source === 'mcp') {
      return 'External MCP';
    }
    return 'Builtin';
  }

  private renderWorkspaceNotes(
    container: HTMLElement,
    notes: string[],
  ): void {
    container.innerHTML = '';
    if (!notes.length) {
      container.appendChild(this.createWorkspaceEmpty('当前没有额外备注。'));
      return;
    }

    for (const note of notes) {
      const item = document.createElement('div');
      item.className = 'workspace-note';
      item.textContent = note;
      container.appendChild(item);
    }
  }

  private formatWorkspaceResult(task: TaskRecord): string {
    if (task.resultSummary) {
      return task.resultSummary;
    }

    const outcome = task.workspace?.outcome;
    if (!outcome) {
      return '任务仍在推进中，完成后会在这里沉淀结果。';
    }

    const lines = [
      outcome.summary,
      outcome.blockers.length ? `阻塞：${outcome.blockers.join('；')}` : '',
      outcome.nextActions.length ? `下一步：${outcome.nextActions.join('；')}` : '',
    ].filter(Boolean);

    return lines.join('\n');
  }

  private renderWorkspaceArtifacts(
    container: HTMLElement,
    artifacts: AgentWorkspaceArtifact[],
  ): void {
    container.innerHTML = '';
    if (!artifacts.length) {
      container.appendChild(this.createWorkspaceEmpty('能力执行后，这里会展示工作区产物和命令输出。'));
      return;
    }

    for (const artifact of artifacts) {
      const item = document.createElement('div');
      item.className = 'workspace-artifact';
      item.dataset.tone = artifact.tone;

      const label = document.createElement('div');
      label.className = 'workspace-artifact-label';
      label.textContent = artifact.label;

      const content = document.createElement('div');
      content.className = 'workspace-artifact-content';
      content.textContent = artifact.content;

      item.append(label, content);
      container.appendChild(item);
    }
  }

  private renderWorkspaceMemory(
    container: HTMLElement,
    memoryRefs: AgentWorkspaceMemoryRef[],
  ): void {
    container.innerHTML = '';
    if (!memoryRefs.length) {
      container.appendChild(this.createWorkspaceEmpty('完成任务后，这里会记录长期记忆和任务记忆文档。'));
      return;
    }

    for (const memoryRef of memoryRefs) {
      const item = document.createElement('div');
      item.className = 'workspace-memory-item';

      const label = document.createElement('div');
      label.className = 'workspace-memory-label';
      label.textContent = memoryRef.label;

      const summary = document.createElement('div');
      summary.className = 'workspace-memory-summary';
      summary.textContent = memoryRef.summary;

      const location = document.createElement('div');
      location.className = 'workspace-memory-path';
      location.textContent = memoryRef.path;

      item.append(label, summary, location);
      container.appendChild(item);
    }
  }

  private createWorkspaceEmpty(text: string): HTMLElement {
    const item = document.createElement('div');
    item.className = 'workspace-empty';
    item.textContent = text;
    return item;
  }

  private getWorkspaceModeLabel(task: TaskRecord): string {
    if (task.status === 'waiting_user') {
      return '等待确认';
    }

    if (task.status === 'completed') {
      return '已完成';
    }

    if (task.status === 'failed') {
      return '失败';
    }

    if (task.status === 'cancelled') {
      return '已取消';
    }

    return task.workspace?.mode === 'planning'
      ? '规划中'
      : task.workspace?.mode === 'executing'
        ? '执行中'
        : '运行中';
  }

  private getWorkspaceStepStatusLabel(status: AgentWorkspaceStep['status']): string {
    if (status === 'in_progress') {
      return '运行中';
    }

    if (status === 'completed') {
      return '完成';
    }

    if (status === 'blocked') {
      return '阻塞';
    }

    return '待执行';
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
