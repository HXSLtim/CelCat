export const INTERACTION_CONFIG = {
  focus: {
    maxAngle: 30,
    maxEyeOffset: 1,
  },
  tap: {
    durationFrames: 18,
    peakScaleBoost: 0.18,
    squashRatio: 0.16,
    maxShift: 16,
    maxRotation: 0.14,
    flashAlpha: 0.34,
    ringAlpha: 0.22,
  },
  idle: {
    floatAmplitude: 5,
  },
  ambient: {
    randomExpressionsEnabled: false,
    expressionIntervalMs: 8000,
    expressionJitterMs: 7000,
  },
} as const;
