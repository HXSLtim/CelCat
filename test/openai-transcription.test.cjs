const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getOpenAiTranscriptionModel,
  getAudioUploadFilename,
  extractTranscriptText,
} = require('../dist/main-process/openai-transcription.js');

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
