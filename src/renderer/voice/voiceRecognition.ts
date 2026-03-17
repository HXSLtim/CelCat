import {
  extractTranscriptFromResultEvent,
  getRecognitionErrorMessage,
  getSpeechRecognitionConstructor,
  type SpeechRecognitionLike,
} from './speechRecognition';
import {
  concatFloat32Samples,
  createAudioFramePayload,
  downsampleFloat32Samples,
  REALTIME_AUDIO_FRAME_SAMPLES,
  REALTIME_AUDIO_SAMPLE_RATE,
  type AudioFramePayload,
} from './audioCapture';
import { getVoiceUiState, type VoiceUiState } from './voiceUi';
import { ensureMicrophoneAccess } from './microphoneAccess';
import { logDebug, truncateDebugText } from '../../shared/debugLogger';

type VoiceGlobalLike = {
  navigator?: {
    mediaDevices?: {
      getUserMedia?(constraints: MediaStreamConstraints): Promise<MediaStream>;
    };
  };
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
  AudioWorkletNode?: typeof AudioWorkletNode;
  MediaRecorder?: {
    new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
    isTypeSupported?(mimeType: string): boolean;
  };
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  speechSynthesis?: {
    cancel?(): void;
  };
  location?: Location;
  electronAPI?: {
    session?: {
      submitUserAudio(payload: { audioBuffer: ArrayBuffer; mimeType: string }): Promise<void>;
      submitUserTranscript(transcript: string): Promise<void>;
      appendInputAudioFrame(frame: AudioFramePayload): Promise<void>;
      commitInputAudio(): Promise<void>;
    };
  };
};

type VoiceRecognitionCallbacks = {
  onStateChange(state: VoiceUiState): void;
  onFinalTranscript?(transcript: string): void;
};

export class VoiceRecognitionController {
  private recognition: SpeechRecognitionLike | null = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private monitorNode: GainNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private pendingRealtimeSamples = new Float32Array(0);
  private usingFallbackTranscription = false;
  private segmentRecording = false;
  private lastVoiceAt = 0;
  private segmentStartedAt = 0;
  private readonly supported: boolean;
  private listening = false;
  private transcript = '';
  private interimTranscript = '';
  private error = '';
  private manuallyStopped = false;
  private appendFrameErrorLogged = false;
  private readonly globalLike: VoiceGlobalLike;
  private readonly callbacks: VoiceRecognitionCallbacks;

  constructor(globalLike: VoiceGlobalLike, callbacks: VoiceRecognitionCallbacks) {
    this.globalLike = globalLike;
    this.callbacks = callbacks;
    this.supported = Boolean(
      globalLike.navigator?.mediaDevices?.getUserMedia
      && (
        getSpeechRecognitionConstructor(globalLike as Record<string, unknown>)
        || globalLike.MediaRecorder
      ),
    );

    logDebug('voice', 'VoiceRecognitionController created', {
      supported: this.supported,
    });
    this.publish();
    void this.startContinuousListening();
  }

  private async startContinuousListening(): Promise<void> {
    if (!this.supported) {
      logDebug('voice', 'Continuous listening is not supported in current environment');
      return;
    }

    logDebug('voice', 'Starting continuous listening bootstrap');
    this.error = '';
    this.transcript = '';
    this.interimTranscript = '正在准备麦克风...';
    this.manuallyStopped = false;
    this.publish();

    const access = await ensureMicrophoneAccess(this.globalLike);
    if (!access.granted) {
      logDebug('voice', 'Microphone access denied', {
        error: access.error,
      });
      this.error = access.error;
      this.listening = false;
      this.publish();
      return;
    }

    try {
      this.mediaStream = await this.globalLike.navigator!.mediaDevices!.getUserMedia!({ audio: true });
      logDebug('voice', 'Microphone stream acquired');
      await this.startAudioStreaming(this.mediaStream);
      const Recognition = getSpeechRecognitionConstructor(this.globalLike as Record<string, unknown>);
      if (Recognition) {
        this.recognition = this.createRecognition();
        this.recognition.start();
      } else {
        this.activateFallbackTranscription('当前环境不支持内置连续识别，已切换到本地转写。');
      }
    } catch (error: any) {
      logDebug('voice', 'Failed to start continuous listening', {
        message: error?.message || 'unknown error',
      });
      this.error = '暂时无法启动实时语音识别';
      this.listening = false;
      this.publish();
    }
  }

