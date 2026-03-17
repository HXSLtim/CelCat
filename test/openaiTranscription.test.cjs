const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getOpenAiTranscriptionModel,
  getAudioUploadFilename,
  extractTranscriptText,
  transcribeAudioWithOpenAi,
} = require('../dist/main-process/openaiTranscription.js');

test('getOpenAiTranscriptionModel uses the lightweight transcription model by default', () => {
  assert.equal(getOpenAiTranscriptionModel(), 'gpt-4o-mini-transcribe');
});

test('getAudioUploadFilename maps mime types to stable upload extensions', () => {
  assert.equal(getAudioUploadFilename('audio/webm;codecs=opus'), 'speech.webm');
  assert.equal(getAudioUploadFilename('audio/ogg'), 'speech.ogg');
  assert.equal(getAudioUploadFilename('audio/mp4'), 'speech.m4a');
  assert.equal(getAudioUploadFilename('audio/unknown'), 'speech.wav');
});

test('extractTranscriptText supports text and verbose_json payloads', () => {
  assert.equal(extractTranscriptText({ text: '你好世界' }), '你好世界');
  assert.equal(
    extractTranscriptText({
      output_text: '你好世界',
    }),
    '你好世界',
  );
  assert.equal(extractTranscriptText({}), '');
});

test('transcribeAudioWithOpenAi hides internal env-var names when local fallback is not configured', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  await assert.rejects(
    transcribeAudioWithOpenAi({
      audioBuffer: new ArrayBuffer(8),
      mimeType: 'audio/webm',
    }),
    /当前本地兜底转写未配置/,
  );

  if (typeof originalApiKey === 'string') {
    process.env.OPENAI_API_KEY = originalApiKey;
  }
});
