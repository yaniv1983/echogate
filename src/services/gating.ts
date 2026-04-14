// Pure gating / bleed-removal engine. No DOM / Web Audio dependencies so it can
// run inside a Web Worker. All I/O is plain Float32Array samples.

import type { ProcessingSettings, GatingResult, CalibrationProfile } from '../types';

// ---------- small helpers ----------
const gainToDb = (g: number) => 20 * Math.log10(Math.max(g, 1e-5));
const dbToGain = (db: number) => Math.pow(10, db / 20);

const rms = (data: Float32Array, start: number, end: number) => {
  let s = 0;
  for (let i = start; i < end; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, end - start));
};

// RBJ biquad, one-pole would be too gentle for presence split.
// Q=0.707 butterworth-ish.
const biquad = (
  data: Float32Array,
  sampleRate: number,
  type: 'hp' | 'lp',
  freq: number,
): Float32Array => {
  const Q = 0.707;
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === 'hp') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  }
  const B0 = b0 / a0,
    B1 = b1 / a0,
    B2 = b2 / a0,
    A1 = a1 / a0,
    A2 = a2 / a0;
  const out = new Float32Array(data.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x0 = data[i];
    const y0 = B0 * x0 + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
};

// Time-domain cross-correlation of two windows, searching ±maxLag samples.
// Returns the lag (samples) at which correlation peaks, and that peak value
// normalised to [-1,1] range.
const bestLag = (
  a: Float32Array,
  b: Float32Array,
  center: number,
  windowLen: number,
  maxLag: number,
): { lag: number; peak: number; norm: number } => {
  // Energy in the reference window of A
  let energyA = 0;
  const aStart = Math.max(0, center - windowLen / 2);
  const aEnd = Math.min(a.length, aStart + windowLen);
  for (let i = aStart; i < aEnd; i++) energyA += a[i] * a[i];

  let bestL = 0;
  let bestVal = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let dot = 0;
    let energyB = 0;
    for (let i = aStart; i < aEnd; i++) {
      const j = i + lag;
      if (j < 0 || j >= b.length) continue;
      const bv = b[j];
      dot += a[i] * bv;
      energyB += bv * bv;
    }
    const denom = Math.sqrt(energyA * energyB) || 1;
    const c = dot / denom;
    if (c > bestVal) {
      bestVal = c;
      bestL = lag;
    }
  }
  return { lag: bestL, peak: bestVal, norm: bestVal };
};

// ---------- level analysis ----------
const analyzeLevels = (
  data: Float32Array,
  sampleRate: number,
): { floorDb: number; speechDb: number } => {
  const win = Math.floor(sampleRate * 0.1);
  const dbs: number[] = [];
  for (let i = 0; i < data.length; i += win) {
    const end = Math.min(i + win, data.length);
    if (end - i < win / 2) continue;
    dbs.push(gainToDb(rms(data, i, end)));
  }
  dbs.sort((a, b) => a - b);
  const valid = dbs.filter((d) => d > -90);
  if (valid.length === 0) return { floorDb: -60, speechDb: -20 };
  const floorDb = valid[Math.floor(valid.length * 0.15)] ?? -60;
  const speechDb = valid[Math.floor(valid.length * 0.8)] ?? -20;
  return { floorDb, speechDb };
};

