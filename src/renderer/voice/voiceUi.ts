export type VoiceUiStateInput = {
  supported: boolean;
  listening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string;
};

export type VoiceUiState = {
  listening: boolean;
  showStatus: boolean;
  statusText: string;
  statusTone: 'idle' | 'listening' | 'processing' | 'result' | 'error';
};

export function getVoiceUiState(input: VoiceUiStateInput): VoiceUiState {
  if (!input.supported) {
    return {
      listening: false,
      showStatus: false,
      statusText: '',
      statusTone: 'idle',
    };
  }

  if (input.error) {
    return {
      listening: false,
      showStatus: true,
      statusText: input.error,
      statusTone: 'error',
    };
  }

  if (input.listening) {
    return {
      listening: true,
      showStatus: true,
      statusText: input.interimTranscript ? `听到：${input.interimTranscript}` : '正在聆听...',
      statusTone: 'listening',
    };
  }

  if (input.interimTranscript) {
    return {
      listening: false,
      showStatus: true,
      statusText: input.interimTranscript,
      statusTone: 'processing',
    };
  }

  if (input.transcript) {
    return {
      listening: false,
      showStatus: true,
      statusText: `你说：${input.transcript}`,
      statusTone: 'result',
    };
  }

  return {
    listening: false,
    showStatus: false,
    statusText: '',
    statusTone: 'idle',
  };
}
