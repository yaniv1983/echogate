// Optional RNNoise-based speech denoise. Lazily imports @shiguredo/rnnoise-wasm
// so it only ships to users who toggle the feature on. Input is resampled to
// 48 kHz mono (RNNoise's native rate), processed 480 samples per frame, then
// resampled back to the original rate.

const FRAME = 480;
const RNNOISE_SR = 48000;

const resampleLinear = (
  data: Float32Array,
  srcRate: number,
  dstRate: number,
): Float32Array => {
  if (srcRate === dstRate) return data;
  const ratio = dstRate / srcRate;
  const outLen = Math.floor(data.length * ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i / ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(data.length - 1, i0 + 1);
    const t = srcIdx - i0;
    out[i] = data[i0] * (1 - t) + data[i1] * t;
  }
  return out;
};

export const denoiseBuffer = async (buffer: AudioBuffer): Promise<AudioBuffer> => {
  const mod = await import('@shiguredo/rnnoise-wasm');
  const Rnnoise: any = (mod as any).Rnnoise ?? mod;
  const rnnoise = await Rnnoise.load();

  const sr = buffer.sampleRate;
  const ch = buffer.numberOfChannels;
  const OfflineCtx = (self as any).OfflineAudioContext;

  const processedChannels: Float32Array[] = [];
  for (let c = 0; c < ch; c++) {
    const src = buffer.getChannelData(c);
    const at48 = resampleLinear(src, sr, RNNOISE_SR);
    // Pad to multiple of FRAME
    const padded = new Float32Array(Math.ceil(at48.length / FRAME) * FRAME);
    padded.set(at48);

    const state = rnnoise.createDenoiseState();
    try {
      const frame = new Float32Array(FRAME);
      for (let i = 0; i < padded.length; i += FRAME) {
        // RNNoise expects int16 range floats
        for (let j = 0; j < FRAME; j++) frame[j] = padded[i + j] * 32768;
        state.processFrame(frame);
        for (let j = 0; j < FRAME; j++) padded[i + j] = frame[j] / 32768;
      }
    } finally {
      try {
        state.destroy();
      } catch {}
    }
    const trimmed = padded.subarray(0, at48.length);
    const back = resampleLinear(new Float32Array(trimmed), RNNOISE_SR, sr);
    processedChannels.push(back.subarray(0, src.length));
  }

  const ctx = new OfflineCtx(ch, buffer.length, sr);
  const out = ctx.createBuffer(ch, buffer.length, sr);
  for (let c = 0; c < ch; c++) {
    const chanOut = out.getChannelData(c);
    const clean = processedChannels[c];
    chanOut.set(clean.subarray(0, Math.min(clean.length, chanOut.length)));
  }
  return out;
};