// ---------- auto calibration ----------
// Walk the audio in 50 ms blocks and find "solo" moments — frames where ONE
// channel is well above its floor and the others are quiet. Use those to
// measure bleed ratio, inter-mic lag and presence difference.
const calibrate = (
  channels: Float32Array[],
  hfChannels: Float32Array[],
  sampleRate: number,
  block: number,
  floorDb: number[],
  speechDb: number[],
): CalibrationProfile => {
  const n = channels.length;
  const len = channels[0].length;
  const blockCount = Math.floor(len / block);

  // Solo = active channel more than +15 dB above floor AND all others within
  //        +6 dB of their own floor.
  const soloActiveMargin = 15;
  const soloOthersMargin = 6;

  const bleedAcc: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const bleedCount: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const directPresAcc = new Array(n).fill(0);
  const directPresCount = new Array(n).fill(0);
  const bleedPresAcc = new Array(n).fill(0);
  const bleedPresCount = new Array(n).fill(0);
  const soloWindowCount = new Array(n).fill(0);

  // XCorr accumulators
  const lagAcc: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const lagCount: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const maxLag = Math.min(Math.floor(sampleRate * 0.005), 400); // 5 ms max

  for (let f = 0; f < blockCount; f++) {
    const s = f * block;
    const e = s + block;
    const rmsDb = new Array(n);
    const hfDb = new Array(n);
    for (let ch = 0; ch < n; ch++) {
      rmsDb[ch] = gainToDb(rms(channels[ch], s, e));
      hfDb[ch] = gainToDb(rms(hfChannels[ch], s, e));
    }

    for (let active = 0; active < n; active++) {
      if (rmsDb[active] < floorDb[active] + soloActiveMargin) continue;
      let ok = true;
      for (let other = 0; other < n; other++) {
        if (other === active) continue;
        if (rmsDb[other] > floorDb[other] + soloOthersMargin) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      soloWindowCount[active]++;
      // Presence of active channel (direct)
      directPresAcc[active] += hfDb[active] - rmsDb[active];
      directPresCount[active]++;
      // Bleed measurements on other channels
      for (let other = 0; other < n; other++) {
        if (other === active) continue;
        bleedAcc[active][other] += rmsDb[other];
        bleedCount[active][other]++;
        bleedPresAcc[other] += hfDb[other] - rmsDb[other];
        bleedPresCount[other]++;
        // XCorr to find lag
        const c = bestLag(
          channels[active],
          channels[other],
          s + block / 2,
          block,
          maxLag,
        );
        if (c.peak > 0.3) {
          lagAcc[active][other] += c.lag;
          lagCount[active][other]++;
        }
      }
    }
  }

  const bleedDb: number[][] = Array.from({ length: n }, () => new Array(n).fill(-60));
  const leadLagSamples: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0),
  );
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (bleedCount[i][j] > 0) bleedDb[i][j] = bleedAcc[i][j] / bleedCount[i][j];
      if (lagCount[i][j] > 0) leadLagSamples[i][j] = lagAcc[i][j] / lagCount[i][j];
    }
  }
  const directPresenceDb = directPresAcc.map((v, i) =>
    directPresCount[i] > 0 ? v / directPresCount[i] : -20,
  );
  const bleedPresenceDb = bleedPresAcc.map((v, i) =>
    bleedPresCount[i] > 0 ? v / bleedPresCount[i] : -30,
  );

  return {
    floorDb: [...floorDb],
    speechDb: [...speechDb],
    bleedDb,
    leadLagSamples,
    directPresenceDb,
    bleedPresenceDb,
    sampleRate,
    soloWindowCount,
  };
};

// ---------- main engine ----------
export interface GateInput {
  channels: Float32Array[]; // time-domain samples, one per speaker mic
  sampleRate: number;
  settings: ProcessingSettings;
}

