import React from 'react';
import { Target, Activity } from 'lucide-react';
import { CalibrationProfile } from '../types';

interface Props {
  calibration?: CalibrationProfile;
  speakerCount: number;
}

// Shows what auto-calibration measured from the uploaded tracks.
// This replaces the manual "record solo A then solo B" wizard — the gating
// engine already scans for solo passages automatically on every run.
const CalibrationPanel: React.FC<Props> = ({ calibration, speakerCount }) => {
  if (!calibration) return null;

  const labels = ['Speaker 1', 'Speaker 2', 'Speaker 3'];
  const rows: React.ReactNode[] = [];

  for (let i = 0; i < speakerCount; i++) {
    const solo = calibration.soloWindowCount[i] ?? 0;
    // Worst-case bleed onto other mics (higher = more bleed, closer to speech level)
    let worstBleed = -Infinity;
    for (let j = 0; j < speakerCount; j++) {
      if (i === j) continue;
      const b = calibration.bleedDb[i]?.[j] ?? -Infinity;
      if (b > worstBleed) worstBleed = b;
    }
    const margin = calibration.speechDb[i] - worstBleed;
    // Largest |lag| against any other mic (ms)
    let worstLagMs = 0;
    for (let j = 0; j < speakerCount; j++) {
      if (i === j) continue;
      const lag = Math.abs(calibration.leadLagSamples[i]?.[j] ?? 0);
      const ms = (lag / calibration.sampleRate) * 1000;
      if (ms > worstLagMs) worstLagMs = ms;
    }
    rows.push(
      <div
        key={i}
        className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0 text-xs"
      >
        <span className="text-slate-300 font-medium">{labels[i]}</span>
        <div className="flex gap-3 font-mono text-[11px]">
          <span
            className={
              solo >= 10
                ? 'text-emerald-400'
                : solo >= 3
                  ? 'text-amber-400'
                  : 'text-red-400'
            }
            title="Solo passages detected during calibration"
          >
            {solo} solo
          </span>
          <span
            className={
              margin >= 10
                ? 'text-emerald-400'
                : margin >= 6
                  ? 'text-amber-400'
                  : 'text-red-400'
            }
            title="Direct-to-bleed margin in dB (higher = easier to separate)"
          >
            {Number.isFinite(margin) ? margin.toFixed(1) : '—'} dB
          </span>
          <span
            className="text-cyan-400"
            title="Inter-mic delay measured by cross-correlation"
          >
            {worstLagMs.toFixed(2)} ms
          </span>
        </div>
      </div>,
    );
  }

  return (
    <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-slate-700">
        <Target className="text-cyan-400" size={18} />
        <div>
          <h3 className="font-bold text-sm text-white">Auto Calibration</h3>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">
            Measured from solo passages
          </p>
        </div>
      </div>
      <div className="space-y-0">{rows}</div>
      <div className="mt-3 pt-3 border-t border-slate-700 flex items-center gap-2 text-[10px] text-slate-500">
        <Activity size={12} /> Margin &lt; 6 dB means bleed is hard to separate —
        try moving mics apart or increasing duck depth.
      </div>
    </div>
  );
};

export default CalibrationPanel;
