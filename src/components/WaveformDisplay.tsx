import React, { useRef, useEffect } from 'react';

interface WaveformDisplayProps {
  peaks: number[];
  color: string;
  progress: number;
  height?: number;
  label: string;
  isActive: boolean;
  onSeek?: (percentage: number) => void;
  gainCurve?: Float32Array;
}

const WaveformDisplay: React.FC<WaveformDisplayProps> = ({
  peaks,
  color,
  progress,
  height = 90,
  label,
  isActive,
  onSeek,
  gainCurve,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    ctx.beginPath();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    const gateCol = new Float32Array(peaks.length);
    if (gainCurve && gainCurve.length > 0) {
      for (let i = 0; i < peaks.length; i++) {
        const idx = Math.floor((i / peaks.length) * gainCurve.length);
        gateCol[i] = gainCurve[idx] ?? 1;
      }
    } else {
      gateCol.fill(1);
    }

    const barWidth = width / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const g = gainCurve ? gateCol[i] : isActive ? 1 : 0.3;
      const x = i * barWidth;
      const peakHeight = peaks[i] * height * 0.9;
      const y = (height - peakHeight) / 2;
      if (g > 0.6) ctx.fillStyle = color;
      else if (g > 0.2) ctx.fillStyle = color + 'aa';
      else ctx.fillStyle = '#3f4b5e';
      ctx.fillRect(x, y, Math.max(1, barWidth - 1), peakHeight);
    }

    if (gainCurve && gainCurve.length > 0) {
      ctx.strokeStyle = '#f8fafc';
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < peaks.length; i++) {
        const x = i * barWidth;
        const y = height - gateCol[i] * height * 0.95 - 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const progressX = progress * width;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(progressX, 0);
    ctx.lineTo(progressX, height);
    ctx.stroke();
  }, [peaks, color, progress, height, isActive, gainCurve]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    onSeek(percentage);
  };

  return (
    <div className="relative w-full mb-4">
      <div className="flex justify-between items-end mb-1">
        <span
          className={`text-xs font-bold uppercase tracking-wider ${
            isActive ? 'text-white' : 'text-slate-500'
          }`}
        >
          {label} {isActive ? '(Active)' : '(Gated)'}
        </span>
        {gainCurve && (
          <span className="text-[10px] text-slate-500 font-mono uppercase">
            gate envelope
          </span>
        )}
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: `${height}px` }}
        className={`bg-slate-800 rounded-lg shadow-inner w-full ${
          onSeek ? 'cursor-pointer' : ''
        }`}
        onClick={handleClick}
      />
    </div>
  );
};

export default WaveformDisplay;