export const processGating = (
  input: GateInput,
  onProgress: (p: number) => void,
): GatingResult => {
  const { channels, sampleRate, settings } = input;
  const n = channels.length;
  const length = channels[0].length;

  // ----- 1. Pre-filter: HF band for presence, HP for cleanup -----
  onProgress(2);
  const hfChannels = channels.map((c) => biquad(c, sampleRate, 'hp', 2000));
  // Lightly HP the "full" signal too so rumble doesn't fool RMS
  const fullChannels = channels.map((c) => biquad(c, sampleRate, 'hp', 80));

  // ----- 2. Level profile per channel -----
  onProgress(8);
  const perCh = fullChannels.map((c) => analyzeLevels(c, sampleRate));
  const floorDb = perCh.map((p) => p.floorDb);
  const speechDb = perCh.map((p) => p.speechDb);

  // ----- 3. Auto-calibration -----
  onProgress(12);
  const block = Math.floor(sampleRate * 0.05); // 50 ms
  const totalBlocks = Math.ceil(length / block);
  const calibration = calibrate(
    fullChannels,
    hfChannels,
    sampleRate,
    block,
    floorDb,
    speechDb,
  );

  // Adaptive thresholds based on calibration. If we measured real bleed
  // margin, use it; otherwise fall back to user setting.
  const measuredBleedMargin = (() => {
    let sum = 0,
      cnt = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (calibration.soloWindowCount[i] < 5) continue;
        // Margin = direct speech level - bleed level seen on other mic
        sum += speechDb[i] - calibration.bleedDb[i][j];
        cnt++;
      }
    }
    return cnt > 0 ? sum / cnt : NaN;
  })();

  const effectiveIsolationDb = !Number.isNaN(measuredBleedMargin)
    ? Math.max(3, Math.min(settings.isolationDb, measuredBleedMargin * 0.6))
    : settings.isolationDb;

  // ----- 4. Per-block feature extraction -----
  onProgress(18);
  const rmsDb: number[][] = Array.from({ length: n }, () => new Array(totalBlocks));
  const presenceDb: number[][] = Array.from({ length: n }, () =>
    new Array(totalBlocks),
  );
  for (let ch = 0; ch < n; ch++) {
    for (let f = 0; f < totalBlocks; f++) {
      const s = f * block;
      const e = Math.min(s + block, length);
      const fr = gainToDb(rms(fullChannels[ch], s, e));
      const hr = gainToDb(rms(hfChannels[ch], s, e));
      rmsDb[ch][f] = fr;
      presenceDb[ch][f] = hr - fr;
    }
    onProgress(18 + (ch / n) * 22);
  }

  // ----- 5. Pairwise XCorr per block for lead bias -----
  onProgress(40);
  const maxLag = Math.floor(sampleRate * 0.005);
  // leadBias[ch][f] = +dB if this channel is the leader in most pairs at frame f
  const leadBias: Float32Array[] = Array.from(
    { length: n },
    () => new Float32Array(totalBlocks),
  );
  if (settings.useCrossCorrelation) {
    for (let f = 0; f < totalBlocks; f++) {
      const s = f * block + block / 2;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const c = bestLag(fullChannels[i], fullChannels[j], s, block, maxLag);
          if (c.peak < 0.2) continue; // uncorrelated → no bias
          // Use calibrated lag as reference if available; else just sign
          const refLag = calibration.leadLagSamples[i][j];
          const diff = c.lag - refLag;
          // If current lag is close to calibrated "i-leads-j" value → i is source
          const absLagLimit = Math.max(5, maxLag / 2);
          if (Math.abs(diff) < absLagLimit) {
            leadBias[i][f] += 3; // i is the source
          } else if (Math.abs(-diff) < absLagLimit) {
            leadBias[j][f] += 3;
          } else if (c.lag > 2) {
            leadBias[i][f] += 1.5;
          } else if (c.lag < -2) {
            leadBias[j][f] += 1.5;
          }
        }
      }
      if (f % 500 === 0) onProgress(40 + (f / totalBlocks) * 20);
    }
  }

  // ----- 6. Per-frame decision -----
  onProgress(62);
  const STATE_NONE = -1;
  const STATE_MULTI = -2;

  const presenceWeight = settings.useSpectralCue ? 0.7 : 0; // dB equivalent
  const speakThresh = floorDb.map((f, i) => {
    const hard = settings.enableNoiseGate ? settings.thresholdDb : -80;
    return Math.max(f + 6, hard);
  });

  const targetStates = new Int16Array(totalBlocks);
  const multiHoldFrames = Math.max(1, Math.round(settings.multiHoldMs / 50));
  const holdFrames = Math.max(1, Math.round(settings.releaseMs / 50));
  let activeState = STATE_NONE;
  let holdTimer = 0;
  let multiCandidateCount = 0;
  let switchCount = 0;
  let overlapCount = 0;

  for (let f = 0; f < totalBlocks; f++) {
    const speaking: boolean[] = new Array(n);
    for (let ch = 0; ch < n; ch++) {
      speaking[ch] = rmsDb[ch][f] > speakThresh[ch];
    }
    const activeChs: number[] = [];
    for (let ch = 0; ch < n; ch++) if (speaking[ch]) activeChs.push(ch);

    let target: number;
    if (activeChs.length === 0) {
      target = STATE_NONE;
    } else if (activeChs.length === 1) {
      target = activeChs[0];
    } else {
      // Combined score per channel
      const score: number[] = new Array(n).fill(-Infinity);
      // Per-frame average presence across speaking channels (for normalisation)
      let avgPres = 0;
      for (const ch of activeChs) avgPres += presenceDb[ch][f];
      avgPres /= activeChs.length;

      for (const ch of activeChs) {
        let s = rmsDb[ch][f];
        s += presenceWeight * (presenceDb[ch][f] - avgPres);
        s += leadBias[ch][f];
        if (ch === activeState) s += settings.hysteresisDb;
        score[ch] = s;
      }
      // argmax + 2nd
      let top = activeChs[0],
        second = -1;
      for (const ch of activeChs)
        if (score[ch] > score[top]) {
          second = top;
          top = ch;
        } else if (second === -1 || score[ch] > score[second]) second = ch;

      const margin = second >= 0 ? score[top] - score[second] : Infinity;
      if (margin >= effectiveIsolationDb) target = top;
      else target = STATE_MULTI;
    }

    // Multi-hold: require N consecutive MULTI candidates
    if (target === STATE_MULTI) {
      multiCandidateCount++;
      if (multiCandidateCount < multiHoldFrames) {
        // Stick with current speaker
        target = activeState >= 0 ? activeState : STATE_MULTI;
        if (target === STATE_MULTI && multiCandidateCount === multiHoldFrames - 1) {
          // about to commit
        }
      }
    } else {
      multiCandidateCount = 0;
    }

    // None + hold: keep last speaker open while we're in the release window
    if (target === STATE_NONE && activeState !== STATE_NONE) {
      if (!settings.enableNoiseGate) {
        if (holdTimer > 0) {
          target = activeState;
          holdTimer--;
        } else {
          // ran out of hold
        }
      } else {
        if (holdTimer > 0) {
          target = activeState;
          holdTimer--;
        }
      }
    } else if (target !== STATE_NONE) {
      holdTimer = holdFrames;
    }

    if (target !== activeState) {
      if (target === STATE_MULTI) overlapCount++;
      else if (target !== STATE_NONE && activeState !== STATE_NONE) switchCount++;
      activeState = target;
    }
    targetStates[f] = target;
  }

  // ----- 7. Look-ahead: shift onsets earlier -----
  const lookAheadFrames = Math.max(0, Math.round(settings.lookAheadMs / 50));
  const shiftedStates = new Int16Array(totalBlocks);
  for (let f = 0; f < totalBlocks; f++) {
    // If any frame within [f, f+lookAhead] turns on a specific speaker, use that
    let s = targetStates[f];
    if (lookAheadFrames > 0) {
      const endLook = Math.min(totalBlocks - 1, f + lookAheadFrames);
      for (let k = f + 1; k <= endLook; k++) {
        const t = targetStates[k];
        // Prefer a concrete active speaker over NONE
        if (s === STATE_NONE && t !== STATE_NONE) {
          s = t;
          break;
        }
        // Prefer an imminent MULTI over single speaker if we were single
        if (s >= 0 && t === STATE_MULTI) {
          s = STATE_MULTI;
          break;
        }
      }
    }
    shiftedStates[f] = s;
  }

  // ----- 8. Build gain curves with duck + attack/release smoothing -----
  onProgress(82);
  const OPEN = 1.0;
  const MUTED = settings.duckDb > 0 ? dbToGain(-settings.duckDb) : 0.0;

  const rawCurves: Float32Array[] = Array.from(
    { length: n },
    () => new Float32Array(totalBlocks),
  );

  for (let f = 0; f < totalBlocks; f++) {
    const st = shiftedStates[f];
    for (let ch = 0; ch < n; ch++) {
      if (st === STATE_MULTI) {
        // In MULTI state, open a channel only if it is actually speaking
        rawCurves[ch][f] =
          rmsDb[ch][f] > floorDb[ch] + 6 ? OPEN : MUTED;
      } else if (st === ch) {
        rawCurves[ch][f] = OPEN;
      } else if (st === STATE_NONE) {
        rawCurves[ch][f] = MUTED;
      } else {
        rawCurves[ch][f] = MUTED;
      }
    }
  }

  // Asymmetric smoothing with true attack/release time constants
  const frameSec = 0.05;
  const attackAlpha =
    settings.attackMs > 0 ? 1 - Math.exp(-frameSec / (settings.attackMs / 1000)) : 1;
  const releaseAlpha =
    settings.releaseMs > 0
      ? 1 - Math.exp(-frameSec / (settings.releaseMs / 1000))
      : 1;

  const smoothCurves: Float32Array[] = rawCurves.map((raw) => {
    const out = new Float32Array(raw.length);
    let prev = raw[0];
    for (let i = 0; i < raw.length; i++) {
      const target = raw[i];
      const a = target > prev ? attackAlpha : releaseAlpha;
      prev = prev + (target - prev) * a;
      out[i] = prev;
    }
    return out;
  });

  // ----- 9. Assemble result -----
  onProgress(95);
  const result: GatingResult = {
    gainCurveA: smoothCurves[0],
    gainCurveB: smoothCurves[1],
    gainCurveC: smoothCurves[2],
    totalSwitches: switchCount,
    overlapPercentage: (overlapCount / Math.max(1, totalBlocks)) * 100,
    detectedLevels: {
      floorA: floorDb[0],
      floorB: floorDb[1],
      floorC: floorDb[2],
      speechA: speechDb[0],
      speechB: speechDb[1],
      speechC: speechDb[2],
    },
    curveSampleRate: 1 / frameSec, // 20 Hz
    calibration,
  };

  onProgress(100);
  return result;
};
