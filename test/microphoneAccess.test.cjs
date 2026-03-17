const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ensureMicrophoneAccess,
} = require('../dist/renderer/voice/microphoneAccess.js');

test('ensureMicrophoneAccess resolves granted and stops opened tracks', async () => {
  let stopped = false;
  const stream = {
    getTracks() {
      return [
        {
          stop() {
            stopped = true;
          },
        },
      ];
    },
  };

  const result = await ensureMicrophoneAccess({
    navigator: {
      mediaDevices: {
        getUserMedia: async () => stream,
      },
    },
  });

  assert.deepEqual(result, { granted: true, error: '' });
  assert.equal(stopped, true);
});

test('ensureMicrophoneAccess returns a localized denial message', async () => {
  const result = await ensureMicrophoneAccess({
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          const error = new Error('denied');
          error.name = 'NotAllowedError';
          throw error;
        },
      },
    },
  });

  assert.deepEqual(result, {
    granted: false,
    error: '麦克风权限被拒绝，请在系统隐私设置中允许访问',
  });
});
