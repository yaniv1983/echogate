// Main-thread entry point. Prefers a Web Worker when available, falls back
// to in-thread processing. API-compatible with the old processAudioGatingAsync.

import type { ProcessingSettings, GatingResult } from '../types';
import { processGating } from './gating';
import type {
  GateWorkerRequest,
  GateWorkerProgress,
  GateWorkerDone,
  GateWorkerError,
} from '../workers/gateWorker';

let worker: Worker | null = null;
let nextId = 1;

const getWorker = (): Worker | null => {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/gateWorker.ts', import.meta.url), {
      type: 'module',
    });
    return worker;
  } catch (e) {
    console.warn('Web Worker unavailable, falling back to main-thread gating.', e);
    return null;
  }
};

export const processAudioGatingAsync = (
  buffers: AudioBuffer[],
  settings: ProcessingSettings,
  onProgress: (progress: number) => void,
): Promise<GatingResult> => {
  // Average all channels into mono per mic for analysis (stereo-aware).
  const channels: Float32Array[] = buffers.map((b) => {
    if (b.numberOfChannels === 1) return new Float32Array(b.getChannelData(0));
    const len = b.length;
    const out = new Float32Array(len);
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) out[i] += d[i];
    }
    const inv = 1 / b.numberOfChannels;
    for (let i = 0; i < len; i++) out[i] *= inv;
    return out;
  });

  const sampleRate = buffers[0].sampleRate;
  const input = { channels, sampleRate, settings };

  const w = getWorker();
  if (!w) {
    // Synchronous fallback in a microtask so UI can update
    return new Promise((resolve) => {
      setTimeout(() => resolve(processGating(input, onProgress)), 0);
    });
  }

  const id = nextId++;
  return new Promise<GatingResult>((resolve, reject) => {
    const handler = (
      e: MessageEvent<GateWorkerProgress | GateWorkerDone | GateWorkerError>,
    ) => {
      const data = e.data;
      if (data.id !== id) return;
      if (data.type === 'progress') onProgress(data.progress);
      else if (data.type === 'done') {
        w.removeEventListener('message', handler);
        resolve(data.result);
      } else {
        w.removeEventListener('message', handler);
        reject(new Error(data.error));
      }
    };
    w.addEventListener('message', handler);
    const req: GateWorkerRequest = { id, input };
    // Transfer channel buffers
    w.postMessage(
      req,
      channels.map((c) => c.buffer),
    );
  });
};
