// Generate a single stereo WAV: L = speaker A, R = speaker B, each with a bit
// of bleed of the other side.
import fs from 'node:fs';
const SR = 48000, DUR = 8, N = SR * DUR;

const env = (t, start, stop) => {
  if (t < start || t > stop) return 0;
  const local = t - start;
  return (0.5 + 0.5 * Math.sin(2*Math.PI*5*local)) * (0.5 + 0.5 * Math.sin(2*Math.PI*0.7*local));
};
const spA = (t) => env(t, 0.3, 2.2) + env(t, 4.0, 5.5);
const spB = (t) => env(t, 2.5, 3.8) + env(t, 6.0, 7.7);
const tone = (t,f) => Math.sin(2*Math.PI*f*t) + 0.5*Math.sin(2*Math.PI*f*2*t) + 0.25*Math.sin(2*Math.PI*f*3*t) + 0.1*(Math.random()-0.5);

const L = new Float32Array(N), R = new Float32Array(N);
const LAG = 72, BLEED = 0.32;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const a = spA(t) * tone(t, 180);
  const b = spB(t) * tone(t, 130);
  const da = i - LAG >= 0 ? spA((i-LAG)/SR) * tone((i-LAG)/SR, 180) : 0;
  const db = i - LAG >= 0 ? spB((i-LAG)/SR) * tone((i-LAG)/SR, 130) : 0;
  L[i] = a + BLEED * db + 0.002*(Math.random()-0.5);
  R[i] = b + BLEED * da + 0.002*(Math.random()-0.5);
}
const nrm = a => { let m=0; for (const v of a) if (Math.abs(v)>m) m=Math.abs(v); const g=0.7/m; for (let i=0;i<a.length;i++) a[i]*=g; };
nrm(L); nrm(R);

const buf = Buffer.alloc(44 + N*2*2);
buf.write('RIFF',0); buf.writeUInt32LE(36+N*2*2,4); buf.write('WAVE',8);
buf.write('fmt ',12); buf.writeUInt32LE(16,16); buf.writeUInt16LE(1,20);
buf.writeUInt16LE(2,22); buf.writeUInt32LE(SR,24); buf.writeUInt32LE(SR*2*2,28);
buf.writeUInt16LE(4,32); buf.writeUInt16LE(16,34);
buf.write('data',36); buf.writeUInt32LE(N*2*2,40);
let p = 44;
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1,Math.min(1,L[i]))*32767), p); p+=2;
  buf.writeInt16LE(Math.round(Math.max(-1,Math.min(1,R[i]))*32767), p); p+=2;
}
fs.mkdirSync('./fixtures', { recursive: true });
fs.writeFileSync('./fixtures/stereo-ab.wav', buf);
console.log('Wrote stereo-ab.wav');
