class CelcatAudioFrameProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const configuredBufferSize = options?.processorOptions?.bufferSize;
    this.bufferSize = Number.isFinite(configuredBufferSize) && configuredBufferSize > 0
      ? configuredBufferSize
      : 2048;
    this.pendingSamples = new Float32Array(this.bufferSize);
    this.pendingOffset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const channelData = input?.[0];

    if (channelData?.length) {
      this.pushSamples(channelData);
    }

    if (output?.length) {
      for (const channel of output) {
        channel.fill(0);
      }
    }

    return true;
  }

  pushSamples(channelData) {
    let readOffset = 0;

    while (readOffset < channelData.length) {
      const availableSpace = this.bufferSize - this.pendingOffset;
      const remainingSamples = channelData.length - readOffset;
      const copyLength = Math.min(availableSpace, remainingSamples);

      this.pendingSamples.set(
        channelData.subarray(readOffset, readOffset + copyLength),
        this.pendingOffset,
      );

      this.pendingOffset += copyLength;
      readOffset += copyLength;

      if (this.pendingOffset === this.bufferSize) {
        const transferredSamples = this.pendingSamples.slice(0);
        this.port.postMessage(
          {
            type: 'audio-frame',
            sampleRate,
            samples: transferredSamples,
          },
          [transferredSamples.buffer],
        );
        this.pendingOffset = 0;
      }
    }
  }
}

registerProcessor('celcat-audio-frame-processor', CelcatAudioFrameProcessor);
