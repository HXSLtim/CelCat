import { INTERACTION_CONFIG } from './interactionConfig';

type BoundsLike = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PointerLike = {
  x: number;
  y: number;
};

export type PointerFocus = {
  angleX: number;
  angleY: number;
  eyeX: number;
  eyeY: number;
};

export type TapReaction = {
  scaleX: number;
  scaleY: number;
  shiftX: number;
  shiftY: number;
  rotation: number;
  flashAlpha: number;
  ringAlpha: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getNormalizedOffset(bounds: BoundsLike, pointer: PointerLike): PointerLike {
  const safeWidth = Math.max(bounds.width, 1);
  const safeHeight = Math.max(bounds.height, 1);
  const centerX = bounds.x + safeWidth / 2;
  const centerY = bounds.y + safeHeight / 2;

  return {
    x: clamp((pointer.x - centerX) / (safeWidth / 2), -1, 1),
    y: clamp((pointer.y - centerY) / (safeHeight / 2), -1, 1),
  };
}

export function computePointerFocus(bounds: BoundsLike, pointer: PointerLike): PointerFocus {
  const normalized = getNormalizedOffset(bounds, pointer);

  return {
    angleX: normalized.x * INTERACTION_CONFIG.focus.maxAngle,
    angleY: normalized.y * INTERACTION_CONFIG.focus.maxAngle,
    eyeX: normalized.x * INTERACTION_CONFIG.focus.maxEyeOffset,
    eyeY: normalized.y * INTERACTION_CONFIG.focus.maxEyeOffset,
  };
}

export function createTapReaction(
  bounds: BoundsLike,
  pointer: PointerLike,
  baseScale: number,
): TapReaction {
  const normalized = getNormalizedOffset(bounds, pointer);
  const intensity = Math.max(Math.abs(normalized.x), Math.abs(normalized.y), 0.35);
  const scaleBoost = INTERACTION_CONFIG.tap.peakScaleBoost * intensity;
  const squash = INTERACTION_CONFIG.tap.squashRatio * intensity;

  return {
    scaleX: baseScale * (1 + scaleBoost),
    scaleY: baseScale * (1 + scaleBoost - squash),
    shiftX: normalized.x * INTERACTION_CONFIG.tap.maxShift,
    shiftY: normalized.y * INTERACTION_CONFIG.tap.maxShift,
    rotation: normalized.x * INTERACTION_CONFIG.tap.maxRotation,
    flashAlpha: INTERACTION_CONFIG.tap.flashAlpha * intensity,
    ringAlpha: INTERACTION_CONFIG.tap.ringAlpha * intensity,
  };
}

export function isPointInsideBounds(bounds: BoundsLike, pointer: PointerLike): boolean {
  return (
    pointer.x >= bounds.x &&
    pointer.x <= bounds.x + bounds.width &&
    pointer.y >= bounds.y &&
    pointer.y <= bounds.y + bounds.height
  );
}
