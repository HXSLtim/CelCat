const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractTranscriptFromResultEvent,
  getRecognitionErrorMessage,
  getSpeechRecognitionConstructor,
} = require('../dist/renderer/voice/speech-recognition.js');
const { getVoiceUiState } = require('../dist/renderer/voice/voice-ui.js');

test('getSpeechRecognitionConstructor prefers the standard API and falls back to webkit', () => {
  function StandardRecognition() {}
  function WebkitRecognition() {}

  assert.equal(
    getSpeechRecognitionConstructor({
      SpeechRecognition: StandardRecognition,
      webkitSpeechRecognition: WebkitRecognition,
    }),
    StandardRecognition,
  );

  assert.equal(
    getSpeechRecognitionConstructor({
      webkitSpeechRecognition: WebkitRecognition,
    }),
    WebkitRecognition,
  );

  assert.equal(getSpeechRecognitionConstructor({}), null);
});

test('extractTranscriptFromResultEvent merges transcripts and tracks final results', () => {
  const event = {
    resultIndex: 1,
    results: [
      [{ transcript: 'ignore me' }],
      Object.assign([{ transcript: '你好 ' }], { isFinal: false }),
      Object.assign([{ transcript: '世界' }], { isFinal: true }),
    ],
  };

  assert.deepEqual(extractTranscriptFromResultEvent(event), {
    transcript: '你好 世界',
    isFinal: true,
  });
});

test('getRecognitionErrorMessage localizes common speech recognition errors', () => {
  assert.equal(getRecognitionErrorMessage('not-allowed'), '麦克风权限被拒绝');
  assert.equal(getRecognitionErrorMessage('no-speech'), '没有听到语音，请再试一次');
  assert.equal(getRecognitionErrorMessage('unknown-code'), '语音识别暂时不可用');
});

test('getVoiceUiState reflects listening, transcript, error, and unsupported states', () => {
  assert.deepEqual(
    getVoiceUiState({
      supported: true,
      listening: true,
      transcript: '',
      error: '',
      interimTranscript: '',
    }),
    {
      buttonLabel: '停止语音输入',
      buttonTitle: '停止语音输入',
      disabled: false,
      listening: true,
      showStatus: true,
      statusText: '正在聆听...',
      statusTone: 'listening',
    },
  );

  assert.deepEqual(
    getVoiceUiState({
      supported: true,
      listening: false,
      transcript: '你好',
      error: '',
      interimTranscript: '',
    }),
    {
      buttonLabel: '开始语音输入',
      buttonTitle: '开始语音输入',
      disabled: false,
      listening: false,
      showStatus: true,
      statusText: '你说：你好',
      statusTone: 'result',
    },
  );

  assert.deepEqual(
    getVoiceUiState({
      supported: false,
      listening: false,
      transcript: '',
      error: '',
      interimTranscript: '',
    }),
    {
      buttonLabel: '语音不可用',
      buttonTitle: '当前环境不支持语音识别',
      disabled: true,
      listening: false,
      showStatus: false,
      statusText: '',
      statusTone: 'idle',
    },
  );
});
