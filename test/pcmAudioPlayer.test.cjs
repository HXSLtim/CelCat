const test = require('node:test');
const assert = require('node:assert/strict');

const { PcmAudioPlayer } = require('../dist/renderer/voice/pcmAudioPlayer.js');

test('PcmAudioPlayer includes output latency and tail padding in playback schedule', async () => {
  class FakeAudioContext {
    constructor() {
      this.currentTime = 1;
      this.baseLatency = 0.02;
      this.outputLatency = 0.03;
      this.state = 'running';
      this.destination = {};
    }

    createBuffer(_channels, frameCount, sampleRate) {
      return {
        duration: frameCount / sampleRate,
        getChannelData() {
          return new Float32Array(frameCount);
        },
      };
    }

    createBufferSource() {
      return {
        connect() {},
        start() {},
      };
    }

    async resume() {}
  }

  const player = new PcmAudioPlayer({
    AudioContext: FakeAudioContext,
  });

  const schedule = await player.play({
    pcmBase64: Buffer.from(new Int16Array([0, 0, 0, 0]).buffer).toString('base64'),
    sampleRate: 24000,
    channels: 1,
    format: 'pcm_s16le',
  });

  assert.ok(schedule);
  assert.ok(schedule.startDelayMs >= 50);
  assert.ok(schedule.durationMs > 120);
});
