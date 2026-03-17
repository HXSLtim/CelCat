import type { AssistantExpressionName } from '../assistantExpression';

export type EmotionParameterOffset = {
  id: string;
  value: number;
  weight?: number;
};

export function buildEmotionParameterOffsets(
  expressionName: AssistantExpressionName,
  intensity: number,
  timeMs: number,
): EmotionParameterOffset[] {
  const clampedIntensity = Math.max(0, Math.min(1, intensity));
  const sway = Math.sin(timeMs * 0.0042);
  const bounce = 0.5 + 0.5 * Math.sin(timeMs * 0.0088 + 0.7);
  const shimmer = 0.5 + 0.5 * Math.sin(timeMs * 0.0061 + 1.1);

  switch (expressionName) {
    case 'happy':
      return [
        offset('ParamCheek', 0.12 * clampedIntensity * shimmer, 0.75),
        offset('ParamEyeLSmile', 0.22 * clampedIntensity, 0.8),
        offset('ParamEyeRSmile', 0.22 * clampedIntensity, 0.8),
        offset('ParamMouthUp', 0.18 * clampedIntensity + 0.05 * clampedIntensity * bounce, 0.75),
        offset('ParamBodyAngleY', -2.4 * clampedIntensity * sway, 0.35),
      ];
    case 'excited':
      return [
        offset('ParamCheek', 0.14 * clampedIntensity, 0.8),
        offset('ParamEyeLOpen', 0.12 * clampedIntensity, 0.7),
        offset('ParamEyeROpen', 0.12 * clampedIntensity, 0.7),
        offset('ParamMouthUp', 0.22 * clampedIntensity + 0.08 * clampedIntensity * bounce, 0.8),
        offset('ParamAngleY', -4.5 * clampedIntensity * bounce, 0.35),
        offset('ParamBodyAngleX', 3.2 * clampedIntensity * sway, 0.3),
      ];
    case 'shy':
      return [
        offset('ParamCheek', 0.28 * clampedIntensity + 0.08 * clampedIntensity * shimmer, 0.9),
        offset('ParamEyeLSmile', 0.16 * clampedIntensity, 0.75),
        offset('ParamEyeRSmile', 0.16 * clampedIntensity, 0.75),
        offset('ParamEyeLOpen', -0.12 * clampedIntensity, 0.7),
        offset('ParamEyeROpen', -0.12 * clampedIntensity, 0.7),
        offset('ParamAngleY', 3.6 * clampedIntensity, 0.35),
        offset('ParamBodyAngleY', 2.2 * clampedIntensity * sway, 0.25),
      ];
    case 'sad':
      return [
        offset('ParamEyeLOpen', -0.16 * clampedIntensity, 0.75),
        offset('ParamEyeROpen', -0.16 * clampedIntensity, 0.75),
        offset('ParamMouthDown', 0.2 * clampedIntensity + 0.05 * clampedIntensity * shimmer, 0.78),
        offset('ParamAngleY', 3.4 * clampedIntensity, 0.32),
        offset('ParamBodyAngleY', 2.8 * clampedIntensity, 0.25),
      ];
    case 'angry':
      return [
        offset('ParamMouthAngry', 0.26 * clampedIntensity + 0.06 * clampedIntensity * bounce, 0.9),
        offset('ParamMouthAngryLine', 0.22 * clampedIntensity, 0.9),
        offset('ParamMouthDown', 0.1 * clampedIntensity, 0.55),
        offset('ParamAngleX', 4.5 * clampedIntensity * sway, 0.25),
        offset('ParamBodyAngleX', 3.8 * clampedIntensity * sway, 0.22),
      ];
    case 'surprised':
      return [
        offset('ParamEyeLOpen', 0.22 * clampedIntensity, 0.8),
        offset('ParamEyeROpen', 0.22 * clampedIntensity, 0.8),
        offset('ParamO', 0.2 * clampedIntensity + 0.06 * clampedIntensity * bounce, 0.82),
        offset('ParamAngleY', -5.2 * clampedIntensity * bounce, 0.34),
      ];
    case 'confused':
      return [
        offset('ParamAngleZ', 5.6 * clampedIntensity * sway, 0.34),
        offset('ParamBodyAngleZ', 3.2 * clampedIntensity * sway, 0.24),
        offset('ParamBrowLAngle', -0.18 * clampedIntensity, 0.45),
        offset('ParamBrowRAngle', 0.18 * clampedIntensity, 0.45),
        offset('ParamMouthDown', 0.08 * clampedIntensity, 0.4),
      ];
    case 'sleepy':
      return [
        offset('ParamEyeLOpen', -0.28 * clampedIntensity, 0.84),
        offset('ParamEyeROpen', -0.28 * clampedIntensity, 0.84),
        offset('ParamAngleY', 4.4 * clampedIntensity, 0.28),
        offset('ParamBodyAngleY', 3.4 * clampedIntensity, 0.22),
        offset('ParamMouthUp', 0.06 * clampedIntensity * shimmer, 0.35),
      ];
    default:
      return [];
  }
}

function offset(id: string, value: number, weight = 1): EmotionParameterOffset {
  return { id, value, weight };
}
