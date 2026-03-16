export type VoiceUiStateInput = {
  supported: boolean;
  listening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string;
};

export type VoiceUiState = {
  buttonLabel: string;
  buttonTitle: string;
  disabled: boolean;
  listening: boolean;
  showStatus: boolean;
  statusText: string;
  statusTone: 'idle' | 'listening' | 'processing' | 'result' | 'error';
};

export function getVoiceUiState(input: VoiceUiStateInput): VoiceUiState {
  if (!input.supported) {
    return {
      buttonLabel: '语音不可用',
      buttonTitle: '当前环境不支持语音识别',
      disabled: true,
      listening: false,
      showStatus: false,
      statusText: '',
      statusTone: 'idle',
    };
  }

  if (input.error) {
    return {
      buttonLabel: '开始语音输入',
      buttonTitle: '开始语音输入',
      disabled: false,
      listening: false,
      showStatus: true,
      statusText: input.error,
      statusTone: 'error',
    };
  }

  if (input.listening) {
    return {
      buttonLabel: '停止语音输入',
      buttonTitle: '停止语音输入',
      disabled: false,
      listening: true,
      showStatus: true,
      statusText: input.interimTranscript ? `听到：${input.interimTranscript}` : '正在聆听...',
      statusTone: 'listening',
    };
  }

  if (input.interimTranscript) {
    return {
      buttonLabel: '开始语音输入',
      buttonTitle: '开始语音输入',
      disabled: false,
      listening: false,
      showStatus: true,
      statusText: input.interimTranscript,
      statusTone: 'processing',
    };
  }

  if (input.transcript) {
    return {
      buttonLabel: '开始语音输入',
      buttonTitle: '开始语音输入',
      disabled: false,
      listening: false,
      showStatus: true,
      statusText: `你说：${input.transcript}`,
      statusTone: 'result',
    };
  }

  return {
    buttonLabel: '开始语音输入',
    buttonTitle: '开始语音输入',
    disabled: false,
    listening: false,
    showStatus: false,
    statusText: '',
    statusTone: 'idle',
  };
}
