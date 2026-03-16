export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onstart?: (() => void) | null;
  onend?: (() => void) | null;
  onerror?: ((event: { error: string }) => void) | null;
  onresult?: ((event: SpeechRecognitionResultEventLike) => void) | null;
};

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{
      transcript: string;
    }> & {
      isFinal?: boolean;
    }
  >;
};

export function getSpeechRecognitionConstructor(
  globalLike: Record<string, unknown>,
): SpeechRecognitionConstructor | null {
  return (globalLike.SpeechRecognition ??
    globalLike.webkitSpeechRecognition ??
    null) as SpeechRecognitionConstructor | null;
}

export function extractTranscriptFromResultEvent(
  event: SpeechRecognitionResultEventLike,
): { transcript: string; isFinal: boolean } {
  let transcript = '';
  let isFinal = false;

  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    transcript += result[0]?.transcript ?? '';
    isFinal = isFinal || Boolean(result.isFinal);
  }

  return {
    transcript: transcript.trim(),
    isFinal,
  };
}

export function getRecognitionErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '麦克风权限被拒绝';
    case 'no-speech':
      return '没有听到语音，请再试一次';
    case 'audio-capture':
      return '没有检测到可用麦克风';
    case 'network':
      return '语音识别网络异常';
    default:
      return '语音识别暂时不可用';
  }
}
