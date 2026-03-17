import * as PIXI from 'pixi.js';

const WINDOW_WIDTH = 300;
const WINDOW_HEIGHT = 400;

PIXI.utils.skipHello();

export function getPixiApplicationOptions(
  view: HTMLCanvasElement,
  devicePixelRatio: number,
): PIXI.IApplicationOptions {
  return {
    view,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    backgroundAlpha: 0,
    autoDensity: true,
    antialias: true,
    resolution: Math.max(devicePixelRatio || 1, 1),
  };
}
