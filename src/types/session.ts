export type SessionStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error';

export type SessionSnapshot = {
  status: SessionStatus;
  connected: boolean;
  lastTranscript: string;
  lastAssistantMessage: string;
  activeTaskId: string | null;
  error: string;
};

export type SessionEvent =
  | {
      type: 'session-state';
      snapshot: SessionSnapshot;
    }
  | {
      type: 'transcript';
      transcript: string;
    }
  | {
      type: 'assistant-message';
      text: string;
      isFinal?: boolean;
      relatedTaskId?: string | null;
    }
  | {
      type: 'assistant-audio';
      pcmBase64: string;
      sampleRate: number;
      channels: number;
      format: 'pcm_s16le';
    }
  | {
      type: 'error';
      message: string;
    };

export type UserAudioPayload = {
  audioBuffer: ArrayBuffer;
  mimeType: string;
};

export type StreamingAudioFrame = {
  pcmBase64: string;
  sampleRate: number;
  channels: number;
};
