// Mic float32 -> 16-bit PCM, batched into ~50ms chunks.
//
// An AudioWorklet, not a ScriptProcessorNode: the deprecated node runs
// on the main thread and drops audio whenever React (or anything else)
// is busy, which shows up as mid-word gaps in the transcript rather
// than as an obvious error.
//
// Also emits a peak level per chunk so the page can draw a real meter
// instead of a fake one.
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunkSamples = options.processorOptions.chunkSamples;
    this.buf = new Int16Array(this.chunkSamples);
    this.filled = 0;
    this.peak = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    // No input yet (or the track ended) — keep the node alive.
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      const magnitude = sample < 0 ? -sample : sample;
      if (magnitude > this.peak) this.peak = magnitude;
      // Asymmetric scaling: int16 range is -32768..32767, so using
      // 0x8000 for both signs clips the loudest positive sample.
      this.buf[this.filled] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.filled += 1;

      if (this.filled === this.chunkSamples) {
        this.port.postMessage({ pcm: this.buf.slice(), peak: this.peak });
        this.filled = 0;
        this.peak = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
