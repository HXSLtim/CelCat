import * as PIXI from 'pixi.js';
import { getModelJsonPath, getModelLoadOptions } from './model-config';
import { computeModelLayout } from './layout';
import { getLogicalViewportSize } from './viewport';
import { Live2DAction, LIVE2D_ACTIONS } from './actions';
import { INTERACTION_CONFIG } from './interaction-config';
import {
  computePointerFocus,
  createTapReaction,
  isPointInsideBounds,
  type TapReaction,
} from './interaction-feedback';

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
  private model: any = null;
  private feedbackRing: PIXI.Graphics | null = null;
  private baseModelY = 200;
  private baseModelX = 150;
  private baseScale = 1;
  private mouseX = 0;
  private mouseY = 0;
  private tapFeedback:
    | {
        frame: number;
        pointer: { x: number; y: number };
        reaction: TapReaction;
      }
    | null = null;

  constructor(app: PIXI.Application) {
    this.app = app;
    this.setupMouseTracking();
    this.setupFeedbackLayer();
  }

  executeAction(actionName: string): void {
    const action = this.findAction(actionName);
    if (action && this.model) {
      action.execute(this.model);
    }
  }

  private findAction(name: string): Live2DAction | undefined {
    return [...LIVE2D_ACTIONS.expressions, ...LIVE2D_ACTIONS.motions, ...LIVE2D_ACTIONS.parameters]
      .find(action => action.name === name);
  }

  async loadModel(): Promise<void> {
    try {
      console.log('Attempting to load Live2D model...');
      this.model = await Live2DModel.from(getModelJsonPath(), getModelLoadOptions());
      console.log('Live2D model loaded successfully:', this.model);

      this.app.stage.addChild(this.model);
      this.placeModel();
      this.animate();
      this.startRandomExpressions();
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
    this.baseModelX = layout.positionX;
    this.baseModelY = layout.positionY;
    this.baseScale = layout.scale;

    console.log('Live2D model bounds:', JSON.stringify(bounds));
    console.log('Live2D model viewport:', JSON.stringify(viewport));
    console.log('Live2D model layout:', JSON.stringify(layout));
  }

  private setupFeedbackLayer(): void {
    this.feedbackRing = new PIXI.Graphics();
    this.feedbackRing.visible = false;
    this.app.stage.addChild(this.feedbackRing);
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

  private setupMouseTracking(): void {
    document.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
  }

  animate(): void {
    let time = 0;
    this.app.ticker.add(() => {
      time += 0.05;
      if (this.model && this.model.internalModel) {
        const bounds = this.model.getBounds();
        const focus = computePointerFocus(bounds, {
          x: this.mouseX,
          y: this.mouseY,
        });

        this.setParameter('ParamEyeBallX', focus.eyeX);
        this.setParameter('ParamEyeBallY', focus.eyeY);
        this.setParameter('ParamAngleX', focus.angleX);
        this.setParameter('ParamAngleY', focus.angleY);
      }

      this.applyIdleMotion(time);
      this.updateTapFeedback();
    });
  }

  onTouch(position: any): void {
    if (!this.model?.getBounds) {
      return;
    }

    const bounds = this.model.getBounds();
    const pointer = { x: position.x, y: position.y };

    if (!isPointInsideBounds(bounds, pointer)) {
      return;
    }

    this.executeAction('tap');
    const randomExpression = LIVE2D_ACTIONS.expressions[Math.floor(Math.random() * LIVE2D_ACTIONS.expressions.length)];
    this.executeAction(randomExpression.name);
    this.tapFeedback = {
      frame: 0,
      pointer,
      reaction: createTapReaction(bounds, pointer, this.baseScale),
    };
    this.drawFeedbackRing(0);
  }

  startRandomExpressions(): void {
    setInterval(() => {
      if (this.model) {
        const randomExpression = LIVE2D_ACTIONS.expressions[Math.floor(Math.random() * LIVE2D_ACTIONS.expressions.length)];
        this.executeAction(randomExpression.name);
      }
    }, INTERACTION_CONFIG.ambient.expressionIntervalMs + Math.random() * INTERACTION_CONFIG.ambient.expressionJitterMs);
  }

  private setParameter(paramName: string, value: number): void {
    if (this.model?.internalModel?.coreModel) {
      const index = this.model.internalModel.coreModel.getParameterIndex(paramName);
      this.model.internalModel.coreModel.setParameterValueByIndex(index, value);
    }
  }

  refitModel(): void {
    this.placeModel();
  }

  private applyIdleMotion(time: number): void {
    if (!this.model) {
      return;
    }

    const floatY = Math.sin(time) * INTERACTION_CONFIG.idle.floatAmplitude + this.baseModelY;

    if (!this.tapFeedback) {
      this.model.x = this.baseModelX;
      this.model.y = floatY;
      this.model.scale.set(this.baseScale, this.baseScale);
      this.model.rotation = 0;
    }
  }

  private updateTapFeedback(): void {
    if (!this.model || !this.tapFeedback) {
      return;
    }

    const progress = this.tapFeedback.frame / INTERACTION_CONFIG.tap.durationFrames;
    const envelope = Math.sin(Math.min(progress, 1) * Math.PI);
    const idleY = this.model.y;

    this.model.x = this.baseModelX + this.tapFeedback.reaction.shiftX * envelope;
    this.model.y = idleY + this.tapFeedback.reaction.shiftY * envelope * 0.7;
    this.model.scale.set(
      this.baseScale + (this.tapFeedback.reaction.scaleX - this.baseScale) * envelope,
      this.baseScale + (this.tapFeedback.reaction.scaleY - this.baseScale) * envelope,
    );
    this.model.rotation = this.tapFeedback.reaction.rotation * envelope;

    this.drawFeedbackRing(progress);

    this.tapFeedback.frame += 1;
    if (this.tapFeedback.frame > INTERACTION_CONFIG.tap.durationFrames) {
      this.tapFeedback = null;
      this.feedbackRing?.clear();
      if (this.feedbackRing) {
        this.feedbackRing.visible = false;
      }
    }
  }

  private drawFeedbackRing(progress: number): void {
    if (!this.feedbackRing || !this.tapFeedback) {
      return;
    }

    const radius = 18 + progress * 46;
    const alpha = this.tapFeedback.reaction.ringAlpha * (1 - Math.min(progress, 1));

    this.feedbackRing.visible = true;
    this.feedbackRing.clear();
    this.feedbackRing.lineStyle(2, 0xffffff, alpha);
    this.feedbackRing.beginFill(0xffffff, this.tapFeedback.reaction.flashAlpha * (1 - Math.min(progress, 1)) * 0.45);
    this.feedbackRing.drawCircle(this.tapFeedback.pointer.x, this.tapFeedback.pointer.y, radius);
    this.feedbackRing.endFill();
  }
}
