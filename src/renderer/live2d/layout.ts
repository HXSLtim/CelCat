type ViewportSize = {
  width: number;
  height: number;
};

type BoundsLike = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ModelLayout = {
  scale: number;
  positionX: number;
  positionY: number;
  pivotX: number;
  pivotY: number;
};

const WIDTH_FILL_RATIO = 0.9;
const HEIGHT_FILL_RATIO = 0.9;
const VERTICAL_CENTER_RATIO = 0.55;
const MIN_BOUNDS_SIZE = 1;

export function computeModelLayout(
  viewport: ViewportSize,
  bounds: BoundsLike,
): ModelLayout {
  const safeBoundsWidth = Math.max(bounds.width, MIN_BOUNDS_SIZE);
  const safeBoundsHeight = Math.max(bounds.height, MIN_BOUNDS_SIZE);
  const scale = Math.min(
    (viewport.width * WIDTH_FILL_RATIO) / safeBoundsWidth,
    (viewport.height * HEIGHT_FILL_RATIO) / safeBoundsHeight,
  );

  return {
    scale,
    positionX: Math.round(viewport.width / 2),
    positionY: Math.round(viewport.height * VERTICAL_CENTER_RATIO),
    pivotX: bounds.x + safeBoundsWidth / 2,
    pivotY: bounds.y + safeBoundsHeight / 2,
  };
}
