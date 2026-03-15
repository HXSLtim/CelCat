import { Live2DManager } from './live2d/live2d.js';

class DesktopCompanion {
  private app: PIXI.Application | null = null;
  private live2d: Live2DManager | null = null;

  constructor() {
    this.init();
  }

  async init(): Promise<void> {
    await this.setupPixi();
    await this.setupLive2D();
    this.setupEvents();
  }

  async setupPixi(): Promise<void> {
    this.app = new PIXI.Application({
      view: document.getElementById('live2d-canvas') as HTMLCanvasElement,
      transparent: true,
      width: 300,
      height: 400
    });
  }

  async setupLive2D(): Promise<void> {
    const { Live2DManager } = await import('./live2d/live2d.js');
    this.live2d = new Live2DManager(this.app!);
    await this.live2d.loadModel();
  }

  setupEvents(): void {
    // Add click interaction
    (this.app!.stage as any).interactive = true;
    (this.app!.stage as any).on('pointerdown', (event: any) => {
      this.live2d!.onTouch(event.global);
    });

    // Show controls on hover
    document.body.addEventListener('mouseenter', () => {
      document.getElementById('controls')?.classList.remove('hidden');
    });

    document.body.addEventListener('mouseleave', () => {
      document.getElementById('controls')?.classList.add('hidden');
    });

    // Close button
    document.getElementById('close-btn')?.addEventListener('click', () => {
      window.close();
    });
  }
}

new DesktopCompanion();