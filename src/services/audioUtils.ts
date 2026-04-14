import type { FillerMarker } from '../types';
import { integratedLufs } from './lufs';
import { truncateSilence as truncateSilenceImpl } from './silence';
import { denoiseBuffer } from './denoise';

// ---------- small helpers kept for the UI / export paths ----------
export const decodeAudio = async (
  file: File,
  context: AudioContext,
): Promise<AudioBuffer> => {
  const arrayBuffer = await file.arrayBuffer();
  return await context.decodeAudioData(arrayBuffer);
};

export const getPeaks = (buffer: AudioBuffer, samplesPerPixel: number): number[] => {
  const data = buffer.getChannelData(0);
  const peaks: number[] = [];
  const length = data.length;
  for (let i = 0; i < length; i += samplesPerPixel) {
    let min = 1.0;
    let max = -1.0;
    for (let j = 0; j < samplesPerPixel; j++) {
      if (i + j < length) {
        const val = data[i + j];
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }
    peaks.push(Math.max(Math.abs(min), Math.abs(max)));
  }
  return peaks;
};

const calculateRMS = (data: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
};

const gainToDb = (gain: number): number => 20 * Math.log10(Math.max(gain, 0.00001));
const dbToGain = (db: number): number => Math.pow(10, db / 20);

// Re-export the main gating entry point from the worker client so existing
// imports of processAudioGatingAsync from audioUtils.ts keep working.
export { processAudioGatingAsync } from './gatingClient';

// Internal: run gate-curve + Enhance chain on a buffer. No loudness stage.
// Returns a new AudioBuffer at the same rate/length as input.
const renderEnhanceChain = async (
  buffer: AudioBuffer,
  gainCurve: Float32Array | null,
  enhance: boolean,
  makeupDb: number,
  limit: boolean,
): Promise<AudioBuffer> => {
  const ctx = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
  );
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  let last: AudioNode = source;

  if (gainCurve) {
    const g = ctx.createGain();
    g.gain.setValueCurveAtTime(gainCurve, 0, buffer.duration);
    last.connect(g);
    last = g;
  }

  if (enhance) {
    // HPF 100 Hz (rumble)
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 100;
    hpf.Q.value = 0.7;
    last.connect(hpf);
    last = hpf;
    // Presence +3 @ 3.5 kHz
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3500;
    presence.gain.value = 3;
    presence.Q.value = 1.0;
    last.connect(presence);
    last = presence;
    // Air +2 @ 6 kHz
    const air = ctx.createBiquadFilter();
    air.type = 'peaking';
    air.frequency.value = 6000;
    air.gain.value = 2;
    air.Q.value = 0.9;
    last.connect(air);
    last = air;
    // De-ess -1.5 @ 8 kHz
    const deess = ctx.createBiquadFilter();
    deess.type = 'peaking';
    deess.frequency.value = 8000;
    deess.gain.value = -1.5;
    deess.Q.value = 2.5;
    last.connect(deess);
    last = deess;
    // R-Vox-style compand approximation
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.knee.value = 30;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    last.connect(comp);
    last = comp;
  }

  if (makeupDb !== 0) {
    const g = ctx.createGain();
    g.gain.value = dbToGain(makeupDb);
    last.connect(g);
    last = g;
  }

  if (limit) {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.0;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    last.connect(limiter);
    last = limiter;
  }

  last.connect(ctx.destination);
  source.start(0);
  return await ctx.startRendering();
};

// Public entry: full export chain with optional RNNoise denoise + BS.1770
// two-pass auto-level @ -14 LUFS + optional silence truncation.
export interface ChainOptions {
  enhance: boolean;
  autoLevel: boolean;
  denoise: boolean;
  truncateSilence: boolean;
  onProgress?: (stage: string, pct: number) => void;
}

export const applyProcessingChain = async (
  buffer: AudioBuffer,
  gainCurve: Float32Array | null,
  optsOrEnhance: ChainOptions | boolean,
  autoLevelLegacy?: boolean,
): Promise<AudioBuffer> => {
  // Back-compat: old signature applyProcessingChain(buf, curve, enhance, autoLevel)
  const opts: ChainOptions =
    typeof optsOrEnhance === 'boolean'
      ? {
          enhance: optsOrEnhance,
          autoLevel: !!autoLevelLegacy,
          denoise: false,
          truncateSilence: false,
        }
      : optsOrEnhance;

  const progress = (stage: string, pct: number) =>
    opts.onProgress && opts.onProgress(stage, pct);

  let working = buffer;

  // 1. Optional RNNoise denoise (pre-everything, so gate + EQ see clean signal).
  if (opts.denoise) {
    progress('Neural denoise (RNNoise)...', 5);
    try {
      working = await denoiseBuffer(working);
    } catch (e) {
      console.warn('RNNoise unavailable — skipping denoise step.', e);
    }
  }

  // 2. First pass: gate + enhance, no makeup, no limiter — so we can measure
  //    clean integrated loudness of the post-EQ signal.
  progress('Enhance chain...', 30);
  const firstPass = await renderEnhanceChain(
    working,
    gainCurve,
    opts.enhance,
    0,
    false,
  );

  // 3. Auto-level: measure LUFS and compute makeup gain to -14 LUFS.
  let finalBuf = firstPass;
  if (opts.autoLevel) {
    progress('Measuring loudness (LUFS)...', 55);
    const lufs = integratedLufs(firstPass);
    const targetLufs = -14;
    let makeup = targetLufs - lufs;
    // clamp to avoid absurd boosts of near-silent tracks
    makeup = Math.max(-6, Math.min(makeup, 18));
    progress('Applying -14 LUFS + limiter...', 70);
    finalBuf = await renderEnhanceChain(working, gainCurve, opts.enhance, makeup, true);
  } else if (opts.enhance) {
    // Enhance without auto-level still benefits from the safety limiter.
    progress('Applying limiter...', 70);
    finalBuf = await renderEnhanceChain(working, gainCurve, opts.enhance, 0, true);
  }

  // 4. Optional silence truncation — changes duration, so gated behind a
  //    user flag (off by default to preserve video sync).
  if (opts.truncateSilence) {
    progress('Truncating silences...', 90);
    finalBuf = truncateSilenceImpl(finalBuf, {
      thresholdDb: -50,
      maxSilenceMs: 500,
      fadeMs: 5,
    });
  }

  progress('Done', 100);
  return finalBuf;
};

