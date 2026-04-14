import type { FillerMarker } from '../types';

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

// --- DSP CHAIN FOR "PROCESSED" EXPORT ---
export const applyProcessingChain = async (
  buffer: AudioBuffer,
  gainCurve: Float32Array | null,
  enhance: boolean,
  autoLevel: boolean,
): Promise<AudioBuffer> => {
  const offlineCtx = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  let lastNode: AudioNode = source;

  if (gainCurve) {
    const gateGain = offlineCtx.createGain();
    gateGain.gain.setValueCurveAtTime(gainCurve, 0, buffer.duration);
    lastNode.connect(gateGain);
    lastNode = gateGain;
  }

  if (enhance) {
    const hpf = offlineCtx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 80;
    hpf.Q.value = 0.7;
    lastNode.connect(hpf);
    lastNode = hpf;

    const presence = offlineCtx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3500;
    presence.gain.value = 2.5;
    presence.Q.value = 1.0;
    lastNode.connect(presence);
    lastNode = presence;

    const comp = offlineCtx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.knee.value = 30;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    lastNode.connect(comp);
    lastNode = comp;
  }

  if (autoLevel) {
    const data = buffer.getChannelData(0);
    const rms = calculateRMS(data);
    const currentDb = gainToDb(rms);
    const targetDb = -16;
    let gainNeeded = targetDb - currentDb;
    gainNeeded = Math.max(-5, Math.min(gainNeeded, 15));

    const makeupGain = offlineCtx.createGain();
    makeupGain.gain.value = dbToGain(gainNeeded);
    lastNode.connect(makeupGain);
    lastNode = makeupGain;

    const limiter = offlineCtx.createDynamicsCompressor();
    limiter.threshold.value = -1.0;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    lastNode.connect(limiter);
    lastNode = limiter;
  }

  lastNode.connect(offlineCtx.destination);
  source.start(0);
  return await offlineCtx.startRendering();
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
