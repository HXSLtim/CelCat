const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatAudioInputDevices,
  getPreferredAudioInputDeviceId,
} = require('../dist/renderer/voice/audioDevices.js');

test('formatAudioInputDevices keeps labels and generates readable fallbacks', () => {
  const devices = formatAudioInputDevices([
    { deviceId: 'mic-a', kind: 'audioinput', label: 'USB Mic' },
    { deviceId: 'mic-b', kind: 'audioinput', label: '' },
    { deviceId: 'cam', kind: 'videoinput', label: 'Camera' },
  ]);

  assert.deepEqual(devices, [
    { id: 'mic-a', label: 'USB Mic' },
    { id: 'mic-b', label: '麦克风 2' },
  ]);
});

test('getPreferredAudioInputDeviceId preserves an existing choice when possible', () => {
  const devices = [
    { id: 'mic-a', label: 'USB Mic' },
    { id: 'mic-b', label: 'Headset Mic' },
  ];

  assert.equal(getPreferredAudioInputDeviceId(devices, 'mic-b'), 'mic-b');
  assert.equal(getPreferredAudioInputDeviceId(devices, 'missing'), 'mic-a');
  assert.equal(getPreferredAudioInputDeviceId([], 'missing'), '');
});
