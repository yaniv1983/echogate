// Simple silence truncation. Scans the buffer in 20 ms windows, marks any run
// longer than maxSilenceMs where RMS is below thresholdDb, and shrinks each
// such run to maxSilenceMs. Keeps a small fade to avoid clicks at the splice
// points. Off by default — enabling it changes timing so downstream video
// sync breaks.

const rms = (d: Float32Array, s: number, e: number) => {
  let x = 0;
  for (let i = s; i < e; i++) x += d[i] * d[i];
  return Math.sqrt(x / Math.max(1, e - s));
};

export const truncateSilence = (
  buffer: AudioBuffer,
  opts: {
    thresholdDb?: number;
    maxSilenceMs?: number;
    fadeMs?: number;
  } = {},
): AudioBuffer => {
  const thr = Math.pow(10, (opts.thresholdDb ?? -50) / 20);
  const maxSilenceMs = opts.maxSilenceMs ?? 500;
  const fadeMs = opts.fadeMs ?? 5;

  const sr = buffer.sampleRate;
  const ch = buffer.numberOfChannels;
  const win = Math.floor(sr * 0.02); // 20 ms
  const maxSilenceSamples = Math.floor((maxSilenceMs / 1000) * sr);
  const fadeSamples = Math.floor((fadeMs / 1000) * sr);
  const len = buffer.length;

  // Use channel 0 to detect silence (same decision across channels).
  const probe = buffer.getChannelData(0);
  const silent: boolean[] = [];
  for (let i = 0; i < len; i += win) {
    silent.push(rms(probe, i, Math.min(i + win, len)) < thr);
  }

  // Build list of (keepStart, keepEnd) segments.
  type Seg = { start: number; end: number };
  const segments: Seg[] = [];
  let runStart = 0;
  let inSilence = silent[0];
  for (let i = 1; i <= silent.length; i++) {
    const isSilent = i === silent.length ? !inSilence : silent[i];
    if (isSilent !== inSilence) {
      const sampleStart = runStart * win;
      const sampleEnd = Math.min(i * win, len);
      if (inSilence) {
        const runLen = sampleEnd - sampleStart;
        if (runLen > maxSilenceSamples) {
          segments.push({ start: sampleStart, end: sampleStart + maxSilenceSamples });
        } else {
          segments.push({ start: sampleStart, end: sampleEnd });
        }
      } else {
        segments.push({ start: sampleStart, end: sampleEnd });
      }
      runStart = i;
      inSilence = isSilent;
    }
  }

  const totalLen = segments.reduce((a, s) => a + (s.end - s.start), 0);
  if (totalLen >= len) return buffer; // nothing to trim

  // Web Audio AudioBuffer.copyToChannel isn't available in the standalone
  // OfflineAudioContext ctor without a context; construct via a throwaway one.
  const OfflineCtx = (self as any).OfflineAudioContext;
  const ctx = new OfflineCtx(ch, totalLen, sr);
  const out = ctx.createBuffer(ch, totalLen, sr);

  for (let c = 0; c < ch; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    let offset = 0;
    for (const seg of segments) {
      const segLen = seg.end - seg.start;
      dst.set(src.subarray(seg.start, seg.end), offset);
      // Fade in/out at splice points to hide discontinuities
      const f = Math.min(fadeSamples, segLen / 2);
      for (let i = 0; i < f; i++) {
        const g = i / f;
        dst[offset + i] *= g;
        dst[offset + segLen - 1 - i] *= g;
      }
      offset += segLen;
    }
  }
  return out;
};
