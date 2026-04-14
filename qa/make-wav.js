// Generates two synthetic WAV files that simulate two speakers on two close
// mics with bleed. Each speaker talks alternately; each mic picks up both
// sources but the off-mic speaker is attenuated (~ -10 dB) with a small lag.
import fs from 'node:fs';
import path from 'node:path';

const SR = 48000;
const DUR = 8; // seconds
const N = SR * DUR;

// Speaker envelope generators — speech-like amplitude modulation
const env = (t, start, stop) => {
  if (t < start || t > stop) return 0;
  // burst of syllables
  const local = t - start;
  const syl = 0.5 + 0.5 * Math.sin(2 * Math.PI * 5 * local);
  const carrier = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.7 * local);
  return syl * carrier;
};

const speakerA = (t) => env(t, 0.3, 2.2) + env(t, 4.0, 5.5);
const speakerB = (t) => env(t, 2.5, 3.8) + env(t, 6.0, 7.7);

// Voice timbre: fundamental + harmonics, noise
const tone = (t, f0) => {
  let s = 0;
  s += Math.sin(2 * Math.PI * f0 * t);
  s += 0.5 * Math.sin(2 * Math.PI * f0 * 2 * t);
  s += 0.25 * Math.sin(2 * Math.PI * f0 * 3 * t);
  s += 0.1 * (Math.random() - 0.5);
  return s;
};

// Inter-mic lag: 1.5 ms ≈ 72 samples at 48k
const LAG_SAMPLES = 72;
const BLEED = 0.32; // ~ -10 dB

const micA = new Float32Array(N);
const micB = new Float32Array(N);

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const envA = speakerA(t);
  const envB = speakerB(t);
  const sigA = envA * tone(t, 180);
  const sigB = envB * tone(t, 130);

  // Mic A: direct A + delayed/attenuated B (and a bit of room noise)
  const delayedB = i - LAG_SAMPLES >= 0 ? speakerB((i - LAG_SAMPLES) / SR) * tone((i - LAG_SAMPLES) / SR, 130) : 0;
  micA[i] = sigA + BLEED * delayedB + 0.002 * (Math.random() - 0.5);

  // Mic B: direct B + delayed/attenuated A
  const delayedA = i - LAG_SAMPLES >= 0 ? speakerA((i - LAG_SAMPLES) / SR) * tone((i - LAG_SAMPLES) / SR, 180) : 0;
  micB[i] = sigB + BLEED * delayedA + 0.002 * (Math.random() - 0.5);
}

// Normalise
const norm = (arr) => {
  let max = 0;
  for (const v of arr) if (Math.abs(v) > max) max = Math.abs(v);
  const g = 0.7 / max;
  for (let i = 0; i < arr.length; i++) arr[i] *= g;
};
norm(micA);
norm(micB);

const writeWav = (samples, filename) => {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(filename, buf);
};

const outDir = path.resolve('./fixtures');
fs.mkdirSync(outDir, { recursive: true });
writeWav(micA, path.join(outDir, 'speaker-a.wav'));
writeWav(micB, path.join(outDir, 'speaker-b.wav'));
console.log('Wrote', outDir);
