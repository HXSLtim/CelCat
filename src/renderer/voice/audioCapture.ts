export type AudioFramePayload = {
  pcmBase64: string;
  sampleRate: number;
  channels: number;
};

export const REALTIME_AUDIO_SAMPLE_RATE = 16000;
export const REALTIME_AUDIO_FRAME_SAMPLES = 1600;

export function convertFloat32ToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    output[index] = sample < 0
      ? Math.round(sample * 0x8000)
      : Math.round(sample * 0x7fff);
  }

  return output;
}

export function encodePcm16ToBase64(input: Int16Array): string {
  const bytes = new Uint8Array(input.buffer);
  let binary = '';

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }

  return btoa(binary);
}

export function downsampleFloat32Samples(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = REALTIME_AUDIO_SAMPLE_RATE,
): Float32Array {
  if (!input.length) {
    return new Float32Array(0);
  }

  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0 || sourceSampleRate === targetSampleRate) {
    return input.slice();
  }

  const rateRatio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / rateRatio));
  const output = new Float32Array(outputLength);

  let sourceOffset = 0;
  for (let index = 0; index < outputLength; index += 1) {
    const nextSourceOffset = Math.min(
      input.length,
      Math.max(sourceOffset + 1, Math.round((index + 1) * rateRatio)),
    );

    let sum = 0;
    let count = 0;
    for (let readIndex = sourceOffset; readIndex < nextSourceOffset; readIndex += 1) {
      sum += input[readIndex] ?? 0;
      count += 1;
    }

    output[index] = count ? sum / count : input[sourceOffset] ?? 0;
    sourceOffset = nextSourceOffset;
  }

  return output;
}

export function concatFloat32Samples(...chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);

  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

export function createAudioFramePayload(input: {
  samples: Float32Array;
  sampleRate: number;
  channels?: number;
}): AudioFramePayload {
  return {
    pcmBase64: encodePcm16ToBase64(convertFloat32ToInt16(input.samples)),
    sampleRate: input.sampleRate,
    channels: input.channels ?? 1,
  };
}
