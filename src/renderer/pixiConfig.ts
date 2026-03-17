import * as PIXI from 'pixi.js';

const DEFAULT_WINDOW_WIDTH = 300;
const DEFAULT_WINDOW_HEIGHT = 400;

type ViewportLike = {
  innerWidth?: number;
  innerHeight?: number;
};

PIXI.utils.skipHello();

export function getViewportSize(viewport?: ViewportLike): { width: number; height: number } {
  const width = Number.isFinite(viewport?.innerWidth) && (viewport?.innerWidth ?? 0) > 0
    ? Math.round(viewport!.innerWidth as number)
    : DEFAULT_WINDOW_WIDTH;
  const height = Number.isFinite(viewport?.innerHeight) && (viewport?.innerHeight ?? 0) > 0
    ? Math.round(viewport!.innerHeight as number)
    : DEFAULT_WINDOW_HEIGHT;

  return { width, height };
}

export function getPixiApplicationOptions(
  view: HTMLCanvasElement,
  devicePixelRatio: number,
  viewport?: ViewportLike,
): PIXI.IApplicationOptions {
  const size = getViewportSize(viewport);

  return {
    view,
    width: size.width,
    height: size.height,
    backgroundAlpha: 0,
    autoDensity: true,
    antialias: true,
    resolution: Math.max(devicePixelRatio || 1, 1),
  };
}
