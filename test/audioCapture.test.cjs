const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REALTIME_AUDIO_FRAME_SAMPLES,
  REALTIME_AUDIO_SAMPLE_RATE,
  concatFloat32Samples,
  convertFloat32ToInt16,
  createAudioFramePayload,
  downsampleFloat32Samples,
} = require('../dist/renderer/voice/audioCapture.js');

test('convertFloat32ToInt16 clamps and scales normalized samples', () => {
  const converted = convertFloat32ToInt16(new Float32Array([-1.5, -1, 0, 0.5, 1]));

  assert.deepEqual(Array.from(converted), [-32768, -32768, 0, 16384, 32767]);
});

test('createAudioFramePayload returns PCM base64 metadata', () => {
  const payload = createAudioFramePayload({
    samples: new Float32Array([0, 0.25, -0.25]),
    sampleRate: 16000,
  });

  assert.equal(payload.sampleRate, 16000);
  assert.equal(payload.channels, 1);
  assert.equal(typeof payload.pcmBase64, 'string');
  assert.notEqual(payload.pcmBase64.length, 0);
});

test('downsampleFloat32Samples converts 48k input to 16k mono frames', () => {
  const downsampled = downsampleFloat32Samples(
    new Float32Array([0, 0.3, 0.6, 0.6, 0.3, 0]),
    48000,
    REALTIME_AUDIO_SAMPLE_RATE,
  );

  assert.equal(downsampled.length, 2);
  assert.ok(Math.abs(downsampled[0] - 0.3) < 1e-6);
  assert.ok(Math.abs(downsampled[1] - 0.3) < 1e-6);
});

test('concatFloat32Samples merges buffered realtime chunks', () => {
  const merged = concatFloat32Samples(
    new Float32Array(REALTIME_AUDIO_FRAME_SAMPLES - 2).fill(0.1),
    new Float32Array([0.2, 0.3, 0.4]),
  );

  assert.equal(merged.length, REALTIME_AUDIO_FRAME_SAMPLES + 1);
  assert.ok(Math.abs(merged[merged.length - 1] - 0.4) < 1e-6);
});
