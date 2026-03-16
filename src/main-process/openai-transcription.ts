const OPENAI_TRANSCRIPTION_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

export function getOpenAiTranscriptionModel(): string {
  return process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe';
}

export function getAudioUploadFilename(mimeType: string): string {
  if (mimeType.includes('webm')) {
    return 'speech.webm';
  }

  if (mimeType.includes('ogg')) {
    return 'speech.ogg';
  }

  if (mimeType.includes('mp4') || mimeType.includes('m4a')) {
    return 'speech.m4a';
  }

  return 'speech.wav';
}

export function extractTranscriptText(payload: Record<string, any>): string {
  return payload.text || payload.output_text || '';
}

export async function transcribeAudioWithOpenAi(input: {
  audioBuffer: ArrayBuffer;
  mimeType: string;
}): Promise<{ text: string }> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY，无法进行语音转写');
  }

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([input.audioBuffer], { type: input.mimeType }),
    getAudioUploadFilename(input.mimeType),
  );
  formData.append('model', getOpenAiTranscriptionModel());
  formData.append('language', 'zh');

  const response = await fetch(OPENAI_TRANSCRIPTION_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `语音转写失败（${response.status}）`);
  }

  const payload = await response.json();
  return {
    text: extractTranscriptText(payload).trim(),
  };
}
