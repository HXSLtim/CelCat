import * as PIXI from 'pixi.js';
import { getPixiApplicationOptions } from './pixi-config';
import {
  getNextMenuOpenState,
  getWindowMenuItems,
  type WindowMenuActionId,
} from './window-menu';
import { getWindowChromeState } from './window-chrome';
import {
  createDragSession,
  getWindowPositionForPointer,
  isValidWindowPosition,
  type DragSession,
} from './window-drag';

const { ipcRenderer } = require('electron') as {
  ipcRenderer: {
    invoke(channel: 'window-drag:get-position'): Promise<[number, number]>;
    send(channel: 'window-drag:set-position', nextX: number, nextY: number): void;
  };
};

type Live2DManagerInstance = {
  loadModel(): Promise<void>;
  onTouch(position: PIXI.IPointData): void;
  refitModel(): void;
};

type Live2DModule = {
  Live2DManager: new (app: PIXI.Application) => Live2DManagerInstance;
};

(window as typeof window & { PIXI?: typeof PIXI }).PIXI = PIXI;

const { Live2DManager } = require('./live2d/live2d') as Live2DModule;

class DesktopCompanion {
  private app: PIXI.Application | null = null;
  private live2d: Live2DManagerInstance | null = null;
  private menuOpen = false;
  private dragSession: DragSession | null = null;
  private hoveringWindow = false;

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
  }

  private setupWindowChrome(): void {
    const dragButton = document.getElementById('drag-button');
    const menuButton = document.getElementById('menu-button') as HTMLButtonElement | null;
    const menu = document.getElementById('window-menu');

    if (!dragButton || !menuButton || !menu) {
      return;
    }

    menu.innerHTML = '';
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
      menu.appendChild(button);
    }

    dragButton.addEventListener('pointerdown', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const [windowX, windowY] = await ipcRenderer.invoke('window-drag:get-position');
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
      ipcRenderer.send('window-drag:set-position', nextPosition.x, nextPosition.y);
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

  private syncWindowChrome(): void {
    const chrome = document.getElementById('window-chrome');
    const chromeState = getWindowChromeState({
      hovering: this.hoveringWindow,
      menuOpen: this.menuOpen,
    });

    chrome?.classList.toggle('chrome-visible', chromeState.visible);
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
