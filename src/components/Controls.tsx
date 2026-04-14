import React, { useState } from 'react';
import {
  Play,
  Pause,
  Square,
  Download,
  Wand2,
  Settings2,
  RotateCcw,
  Power,
  FileAudio,
  Zap,
  ChevronDown,
  ChevronUp,
  Radar,
  Waves,
} from 'lucide-react';
import { ProcessingSettings, AppState, ProcessingOptions } from '../types';

interface ControlsProps {
  appState: AppState;
  settings: ProcessingSettings;
  isBypassed: boolean;
  hasC: boolean;
  onToggleBypass: () => void;
  onSettingsChange: (s: ProcessingSettings) => void;
  onPlayPause: () => void;
  onStop: () => void;
  onExport: (
    type:
      | 'mix'
      | 'a'
      | 'b'
      | 'c'
      | 'a_processed'
      | 'b_processed'
      | 'c_processed',
    options: ProcessingOptions,
  ) => void;
  onAnalyze: () => void;
  onReset: () => void;
}

const Controls: React.FC<ControlsProps> = ({
  appState,
  settings,
  isBypassed,
  hasC,
  onToggleBypass,
  onSettingsChange,
  onPlayPause,
  onStop,
  onExport,
  onAnalyze,
  onReset,
}) => {
  const isPlaying = appState === AppState.PLAYING;
  const isReady = appState === AppState.READY || appState === AppState.PLAYING;
  const isProcessing = appState === AppState.PROCESSING_EXPORT;

  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [exportOptions, setExportOptions] = useState<ProcessingOptions>({
    enhance: true,
    autoLevel: true,
    detectFillers: false,
  });

  return (
    <div className="bg-slate-800 p-6 rounded-xl shadow-lg border border-slate-700">
      {/* Transport */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={onPlayPause}
            disabled={!isReady || isProcessing}
            className={`flex items-center justify-center w-16 h-16 rounded-full transition-all flex-shrink-0 ${
              isReady && !isProcessing
                ? 'bg-cyan-500 hover:bg-cyan-400 text-white shadow-[0_0_20px_rgba(6,182,212,0.5)]'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }`}
          >
            {isPlaying ? (
              <Pause size={32} fill="currentColor" />
            ) : (
              <Play size={32} fill="currentColor" className="ml-1" />
            )}
          </button>

          <button
            onClick={onStop}
            disabled={!isReady || isProcessing}
            className={`flex items-center justify-center w-12 h-12 rounded-lg transition-all flex-shrink-0 ${
              isReady && !isProcessing
                ? 'bg-slate-700 hover:bg-red-500/20 text-slate-300 hover:text-red-400'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed'
            }`}
          >
            <Square size={20} fill="currentColor" />
          </button>

          <div className="flex flex-col">
            <span className="text-xl font-bold text-white">Preview Mix</span>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={onToggleBypass}
                disabled={isProcessing}
                className={`text-xs px-2 py-1 rounded border transition-colors flex items-center gap-1 ${
                  isBypassed
                    ? 'border-yellow-500/50 text-yellow-500 bg-yellow-500/10'
                    : 'border-cyan-500/50 text-cyan-400 bg-cyan-500/10'
                }`}
              >
                <Power size={10} />
                {isBypassed ? 'Gate BYPASSED (Raw Audio)' : 'EchoGate ACTIVE'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <button
            onClick={onAnalyze}
            disabled={!isReady || isProcessing}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors border border-purple-500/30 ${
              isReady && !isProcessing
                ? 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20'
                : 'text-slate-600 cursor-not-allowed'
            }`}
          >
            <Wand2 size={18} />
            AI Insights
          </button>

          <div className="relative">
            <button
              onClick={() =>
                isReady && !isProcessing && setShowExportMenu(!showExportMenu)
              }
              disabled={!isReady || isProcessing}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                isReady && !isProcessing
                  ? 'bg-slate-700 text-white hover:bg-slate-600'
                  : 'bg-slate-800 text-slate-600 cursor-not-allowed'
              }`}
            >
              <Download size={18} />
              {isProcessing ? 'Processing...' : 'Export'}
            </button>

            {showExportMenu && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-slate-800 border border-slate-600 rounded-lg shadow-2xl overflow-hidden z-20">
                <div className="p-3 bg-slate-900/50 border-b border-slate-700">
                  <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">
                    Processing Chain
                  </h4>
                  <label className="flex items-center gap-2 text-sm text-slate-300 mb-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={exportOptions.enhance}
                      onChange={(e) =>
                        setExportOptions({
                          ...exportOptions,
                          enhance: e.target.checked,
                        })
                      }
                      className="rounded bg-slate-700 border-slate-600 accent-cyan-500"
                    />
                    Enhance (EQ + Compression)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300 mb-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={exportOptions.autoLevel}
                      onChange={(e) =>
                        setExportOptions({
                          ...exportOptions,
                          autoLevel: e.target.checked,
                        })
                      }
                      className="rounded bg-slate-700 border-slate-600 accent-cyan-500"
                    />
                    Auto-Level (-16 LUFS)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={exportOptions.detectFillers}
                      onChange={(e) =>
                        setExportOptions({
                          ...exportOptions,
                          detectFillers: e.target.checked,
                        })
                      }
                      className="rounded bg-slate-700 border-slate-600 accent-cyan-500"
                    />
                    Detect Fillers (BETA)
                  </label>
                </div>

                <button
                  onClick={() => {
                    onExport('mix', exportOptions);
                    setShowExportMenu(false);
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-slate-700 flex items-center gap-2 text-sm text-white"
                >
                  <FileAudio size={14} className="text-cyan-400" /> Mix (Combined)
                </button>
                <div className="border-t border-slate-700">
                  <button
                    onClick={() => {
                      onExport('a', exportOptions);
                      setShowExportMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-slate-700 flex items-center gap-2 text-sm text-slate-300"
                  >
                    <FileAudio size={14} className="text-blue-400" /> Speaker 1
                    (Gated)
                  </button>
                  <button
                    onClick={() => {
                      onExport('a_processed', exportOptions);
                      setShowExportMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-slate-700 flex items-center gap-2 text-sm text-white bg-blue-500/10"
                  >
                    <Zap size={14} className="text-blue-400" /> Speaker 1 PROCESSED
                  </button>
                </div>
                <div className="border-t border-slate-700">
                  <button
                    onClick={() => {
                      onExport('b', exportOptions);
                      setShowExportMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-slate-700 flex items-center gap-2 text-sm text-slate-300"
                  >
                    <FileAudio size={14} className="text-pink-400" /> Speaker 2
                    (Gated)
                  </button>
                  <button
                    onClick={() => {
                      onExport('b_processed', exportOptions);
                      setShowExportMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-slate-700 flex items-center gap-2 text-sm text-white bg-pink-500/10"
                  >
                    <Zap size={14} className="text-pink-400" /> Speaker 2 PROCESSED
                  </button>
                </div>
                {hasC && (
                  <div className="border-t border-slate-700">
                    <button
                      onClick={() => {
                        onExport('c', exportOptions);
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-slate-700 flex items-center gap-2 text-sm text-slate-300"
                    >
                      <FileAudio size={14} className="text-green-400" /> Speaker 3
                      (Gated)
                    </button>
                    <button
                      onClick={() => {
                        onExport('c_processed', exportOptions);
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-slate-700 flex items-center gap-2 text-sm text-white bg-green-500/10"
                    >
                      <Zap size={14} className="text-green-400" /> Speaker 3
                      PROCESSED
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={onReset}
            className="p-2 text-slate-400 hover:text-red-400 transition-colors"
            title="Reset"
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </div>

      {/* Primary settings grid */}
      <div
        className={`grid grid-cols-1 md:grid-cols-4 gap-6 pt-6 border-t border-slate-700/50 transition-opacity duration-300 ${
          isBypassed ? 'opacity-40 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <label className="text-slate-300 font-medium flex items-center gap-2">
              <Settings2 size={14} />
              Bleed Isolation
            </label>
            <span className="text-cyan-400 font-mono text-xs">
              {settings.isolationDb} dB
            </span>
          </div>
          <input
            type="range"
            min="2"
            max="20"
            step="0.5"
            value={settings.isolationDb}
            onChange={(e) =>
              onSettingsChange({ ...settings, isolationDb: Number(e.target.value) })
            }
            className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-cyan-500"
          />
          <p className="text-xs text-slate-500">
            Margin needed before a speaker wins over the other.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <label className="text-slate-300 font-medium flex items-center gap-2">
              <Waves size={14} />
              Duck Depth
            </label>
            <span className="text-cyan-400 font-mono text-xs">
              {settings.duckDb === 0 ? 'Mute' : `-${settings.duckDb} dB`}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="40"
            step="1"
            value={settings.duckDb}
            onChange={(e) =>
              onSettingsChange({ ...settings, duckDb: Number(e.target.value) })
            }
            className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-cyan-500"
          />
          <p className="text-xs text-slate-500">
            Attenuation for inactive speaker. Softer = smoother.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <label className="text-slate-300 font-medium flex items-center gap-2">
              <Settings2 size={14} />
              Release
            </label>
            <span className="text-cyan-400 font-mono text-xs">
              {settings.releaseMs} ms
            </span>
          </div>
          <input
            type="range"
            min="50"
            max="1000"
            step="50"
            value={settings.releaseMs}
            onChange={(e) =>
              onSettingsChange({ ...settings, releaseMs: Number(e.target.value) })
            }
            className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-cyan-500"
          />
          <p className="text-xs text-slate-500">Time to close the gate after speech.</p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <label className="text-slate-300 font-medium flex items-center gap-2">
              <Radar size={14} />
              Look-Ahead
            </label>
            <span className="text-cyan-400 font-mono text-xs">
              {settings.lookAheadMs} ms
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="10"
            value={settings.lookAheadMs}
            onChange={(e) =>
              onSettingsChange({ ...settings, lookAheadMs: Number(e.target.value) })
            }
            className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-cyan-500"
          />
          <p className="text-xs text-slate-500">
            Opens gate ahead of speech onsets. Higher = fewer clipped consonants.
          </p>
        </div>
      </div>

      {/* Advanced */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="mt-6 flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
      >
        {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        Advanced
      </button>

      {showAdvanced && (
        <div
          className={`grid grid-cols-1 md:grid-cols-4 gap-6 pt-6 border-t border-slate-700/30 mt-4 transition-opacity ${
            isBypassed ? 'opacity-40 pointer-events-none' : 'opacity-100'
          }`}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <label className="text-slate-300 font-medium">Attack</label>
              <span className="text-cyan-400 font-mono text-xs">
                {settings.attackMs} ms
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="50"
              step="1"
              value={settings.attackMs}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  attackMs: Number(e.target.value),
                })
              }
              className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <label className="text-slate-300 font-medium">Hysteresis</label>
              <span className="text-cyan-400 font-mono text-xs">
                +{settings.hysteresisDb} dB
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="12"
              step="0.5"
              value={settings.hysteresisDb}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  hysteresisDb: Number(e.target.value),
                })
              }
              className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
            <p className="text-xs text-slate-500">
              Stickiness of current speaker.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <label className="text-slate-300 font-medium">Multi-Hold</label>
              <span className="text-cyan-400 font-mono text-xs">
                {settings.multiHoldMs} ms
              </span>
            </div>
            <input
              type="range"
              min="50"
              max="500"
              step="50"
              value={settings.multiHoldMs}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  multiHoldMs: Number(e.target.value),
                })
              }
              className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
            <p className="text-xs text-slate-500">
              Overlap must persist before opening both gates.
            </p>
          </div>

          <div className="space-y-2 flex flex-col justify-between">
            <label className="flex items-center justify-between text-sm text-slate-300">
              <span className="font-medium">Cross-Correlation</span>
              <button
                onClick={() =>
                  onSettingsChange({
                    ...settings,
                    useCrossCorrelation: !settings.useCrossCorrelation,
                  })
                }
                className={`w-10 h-5 rounded-full relative transition-colors ${
                  settings.useCrossCorrelation ? 'bg-cyan-500' : 'bg-slate-600'
                }`}
              >
                <div
                  className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${
                    settings.useCrossCorrelation ? 'left-6' : 'left-1'
                  }`}
                />
              </button>
            </label>
            <label className="flex items-center justify-between text-sm text-slate-300">
              <span className="font-medium">Spectral Cue</span>
              <button
                onClick={() =>
                  onSettingsChange({
                    ...settings,
                    useSpectralCue: !settings.useSpectralCue,
                  })
                }
                className={`w-10 h-5 rounded-full relative transition-colors ${
                  settings.useSpectralCue ? 'bg-cyan-500' : 'bg-slate-600'
                }`}
              >
                <div
                  className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${
                    settings.useSpectralCue ? 'left-6' : 'left-1'
                  }`}
                />
              </button>
            </label>
            <label className="flex items-center justify-between text-sm text-slate-300">
              <span className="font-medium">Classic Noise Gate</span>
              <button
                onClick={() =>
                  onSettingsChange({
                    ...settings,
                    enableNoiseGate: !settings.enableNoiseGate,
                  })
                }
                className={`w-10 h-5 rounded-full relative transition-colors ${
                  settings.enableNoiseGate ? 'bg-cyan-500' : 'bg-slate-600'
                }`}
              >
                <div
                  className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${
                    settings.enableNoiseGate ? 'left-6' : 'left-1'
                  }`}
                />
              </button>
            </label>
          </div>

          {settings.enableNoiseGate && (
            <div className="space-y-3 md:col-span-4">
              <div className="flex items-center justify-between text-sm">
                <label className="text-slate-300 font-medium">
                  Silence Threshold
                </label>
                <span className="text-cyan-400 font-mono text-xs">
                  {settings.thresholdDb} dB
                </span>
              </div>
              <input
                type="range"
                min="-60"
                max="-10"
                step="1"
                value={settings.thresholdDb}
                onChange={(e) =>
                  onSettingsChange({
                    ...settings,
                    thresholdDb: Number(e.target.value),
                  })
                }
                className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-cyan-500"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Controls;
