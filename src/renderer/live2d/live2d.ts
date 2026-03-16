import * as PIXI from 'pixi.js';
import { getModelJsonPath, getModelLoadOptions } from './model-config';
import { computeModelLayout } from './layout';
import { getLogicalViewportSize } from './viewport';

const { Live2DModel } = require('pixi-live2d-display/cubism4') as {
  Live2DModel: {
    from(
      modelPath: string,
      options?: { autoInteract?: boolean },
    ): Promise<PIXI.Container>;
  };
};

export class Live2DManager {
  private app: PIXI.Application;
  private model: PIXI.Container | null = null;
  private baseModelY = 200;

  constructor(app: PIXI.Application) {
    this.app = app;
  }

  async loadModel(): Promise<void> {
    try {
      console.log('Attempting to load Live2D model...');
      this.model = await Live2DModel.from(getModelJsonPath(), getModelLoadOptions());
      console.log('Live2D model loaded successfully:', this.model);

      this.app.stage.addChild(this.model);
      this.placeModel();
      this.animate();
    } catch (error) {
      console.error('Failed to load Live2D model:', error);
      this.createPlaceholder();
    }
  }

  private placeModel(): void {
    if (!this.model) {
      return;
    }

    const bounds = this.model.getLocalBounds();
    const viewport = getLogicalViewportSize(this.app);
    const layout = computeModelLayout(
      viewport,
      bounds,
    );

    this.model.pivot.set(layout.pivotX, layout.pivotY);
    this.model.position.set(layout.positionX, layout.positionY);
    this.model.scale.set(layout.scale);
    this.baseModelY = layout.positionY;

    console.log('Live2D model bounds:', JSON.stringify(bounds));
    console.log('Live2D model viewport:', JSON.stringify(viewport));
    console.log('Live2D model layout:', JSON.stringify(layout));
  }

  private createPlaceholder(): void {
    const container = new PIXI.Container();
    const graphics = new PIXI.Graphics();

    graphics.beginFill(0x66CCFF);
    graphics.drawCircle(0, 0, 50);
    graphics.endFill();

    graphics.beginFill(0x000000);
    graphics.drawCircle(-15, -10, 8);
    graphics.drawCircle(15, -10, 8);
    graphics.endFill();

    graphics.lineStyle(3, 0x000000);
    graphics.arc(0, 10, 15, 0, Math.PI);

    container.addChild(graphics);
    (container as any).x = 150;
    (container as any).y = 200;

    this.app.stage.addChild(container);
    this.model = container;
    this.animate();
  }

  animate(): void {
    let time = 0;
    this.app.ticker.add(() => {
      time += 0.05;
      if (this.model) {
        this.model.y = Math.sin(time) * 5 + this.baseModelY;
      }
    });
  }

  onTouch(position: any): void {
    if (this.model) {
      const originalScale = this.model.scale.x;
      this.model.scale.set(originalScale * 1.2);

      setTimeout(() => {
        this.model?.scale.set(originalScale);
      }, 200);
    }
  }

  refitModel(): void {
    this.placeModel();
  }
}