  private async startAudioStreaming(stream: MediaStream): Promise<void> {
    const AudioContextConstructor = this.globalLike.AudioContext ?? this.globalLike.webkitAudioContext;
    if (!AudioContextConstructor) {
      logDebug('voice', 'AudioContext is unavailable, realtime streaming disabled');
      return;
    }

    this.audioContext = new AudioContextConstructor();
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.monitorNode = this.audioContext.createGain();
    this.monitorNode.gain.value = 0;
    this.monitorNode.connect(this.audioContext.destination);
    if (await this.tryStartAudioWorkletStreaming()) {
      return;
    }

    this.startScriptProcessorStreaming();
  }

  private async tryStartAudioWorkletStreaming(): Promise<boolean> {
    if (!this.audioContext || !this.sourceNode || !this.globalLike.AudioWorkletNode) {
      return false;
    }

    const worklet = this.audioContext.audioWorklet;
    if (!worklet?.addModule) {
      return false;
    }

    try {
      const processorModuleUrl = new URL(
        './voice/audioFrameProcessor.js',
        this.globalLike.location?.href ?? window.location.href,
      ).toString();
      await worklet.addModule(processorModuleUrl);
      this.audioWorkletNode = new this.globalLike.AudioWorkletNode(
        this.audioContext,
        'celcat-audio-frame-processor',
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: {
            bufferSize: 2048,
          },
        },
      );
      this.audioWorkletNode.port.onmessage = (event: MessageEvent<{
        type?: string;
        sampleRate?: number;
        samples?: Float32Array | number[];
      }>) => {
        if (event.data?.type !== 'audio-frame' || !event.data.samples?.length) {
          return;
        }

        const samples = event.data.samples instanceof Float32Array
          ? event.data.samples
          : new Float32Array(event.data.samples);
        this.handleCapturedAudioSamples(samples, event.data.sampleRate ?? this.audioContext!.sampleRate);
      };

      this.sourceNode.connect(this.audioWorkletNode);
      this.audioWorkletNode.connect(this.monitorNode ?? this.audioContext.destination);
      logDebug('voice', 'Realtime audio streaming pipeline created with AudioWorklet');
      return true;
    } catch (error: any) {
      logDebug('voice', 'AudioWorklet setup failed, falling back to ScriptProcessorNode', {
        message: error?.message || 'unknown error',
      });
      this.audioWorkletNode = null;
      return false;
    }
  }

  private startScriptProcessorStreaming(): void {
    if (!this.audioContext || !this.sourceNode) {
      return;
    }

    this.processorNode = this.audioContext.createScriptProcessor(2048, 1, 1);
    const monitorNode = this.monitorNode ?? this.audioContext.destination;
    logDebug('voice', 'Realtime audio streaming pipeline created with ScriptProcessorNode fallback');

    this.processorNode.onaudioprocess = (event) => {
      const inputSamples = event.inputBuffer.getChannelData(0);
      if (!inputSamples.length) {
        return;
      }

      this.handleCapturedAudioSamples(inputSamples, event.inputBuffer.sampleRate);
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(monitorNode);
  }

  private handleCapturedAudioSamples(inputSamples: Float32Array, sampleRate: number): void {
    this.updateFallbackRecorderState(inputSamples);
    const normalizedSamples = downsampleFloat32Samples(inputSamples, sampleRate, REALTIME_AUDIO_SAMPLE_RATE);
    if (!normalizedSamples.length) {
      return;
    }

    const mergedSamples = concatFloat32Samples(this.pendingRealtimeSamples, normalizedSamples);
    let readOffset = 0;

    while (mergedSamples.length - readOffset >= REALTIME_AUDIO_FRAME_SAMPLES) {
      const nextFrameSamples = mergedSamples.slice(readOffset, readOffset + REALTIME_AUDIO_FRAME_SAMPLES);
      this.appendRealtimeAudioFrame(nextFrameSamples);
      readOffset += REALTIME_AUDIO_FRAME_SAMPLES;
    }

    this.pendingRealtimeSamples = mergedSamples.slice(readOffset);
  }

  private createRecognition(): SpeechRecognitionLike {
    const Recognition = getSpeechRecognitionConstructor(this.globalLike as Record<string, unknown>);
    if (!Recognition) {
      throw new Error('当前环境不支持连续语音识别');
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'zh-CN';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      logDebug('voice', 'SpeechRecognition started');
      this.listening = true;
      this.error = '';
      this.interimTranscript = '正在聆听...';
      this.cancelAssistantSpeech();
      this.publish();
    };

    recognition.onresult = (event) => {
      const nextTranscript = extractTranscriptFromResultEvent(event);
      if (!nextTranscript.transcript) {
        return;
      }

      if (nextTranscript.isFinal) {
        logDebug('voice', 'SpeechRecognition produced final transcript', {
          transcript: truncateDebugText(nextTranscript.transcript),
        });
        void this.handleFinalTranscript(nextTranscript.transcript);
        return;
      }

      this.interimTranscript = nextTranscript.transcript;
      this.publish();
    };

    recognition.onerror = (event) => {
      logDebug('voice', 'SpeechRecognition emitted error', {
        error: event.error,
      });
      if (event.error === 'network' && this.mediaStream && this.globalLike.MediaRecorder) {
        this.activateFallbackTranscription('内置语音识别网络异常，已切换到本地转写。');
        return;
      }

      this.listening = false;
      this.interimTranscript = '';
      this.error = getRecognitionErrorMessage(event.error);
      this.publish();
    };

    recognition.onend = () => {
      logDebug('voice', 'SpeechRecognition ended', {
        manuallyStopped: this.manuallyStopped,
        usingFallbackTranscription: this.usingFallbackTranscription,
      });
      this.listening = this.usingFallbackTranscription;
      this.publish();

      if (this.manuallyStopped || this.error === '麦克风权限被拒绝' || this.usingFallbackTranscription) {
        return;
      }

      setTimeout(() => {
        try {
          recognition.start();
        } catch {
          // Ignore invalid restart attempts while the engine is already active.
        }
      }, 240);
    };

    return recognition;
  }

  private async handleFinalTranscript(transcript: string): Promise<void> {
    logDebug('voice', 'Submitting final transcript to main process', {
      transcript: truncateDebugText(transcript),
    });
    this.cancelAssistantSpeech();
    this.transcript = transcript;
    this.interimTranscript = '我在想怎么回应你...';
    this.error = '';
    this.callbacks.onFinalTranscript?.(transcript);
    this.publish();

    try {
      this.flushPendingRealtimeAudioFrame();
      await this.globalLike.electronAPI?.session?.commitInputAudio();
      await this.globalLike.electronAPI?.session?.submitUserTranscript(transcript);
      this.interimTranscript = '继续说，我在听。';
      this.publish();
    } catch (error: any) {
      this.interimTranscript = '';
      this.error = error?.message || '提交语音内容失败';
      this.publish();
    }
  }

  private activateFallbackTranscription(statusText: string): void {
    if (!this.mediaStream || !this.globalLike.MediaRecorder) {
      logDebug('voice', 'Fallback transcription could not start because MediaRecorder is unavailable');
      this.error = '当前环境的语音识别不可用';
      this.publish();
      return;
    }

    logDebug('voice', 'Fallback transcription activated', {
      statusText,
    });
    this.usingFallbackTranscription = true;
    this.listening = true;
    this.error = '';
    this.interimTranscript = statusText;
    this.publish();
  }

  private updateFallbackRecorderState(samples: Float32Array): void {
    if (!this.usingFallbackTranscription || !this.mediaStream || !this.globalLike.MediaRecorder) {
      return;
    }

    const now = Date.now();
    const rms = calculateRootMeanSquare(samples);
    const isSpeaking = rms >= 0.018;

    if (isSpeaking) {
      this.lastVoiceAt = now;
      if (!this.segmentRecording) {
        this.startSegmentRecording();
      }
      return;
    }

    if (!this.segmentRecording) {
      return;
    }

    const silenceElapsed = now - this.lastVoiceAt;
    const segmentElapsed = now - this.segmentStartedAt;
    if (silenceElapsed >= 850 || segmentElapsed >= 9000) {
      this.stopSegmentRecording();
    }
  }

  private startSegmentRecording(): void {
    if (!this.mediaStream || !this.globalLike.MediaRecorder || this.segmentRecording) {
      return;
    }

    this.recordedChunks = [];
    const preferredMimeType = this.getPreferredMimeType();
    this.mediaRecorder = preferredMimeType
      ? new this.globalLike.MediaRecorder(this.mediaStream, { mimeType: preferredMimeType })
      : new this.globalLike.MediaRecorder(this.mediaStream);

    this.mediaRecorder.addEventListener('dataavailable', (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    });

    this.mediaRecorder.addEventListener('stop', () => {
      void this.submitRecordedSegment();
    });

    this.segmentRecording = true;
    this.segmentStartedAt = Date.now();
    this.lastVoiceAt = this.segmentStartedAt;
    logDebug('voice', 'Started fallback speech segment recording', {
      mimeType: this.mediaRecorder.mimeType || 'default',
    });
    this.interimTranscript = '正在聆听并提交实时语音片段...';
    this.publish();
    this.mediaRecorder.start();
  }

  private stopSegmentRecording(): void {
    if (!this.segmentRecording) {
      return;
    }

    logDebug('voice', 'Stopping fallback speech segment recording');
    this.segmentRecording = false;
    this.mediaRecorder?.stop();
  }

  private async submitRecordedSegment(): Promise<void> {
    const mediaRecorder = this.mediaRecorder;
    this.mediaRecorder = null;

    if (!this.recordedChunks.length) {
      return;
    }

    const mimeType = mediaRecorder?.mimeType || 'audio/webm';
    const audioBlob = new Blob(this.recordedChunks, { type: mimeType });
    this.recordedChunks = [];

    try {
      logDebug('voice', 'Submitting fallback speech segment', {
        mimeType,
        size: audioBlob.size,
      });
      this.interimTranscript = '正在提交刚刚这段实时语音...';
      this.publish();
      this.flushPendingRealtimeAudioFrame();
      await this.globalLike.electronAPI?.session?.commitInputAudio();
      this.interimTranscript = '实时语音片段已发送，继续说，我在听。';
      this.publish();
    } catch (error: any) {
      logDebug('voice', 'Fallback speech segment submission failed', {
        message: error?.message || 'unknown error',
      });
      this.error = error?.message || '实时语音片段提交失败';
      this.interimTranscript = '';
      this.publish();
    }
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

  private cancelAssistantSpeech(): void {
    this.globalLike.speechSynthesis?.cancel?.();
  }

  private appendRealtimeAudioFrame(samples: Float32Array): void {
    const appendFrame = this.globalLike.electronAPI?.session?.appendInputAudioFrame(
      createAudioFramePayload({
        samples,
        sampleRate: REALTIME_AUDIO_SAMPLE_RATE,
        channels: 1,
      }),
    );

    appendFrame?.then(() => {
      this.appendFrameErrorLogged = false;
    }).catch((error: any) => {
      if (this.appendFrameErrorLogged) {
        return;
      }

      this.appendFrameErrorLogged = true;
      logDebug('voice', 'Failed to append realtime audio frame', {
        message: error?.message || 'unknown error',
      });
    });
  }

  private flushPendingRealtimeAudioFrame(): void {
    if (!this.pendingRealtimeSamples.length) {
      return;
    }

    this.appendRealtimeAudioFrame(this.pendingRealtimeSamples);
    this.pendingRealtimeSamples = new Float32Array(0);
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

function calculateRootMeanSquare(samples: Float32Array): number {
  let total = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    total += sample * sample;
  }

  return Math.sqrt(total / samples.length);
}
