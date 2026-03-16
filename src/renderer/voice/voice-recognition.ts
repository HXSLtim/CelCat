import { formatAudioInputDevices, getPreferredAudioInputDeviceId, type AudioInputDeviceOption } from './audio-devices';
import { getVoiceUiState, type VoiceUiState } from './voice-ui';
import { ensureMicrophoneAccess } from './microphone-access';

type VoiceGlobalLike = {
  navigator?: {
    mediaDevices?: {
      getUserMedia?(constraints: MediaStreamConstraints): Promise<MediaStream>;
      enumerateDevices?(): Promise<MediaDeviceInfo[]>;
      addEventListener?(type: 'devicechange', listener: () => void): void;
    };
  };
  localStorage?: {
    getItem?(key: string): string | null;
    setItem?(key: string, value: string): void;
  };
  MediaRecorder?: {
    new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
    isTypeSupported?(mimeType: string): boolean;
  };
  ipcRenderer?: {
    invoke(
      channel: 'voice:transcribe',
      payload: { audioBuffer: ArrayBuffer; mimeType: string },
    ): Promise<{ text: string }>;
  };
};

type VoiceRecognitionCallbacks = {
  onStateChange(state: VoiceUiState): void;
  onDeviceListChange?(devices: AudioInputDeviceOption[], selectedDeviceId: string): void;
  onFinalTranscript?(transcript: string): void;
};

export class VoiceRecognitionController {
  private mediaRecorder: MediaRecorder | null = null;
  private activeStream: MediaStream | null = null;
  private recordedChunks: Blob[] = [];
  private readonly supported: boolean;
  private listening = false;
  private transcript = '';
  private interimTranscript = '';
  private error = '';
  private stopRequested = false;
  private readonly globalLike: VoiceGlobalLike;
  private readonly callbacks: VoiceRecognitionCallbacks;
  private devices: AudioInputDeviceOption[] = [];
  private selectedDeviceId = '';

  constructor(globalLike: VoiceGlobalLike, callbacks: VoiceRecognitionCallbacks) {
    this.globalLike = globalLike;
    this.callbacks = callbacks;
    this.supported = Boolean(globalLike.navigator?.mediaDevices?.getUserMedia && globalLike.MediaRecorder);

    void this.refreshDevices();
    globalLike.navigator?.mediaDevices?.addEventListener?.('devicechange', () => {
      void this.refreshDevices();
    });
    this.publish();
  }

  setSelectedDevice(deviceId: string): void {
    this.selectedDeviceId = deviceId;
    if (typeof this.globalLike.localStorage?.setItem === 'function') {
      this.globalLike.localStorage.setItem('celcat.voice.deviceId', deviceId);
    }
  }

  toggleListening(): void {
    if (!this.supported) {
      this.publish();
      return;
    }

    if (this.listening) {
      this.stopRequested = true;
      this.mediaRecorder?.stop();
      return;
    }

    void this.startListening();
  }

  private async startListening(): Promise<void> {
    if (!this.supported) {
      return;
    }

    this.error = '';
    this.transcript = '';
    this.interimTranscript = '正在准备麦克风...';
    this.stopRequested = false;
    this.publish();

    const access = await ensureMicrophoneAccess(this.globalLike);
    if (!access.granted) {
      this.error = access.error;
      this.listening = false;
      this.publish();
      return;
    }

    try {
      await this.refreshDevices();

      const stream = await this.globalLike.navigator!.mediaDevices!.getUserMedia!({
        audio: this.selectedDeviceId
          ? { deviceId: { exact: this.selectedDeviceId } }
          : true,
      });

      this.activeStream = stream;
      this.recordedChunks = [];
      const preferredMimeType = this.getPreferredMimeType();
      this.mediaRecorder = preferredMimeType
        ? new this.globalLike.MediaRecorder!(stream, { mimeType: preferredMimeType })
        : new this.globalLike.MediaRecorder!(stream);

      this.mediaRecorder.addEventListener('dataavailable', (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      });

      this.mediaRecorder.addEventListener('stop', () => {
        void this.handleRecordingStop();
      });

      this.mediaRecorder.start();
      this.listening = true;
      this.interimTranscript = '正在聆听...';
      this.publish();
    } catch (error) {
      this.error = '暂时无法启动麦克风录音';
      this.listening = false;
      this.publish();
    }
  }

  private async refreshDevices(): Promise<void> {
    if (!this.globalLike.navigator?.mediaDevices?.enumerateDevices) {
      return;
    }

    const rawDevices = await this.globalLike.navigator.mediaDevices.enumerateDevices();
    this.devices = formatAudioInputDevices(rawDevices);
    this.selectedDeviceId = getPreferredAudioInputDeviceId(
      this.devices,
      this.selectedDeviceId || this.globalLike.localStorage?.getItem?.('celcat.voice.deviceId') || '',
    );
    this.callbacks.onDeviceListChange?.(this.devices, this.selectedDeviceId);
  }

  private getPreferredMimeType(): string {
    const mediaRecorder = this.globalLike.MediaRecorder;
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      '',
    ];

    return candidates.find((candidate) => !candidate || mediaRecorder?.isTypeSupported?.(candidate)) || '';
  }

  private async handleRecordingStop(): Promise<void> {
    const mediaRecorder = this.mediaRecorder;
    const stream = this.activeStream;

    this.mediaRecorder = null;
    this.activeStream = null;
    this.listening = false;
    this.stopRequested = false;
    this.interimTranscript = '正在转写...';
    this.publish();

    stream?.getTracks().forEach((track) => track.stop());

    if (!this.recordedChunks.length) {
      this.interimTranscript = '';
      this.error = '没有录到有效语音';
      this.publish();
      return;
    }

    const mimeType = mediaRecorder?.mimeType || 'audio/webm';
    const audioBlob = new Blob(this.recordedChunks, { type: mimeType });
    const audioBuffer = await audioBlob.arrayBuffer();

    try {
      const result = await this.globalLike.ipcRenderer!.invoke('voice:transcribe', {
        audioBuffer,
        mimeType,
      });

      this.interimTranscript = '';
      this.transcript = result.text || '没有识别到清晰内容';
      this.error = '';
      this.callbacks.onFinalTranscript?.(this.transcript);
      this.publish();
    } catch (error: any) {
      this.interimTranscript = '';
      this.error = error?.message || '语音转写失败';
      this.publish();
    }
  }

  private publish(): void {
    this.callbacks.onStateChange(
      getVoiceUiState({
        supported: this.supported,
        listening: this.listening,
        transcript: this.transcript,
        interimTranscript: this.interimTranscript,
        error: this.error,
      }),
    );
  }
}
