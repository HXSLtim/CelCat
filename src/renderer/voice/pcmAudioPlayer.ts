type AudioContextLike = typeof AudioContext;

type AudioGlobalLike = {
  AudioContext?: AudioContextLike;
  webkitAudioContext?: AudioContextLike;
};

export type PcmAudioChunk = {
  pcmBase64: string;
  sampleRate: number;
  channels: number;
  format: 'pcm_s16le';
};

export type PcmPlaybackSchedule = {
  startDelayMs: number;
  durationMs: number;
  level: number;
};

const ANALYSER_FFT_SIZE = 2048;
const LEVEL_FLOOR = 0.008;
const LEVEL_BOOST = 5;
const PLAYBACK_TAIL_PADDING_MS = 260;

export class PcmAudioPlayer {
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private analyserBuffer: Float32Array | null = null;
  private outputNode: GainNode | null = null;
  private nextPlaybackTime = 0;
  private activePlaybackUntil = 0;
  private smoothedLevel = 0;

  constructor(private readonly globalLike: AudioGlobalLike) {}

  async play(chunk: PcmAudioChunk): Promise<PcmPlaybackSchedule | null> {
    if (chunk.format !== 'pcm_s16le') {
      return null;
    }

    const audioContext = await this.ensureAudioContext();
    if (!audioContext) {
      return null;
    }

    const channelData = decodePcmS16Le(chunk.pcmBase64, chunk.channels);
    if (!channelData.length || !channelData[0]?.length) {
      return null;
    }

    const frameCount = channelData[0].length;
    const audioBuffer = audioContext.createBuffer(chunk.channels, frameCount, chunk.sampleRate);
    for (let channelIndex = 0; channelIndex < chunk.channels; channelIndex += 1) {
      audioBuffer.getChannelData(channelIndex).set(channelData[channelIndex] ?? channelData[0]);
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputNode ?? audioContext.destination);

    const startAt = Math.max(audioContext.currentTime, this.nextPlaybackTime);
    source.start(startAt);
    this.nextPlaybackTime = startAt + audioBuffer.duration;
    const outputLatencyMs = getAudioOutputLatencyMs(audioContext);
    this.activePlaybackUntil = Math.max(
      this.activePlaybackUntil,
      startAt + audioBuffer.duration + outputLatencyMs / 1000 + PLAYBACK_TAIL_PADDING_MS / 1000,
    );

    return {
      startDelayMs: Math.max(0, (startAt - audioContext.currentTime) * 1000) + outputLatencyMs,
      durationMs: audioBuffer.duration * 1000 + PLAYBACK_TAIL_PADDING_MS,
      level: measureChannelDataLevel(channelData),
    };
  }

  getCurrentLevel(): number {
    if (!this.audioContext || !this.analyserNode || !this.analyserBuffer) {
      return 0;
    }

    this.analyserNode.getFloatTimeDomainData(this.analyserBuffer as unknown as Float32Array<ArrayBuffer>);
    const rms = measureRms(this.analyserBuffer);
    const measuredLevel = normalizeLevel(rms);
    const playbackActive = this.audioContext.currentTime < this.activePlaybackUntil;

    let targetLevel = measuredLevel;
    if (playbackActive && targetLevel < LEVEL_FLOOR) {
      targetLevel = Math.max(LEVEL_FLOOR, this.smoothedLevel * 0.92);
    }

    const smoothing = targetLevel > this.smoothedLevel ? 0.58 : 0.18;
    this.smoothedLevel += (targetLevel - this.smoothedLevel) * smoothing;

    if (!playbackActive && measuredLevel < LEVEL_FLOOR && this.smoothedLevel < LEVEL_FLOOR) {
      this.smoothedLevel = 0;
    }

    return Math.max(0, Math.min(1, this.smoothedLevel));
  }

  reset(): void {
    this.nextPlaybackTime = this.audioContext?.currentTime ?? 0;
    this.activePlaybackUntil = this.nextPlaybackTime;
    this.smoothedLevel = 0;
  }

  private async ensureAudioContext(): Promise<AudioContext | null> {
    if (!this.audioContext) {
      const AudioContextConstructor = this.globalLike.AudioContext ?? this.globalLike.webkitAudioContext;
      if (!AudioContextConstructor) {
        return null;
      }

      this.audioContext = new AudioContextConstructor();
      if (typeof this.audioContext.createGain === 'function' && typeof this.audioContext.createAnalyser === 'function') {
        this.outputNode = this.audioContext.createGain();
        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = ANALYSER_FFT_SIZE;
        this.analyserBuffer = new Float32Array(this.analyserNode.fftSize);
        this.outputNode.connect(this.analyserNode);
        this.analyserNode.connect(this.audioContext.destination);
      }
      this.nextPlaybackTime = this.audioContext.currentTime;
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    return this.audioContext;
  }
}

function decodePcmS16Le(base64: string, channels: number): Float32Array[] {
  if (!base64 || channels <= 0) {
    return [];
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const samples = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const frameCount = Math.floor(samples.length / channels);
  const channelData = Array.from({ length: channels }, () => new Float32Array(frameCount));

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      const sample = samples[frameIndex * channels + channelIndex] ?? 0;
      channelData[channelIndex][frameIndex] = sample / 0x8000;
    }
  }

  return channelData;
}

function measureChannelDataLevel(channelData: Float32Array[]): number {
  let total = 0;
  let count = 0;

  for (const channel of channelData) {
    for (let index = 0; index < channel.length; index += 1) {
      const sample = channel[index] ?? 0;
      total += sample * sample;
      count += 1;
    }
  }

  if (!count) {
    return 0;
  }

  return normalizeLevel(Math.sqrt(total / count));
}

function measureRms(samples: Float32Array): number {
  let total = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    total += sample * sample;
  }

  if (!samples.length) {
    return 0;
  }

  return Math.sqrt(total / samples.length);
}

function normalizeLevel(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, rms * LEVEL_BOOST));
}

function getAudioOutputLatencyMs(audioContext: AudioContext): number {
  const baseLatency = Number.isFinite(audioContext.baseLatency) ? audioContext.baseLatency : 0;
  const outputLatency = Number.isFinite((audioContext as AudioContext & { outputLatency?: number }).outputLatency)
    ? (audioContext as AudioContext & { outputLatency?: number }).outputLatency ?? 0
    : 0;

  return (baseLatency + outputLatency) * 1000;
}
