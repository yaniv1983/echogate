// ITU-R BS.1770-4 / EBU R128 integrated loudness measurement.
// K-weighting = two cascaded biquads (high-shelf + high-pass) applied to each
// channel, then mean-square per 400 ms block with 75% overlap, then absolute
// gating at -70 LUFS and relative gating at -10 LU below the first-pass mean.

const applyBiquad = (
  data: Float32Array,
  b0: number,
  b1: number,
  b2: number,
  a1: number,
  a2: number,
): Float32Array => {
  const out = new Float32Array(data.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
};

// Coefficients from BS.1770-4 (normalised to 48 kHz). For other sample rates
// we re-derive at the target rate (good enough for +/- a few % difference).
const kWeight = (data: Float32Array, sampleRate: number): Float32Array => {
  // Stage 1: high shelf +4 dB @ ~1681.97 Hz
  const sr = sampleRate;
  {
    const f0 = 1681.97445095;
    const G = 3.999843853;
    const Q = 0.7071752369;
    const A = Math.pow(10, G / 40);
    const w0 = (2 * Math.PI * f0) / sr;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    const alpha = sin / (2 * Q);
    const b0 = A * (A + 1 + (A - 1) * cos + 2 * Math.sqrt(A) * alpha);
    const b1 = -2 * A * (A - 1 + (A + 1) * cos);
    const b2 = A * (A + 1 + (A - 1) * cos - 2 * Math.sqrt(A) * alpha);
    const a0 = A + 1 - (A - 1) * cos + 2 * Math.sqrt(A) * alpha;
    const a1 = 2 * (A - 1 - (A + 1) * cos);
    const a2 = A + 1 - (A - 1) * cos - 2 * Math.sqrt(A) * alpha;
    data = applyBiquad(data, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
  }
  // Stage 2: high pass @ ~38.13 Hz, Q 0.5
  {
    const f0 = 38.13547087;
    const Q = 0.5003270373;
    const w0 = (2 * Math.PI * f0) / sr;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    const alpha = sin / (2 * Q);
    const b0 = (1 + cos) / 2;
    const b1 = -(1 + cos);
    const b2 = (1 + cos) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cos;
    const a2 = 1 - alpha;
    data = applyBiquad(data, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
  }
  return data;
};

export const integratedLufs = (buffer: AudioBuffer): number => {
  const sr = buffer.sampleRate;
  const ch = buffer.numberOfChannels;
  // K-weight each channel
  const weighted: Float32Array[] = [];
  for (let c = 0; c < ch; c++) {
    weighted.push(kWeight(new Float32Array(buffer.getChannelData(c)), sr));
  }
  const blockSamples = Math.round(sr * 0.4); // 400 ms
  const hopSamples = Math.round(sr * 0.1); // 100 ms (75% overlap)
  const blockCount = Math.max(
    0,
    Math.floor((buffer.length - blockSamples) / hopSamples) + 1,
  );
  if (blockCount <= 0) return -70;
  const blockLoudness = new Float32Array(blockCount);

  // Channel weighting G_i (mono/stereo = 1.0 for L,R)
  const chWeight = (c: number) => 1.0;

  for (let b = 0; b < blockCount; b++) {
    const start = b * hopSamples;
    let sum = 0;
    for (let c = 0; c < ch; c++) {
      const w = chWeight(c);
      const d = weighted[c];
      let s = 0;
      for (let i = 0; i < blockSamples; i++) {
        const v = d[start + i];
        s += v * v;
      }
      sum += w * (s / blockSamples);
    }
    blockLoudness[b] = -0.691 + 10 * Math.log10(sum + 1e-20);
  }

  // Absolute gate at -70 LUFS
  const gatedAbs: number[] = [];
  for (let i = 0; i < blockCount; i++) {
    if (blockLoudness[i] >= -70) gatedAbs.push(i);
  }
  if (gatedAbs.length === 0) return -70;

  // Relative gate at -10 LU below ungated mean
  const meanAbs = (() => {
    let s = 0;
    for (const i of gatedAbs) s += Math.pow(10, blockLoudness[i] / 10);
    const m = s / gatedAbs.length;
    return -0.691 + 10 * Math.log10(m + 1e-20);
  })();
  const relThresh = meanAbs - 10;
  const gatedFinal: number[] = [];
  for (const i of gatedAbs) if (blockLoudness[i] >= relThresh) gatedFinal.push(i);
  if (gatedFinal.length === 0) return meanAbs;
  let s = 0;
  for (const i of gatedFinal) s += Math.pow(10, blockLoudness[i] / 10);
  const m = s / gatedFinal.length;
  return -0.691 + 10 * Math.log10(m + 1e-20);
};