// ---------- WAV writer + filler-marker support ----------
const padToEven = (len: number) => len + (len % 2);

export const bufferToWave = (
  abuffer: AudioBuffer,
  len: number,
  markers: FillerMarker[] = [],
): Blob => {
  const numOfChan = abuffer.numberOfChannels;
  const sampleRate = abuffer.sampleRate;

  const dataByteLength = len * numOfChan * 2;
  const pcmBuffer = new ArrayBuffer(dataByteLength);
  const pcmView = new DataView(pcmBuffer);

  const channels: Float32Array[] = [];
  for (let i = 0; i < numOfChan; i++) channels.push(abuffer.getChannelData(i));

  let pos = 0;
  let offset = 0;
  while (offset < len) {
    for (let i = 0; i < numOfChan; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      pcmView.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  const chunks: ArrayBuffer[] = [];

  const fmtData = new ArrayBuffer(16);
  const fmtView = new DataView(fmtData);
  fmtView.setUint16(0, 1, true);
  fmtView.setUint16(2, numOfChan, true);
  fmtView.setUint32(4, sampleRate, true);
  fmtView.setUint32(8, sampleRate * 2 * numOfChan, true);
  fmtView.setUint16(12, numOfChan * 2, true);
  fmtView.setUint16(14, 16, true);
  chunks.push(createChunk('fmt ', fmtData));

  if (markers.length > 0) {
    const numCues = markers.length;
    const cueSize = 4 + 24 * numCues;
    const cueData = new ArrayBuffer(cueSize);
    const cueView = new DataView(cueData);
    cueView.setUint32(0, numCues, true);
    markers.forEach((m, i) => {
      const ptr = 4 + i * 24;
      const samplePos = Math.floor(m.start * sampleRate);
      cueView.setUint32(ptr, i + 1, true);
      cueView.setUint32(ptr + 4, samplePos, true);
      cueView.setUint32(ptr + 8, 0x61746164, true);
      cueView.setUint32(ptr + 12, 0, true);
      cueView.setUint32(ptr + 16, 0, true);
      cueView.setUint32(ptr + 20, samplePos, true);
    });
    chunks.push(createChunk('cue ', cueData));

    const adtlSubChunks: ArrayBuffer[] = [];
    markers.forEach((m, i) => {
      const text = m.word;
      const contentSize = 4 + text.length + 1;
      const paddedContentSize = padToEven(contentSize);
      const lablBuf = new ArrayBuffer(4 + 4 + paddedContentSize);
      const v = new DataView(lablBuf);
      writeString(v, 0, 'labl');
      v.setUint32(4, contentSize, true);
      v.setUint32(8, i + 1, true);
      for (let k = 0; k < text.length; k++) v.setUint8(12 + k, text.charCodeAt(k));
      v.setUint8(12 + text.length, 0);
      adtlSubChunks.push(lablBuf);
    });
    const adtlBodySize = 4 + adtlSubChunks.reduce((acc, c) => acc + c.byteLength, 0);
    const listData = new ArrayBuffer(adtlBodySize);
    const listView = new DataView(listData);
    const listArr = new Uint8Array(listData);
    writeString(listView, 0, 'adtl');
    let ptr = 4;
    adtlSubChunks.forEach((sub) => {
      listArr.set(new Uint8Array(sub), ptr);
      ptr += sub.byteLength;
    });
    chunks.push(createChunk('LIST', listData));
  }

  chunks.push(createChunk('data', pcmBuffer));

  const totalFileSize = 4 + chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const riffHead = new ArrayBuffer(12);
  const riffView = new DataView(riffHead);
  writeString(riffView, 0, 'RIFF');
  riffView.setUint32(4, totalFileSize, true);
  writeString(riffView, 8, 'WAVE');

  return new Blob([riffHead, ...chunks], { type: 'audio/wav' });
};

const createChunk = (type: string, data: ArrayBuffer): ArrayBuffer => {
  const dataLen = data.byteLength;
  const paddedLen = padToEven(dataLen);
  const header = new ArrayBuffer(8);
  const v = new DataView(header);
  writeString(v, 0, type);
  v.setUint32(4, dataLen, true);
  const chunk = new Uint8Array(8 + paddedLen);
  chunk.set(new Uint8Array(header), 0);
  chunk.set(new Uint8Array(data), 8);
  return chunk.buffer;
};

const writeString = (view: DataView, offset: number, str: string) => {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
};
