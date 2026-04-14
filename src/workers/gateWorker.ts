/// <reference lib="webworker" />
import { processGating, GateInput } from '../services/gating';
import type { GatingResult } from '../types';

export interface GateWorkerRequest {
  id: number;
  input: GateInput;
}
export interface GateWorkerProgress {
  id: number;
  type: 'progress';
  progress: number;
}
export interface GateWorkerDone {
  id: number;
  type: 'done';
  result: GatingResult;
}
export interface GateWorkerError {
  id: number;
  type: 'error';
  error: string;
}

self.onmessage = (e: MessageEvent<GateWorkerRequest>) => {
  const { id, input } = e.data;
  try {
    const result = processGating(input, (p) => {
      const msg: GateWorkerProgress = { id, type: 'progress', progress: p };
      (self as any).postMessage(msg);
    });

    // Transfer gain curve buffers back to avoid copy.
    const transfer: Transferable[] = [
      result.gainCurveA.buffer as ArrayBuffer,
      result.gainCurveB.buffer as ArrayBuffer,
    ];
    if (result.gainCurveC) transfer.push(result.gainCurveC.buffer as ArrayBuffer);

    const msg: GateWorkerDone = { id, type: 'done', result };
    (self as any).postMessage(msg, transfer);
  } catch (err: any) {
    const msg: GateWorkerError = {
      id,
      type: 'error',
      error: err?.message || String(err),
    };
    (self as any).postMessage(msg);
  }
};
