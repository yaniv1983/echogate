import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, CheckCircle2, Bot, Wand2, Loader2, XCircle, Users, UploadCloud, PlayCircle, Zap, Plus, Trash2 } from 'lucide-react';
import WaveformDisplay from './components/WaveformDisplay';
import Controls from './components/Controls';
import CalibrationPanel from './components/CalibrationPanel';
import { AudioFile, ProcessingSettings, AppState, GatingResult, GeminiStatus, ProcessingOptions } from './types';
import { decodeAudio, getPeaks, processAudioGatingAsync, bufferToWave, applyProcessingChain } from './services/audioUtils';
import { analyzePodcastContent, detectFillerWords } from './services/geminiService';

const DEFAULT_SETTINGS: ProcessingSettings = {
  thresholdDb: -40,
  isolationDb: 6,
  attackMs: 5,
  releaseMs: 300,
  enableNoiseGate: false,
  duckDb: 18,
  useCrossCorrelation: true,
  useSpectralCue: true,
  lookAheadMs: 30,
  multiHoldMs: 150,
  hysteresisDb: 4,
};

function App() {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [isEditorOpen, setIsEditorOpen] = useState(false); // Controls transition from Hero to App
  
  // Files: now supports a, b, and c
  const [files, setFiles] = useState<{ a: AudioFile | null; b: AudioFile | null; c: AudioFile | null }>({ a: null, b: null, c: null });
  const [settings, setSettings] = useState<ProcessingSettings>(DEFAULT_SETTINGS);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [stats, setStats] = useState<GatingResult | null>(null);
  const [isBypassed, setIsBypassed] = useState(false);
  
  // Notification State
  const [showToast, setShowToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  
  // Progress States
  const [uploadProgress, setUploadProgress] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [exportProgressState, setExportProgressState] = useState<{message: string, progress: number} | null>(null);
  
  // Audio Engine Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodesRef = useRef<(AudioBufferSourceNode | null)[]>([null, null, null]);
  const gainNodesRef = useRef<(GainNode | null)[]>([null, null, null]);

  const startTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  const isPlayingRef = useRef(false);

  // Gemini State
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>(GeminiStatus.IDLE);
  const [geminiResult, setGeminiResult] = useState<string>('');

  // 1. File Upload Logic (Multi-Select & Merge)
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setAppState(AppState.LOADING);
      setUploadProgress(0);
      
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }

        // Determine which slots are empty
        const currentSlots: ('a'|'b'|'c')[] = ['a', 'b', 'c'];
        const emptySlots = currentSlots.filter(key => files[key] === null);
        
        if (emptySlots.length === 0) {
            alert("All 3 slots are full. Clear files to add new ones.");
            setAppState(AppState.IDLE);
            return;
        }

        const rawFiles: File[] = Array.from(e.target.files);
        
        // If we are starting from scratch, sort them by name (Track 1, Track 2...)
        // If we are appending, just add them in order
        const isFreshStart = emptySlots.length === 3;
        if (isFreshStart) {
            rawFiles.sort((a, b) => a.name.localeCompare(b.name));
        }

        const filesToProcess = rawFiles.slice(0, emptySlots.length);
        const newFilesState = { ...files };
        const colors = { a: '#3b82f6', b: '#ec4899', c: '#4ade80' };

        // Stereo-split: if starting fresh and user drops a single 2-channel file,
        // treat the Left channel as Speaker 1 and Right as Speaker 2.
        const stereoSplit =
          isFreshStart &&
          rawFiles.length === 1 &&
          (await (async () => {
            try {
              const probe = await decodeAudio(rawFiles[0], audioCtxRef.current!);
              return probe.numberOfChannels >= 2 ? probe : null;
            } catch {
              return null;
            }
          })());

        if (stereoSplit) {
          const ctx = audioCtxRef.current!;
          const file = rawFiles[0];
          const buf = stereoSplit as AudioBuffer;
          const makeMono = (chIdx: number): AudioBuffer => {
            const mono = ctx.createBuffer(1, buf.length, buf.sampleRate);
            mono.copyToChannel(buf.getChannelData(chIdx), 0);
            return mono;
          };
          const leftBuf = makeMono(0);
          const rightBuf = makeMono(1);
          setUploadProgress(50);
          newFilesState.a = {
            id: 'a',
            file,
            name: `${file.name} — Left`,
            duration: leftBuf.duration,
            buffer: leftBuf,
            peaks: getPeaks(leftBuf, Math.floor(leftBuf.length / 500)),
            color: colors.a,
          };
          newFilesState.b = {
            id: 'b',
            file,
            name: `${file.name} — Right`,
            duration: rightBuf.duration,
            buffer: rightBuf,
            peaks: getPeaks(rightBuf, Math.floor(rightBuf.length / 500)),
            color: colors.b,
          };
        } else {
          for (let i = 0; i < filesToProcess.length; i++) {
            setUploadProgress((i / filesToProcess.length) * 100);
            const file = filesToProcess[i];
            const targetSlot = emptySlots[i];

            const buffer = await decodeAudio(file, audioCtxRef.current);
            const peaks = getPeaks(buffer, Math.floor(buffer.length / 500));

            newFilesState[targetSlot] = {
              id: targetSlot,
              file,
              name: file.name,
              duration: buffer.duration,
              buffer,
              peaks,
              color: colors[targetSlot],
            };
          }
        }
        
        setUploadProgress(100);
        setFiles(newFilesState);
        
        // Update max duration
        const allDurations = Object.values(newFilesState).map(f => (f as AudioFile | null)?.duration || 0);
        setDuration(Math.max(...allDurations));
        
        // Return to IDLE state to show the Staging Area
        setAppState(AppState.IDLE); 

      } catch (err) {
        console.error(err);
        alert("Error loading audio files.");
        setAppState(AppState.IDLE);
      }
    }
  };
  
  const clearFiles = () => {
      setFiles({ a: null, b: null, c: null });
      setStats(null);
      setDuration(0);
      setCurrentTime(0);
  };

  // 2. Async Processing Logic (Gating)
  const startProcessing = async () => {
      const activeFiles = [files.a, files.b, files.c].filter(f => f !== null) as AudioFile[];
      if (activeFiles.length < 2) {
          alert("Please upload at least 2 audio files to start processing.");
          return;
      }
      
      const buffers = activeFiles.map(f => f.buffer!);
      
      // Transition to Editor View
      setIsEditorOpen(true);
      setAppState(AppState.ANALYZING);
      setAnalysisProgress(0);
      
      try {
          const result = await processAudioGatingAsync(
              buffers,
              settings,
              (p) => setAnalysisProgress(p)
          );
          setStats(result);
          setAppState(AppState.READY);
      } catch (e) {
          console.error(e);
          setIsEditorOpen(false); // Go back if error
          setAppState(AppState.IDLE);
      }
  };

  const runProcessing = useCallback(async (currentSettings: ProcessingSettings) => {
    const activeFiles = [files.a, files.b, files.c].filter(f => f !== null) as AudioFile[];
    if (activeFiles.length < 2) return;
    
    // UI FLICKER FIX:
    // Only show the full screen blocking loader if we don't have stats yet (first run).
    // Otherwise, run in background or show a subtle indicator (controlled by Controls component usually)
    const isFirstRun = !stats;
    
    if (isFirstRun) {
        setAppState(AppState.ANALYZING);
        setAnalysisProgress(0);
    }

    const buffers = activeFiles.map(f => f.buffer!);

    try {
      const result = await processAudioGatingAsync(
        buffers, 
        currentSettings, 
        (progress) => {
            if (isFirstRun) setAnalysisProgress(progress);
        }
      );
      
      setStats(result);
      if (isFirstRun) setAppState(AppState.READY);
      
    } catch (e) {
      console.error(e);
      if (isFirstRun) setAppState(AppState.IDLE);
    }
  }, [files, stats]);

  // Re-run processing when settings change
  useEffect(() => {
    // Only trigger if we are already in the editor mode and have data
    if (stats && isEditorOpen && (appState === AppState.READY || appState === AppState.PLAYING)) {
       const timer = setTimeout(() => {
         runProcessing(settings);
       }, 200);
       return () => clearTimeout(timer);
    }
  }, [settings, stats, runProcessing, appState, isEditorOpen]);


  // 3. Playback Logic
  const stopPlayback = (resetTime: boolean = false) => {
    sourceNodesRef.current.forEach(node => { if(node) try{ node.stop() }catch(e){} });
    cancelAnimationFrame(animationFrameRef.current);
    isPlayingRef.current = false;
    
    if (resetTime) {
      setCurrentTime(0);
      startTimeRef.current = 0;
    }
    setAppState(AppState.READY);
  };

  const startPlayback = (startTimeOverride?: number) => {
    if (!audioCtxRef.current || !stats) return;

    stopPlayback(false);
    const ctx = audioCtxRef.current;
    
    const activeFiles = [files.a, files.b, files.c];
    const curves = [stats.gainCurveA, stats.gainCurveB, stats.gainCurveC];
    
    const startTime = ctx.currentTime;
    const offset = startTimeOverride !== undefined ? startTimeOverride : currentTime;

    activeFiles.forEach((file, idx) => {
        if (!file?.buffer) return;
        
        const source = ctx.createBufferSource();
        source.buffer = file.buffer;
        const gain = ctx.createGain();
        
        source.connect(gain);
        gain.connect(ctx.destination);
        
        if (isBypassed) {
            gain.gain.value = 1;
        } else {
            const curve = curves[idx];
            if (curve) {
                const startIdx = Math.floor((offset / duration) * curve.length);
                const curveSlice = curve.slice(startIdx);
                if (curveSlice.length > 0) {
                    gain.gain.setValueCurveAtTime(curveSlice, startTime, duration - offset);
                }
            }
        }
        
        source.start(startTime, offset);
        
        sourceNodesRef.current[idx] = source;
        gainNodesRef.current[idx] = gain;
    });

    startTimeRef.current = startTime - offset;
    isPlayingRef.current = true;
    setAppState(AppState.PLAYING);

    const draw = () => {
      if (!isPlayingRef.current) return;
      const now = ctx.currentTime;
      const trackTime = now - startTimeRef.current;
      
      if (trackTime >= duration) {
        stopPlayback(true);
      } else {
        setCurrentTime(trackTime);
        animationFrameRef.current = requestAnimationFrame(draw);
      }
    };
    draw();
  };

  const handlePlayPause = () => {
    if (appState === AppState.PLAYING) {
        stopPlayback(false);
    } else {
        startPlayback();
    }
  };

  const handleStop = () => {
    stopPlayback(true);
  };
  
  const handleSeek = (percentage: number) => {
    const newTime = percentage * duration;
    setCurrentTime(newTime);
    if (appState === AppState.PLAYING) {
      startPlayback(newTime);
    }
  };
  
  const handleToggleBypass = () => {
      const wasPlaying = appState === AppState.PLAYING;
      if (wasPlaying) stopPlayback(false);
      setIsBypassed(!isBypassed);
      if (wasPlaying) setTimeout(startPlayback, 50);
  };

  // 4. Export Logic
  const handleExport = async (
    type: 'mix' | 'a' | 'b' | 'c' | 'a_processed' | 'b_processed' | 'c_processed',
    options: ProcessingOptions
  ) => {
    if (!files.a?.buffer || !files.b?.buffer || !stats) return;

    setAppState(AppState.PROCESSING_EXPORT);
    setExportProgressState({ message: "Initializing export...", progress: 0 });

    try {
        let finalBuffer: AudioBuffer | null = null;
        let blobName = '';
        
        const applyEnhancements = type.includes('processed') || (type === 'mix' && (options.enhance || options.autoLevel));
        const enhance = applyEnhancements && options.enhance;
        const autoLevel = applyEnhancements && options.autoLevel;
        
        setExportProgressState({ message: "Applying Audio Processing...", progress: 10 });

        if (type === 'mix') {
            const offlineCtx = new OfflineAudioContext(2, files.a.buffer.length, files.a.buffer.sampleRate);
            
            const processTrack = (buf: AudioBuffer, curve: Float32Array) => {
                const src = offlineCtx.createBufferSource();
                src.buffer = buf;
                const gain = offlineCtx.createGain();
                src.connect(gain);
                gain.gain.setValueCurveAtTime(curve, 0, duration);
                gain.connect(offlineCtx.destination);
                src.start(0);
            };

            processTrack(files.a.buffer, stats.gainCurveA);
            processTrack(files.b.buffer, stats.gainCurveB);
            if (files.c && files.c.buffer && stats.gainCurveC) processTrack(files.c.buffer, stats.gainCurveC);
            
            const mixed = await offlineCtx.startRendering();
            finalBuffer = await applyProcessingChain(mixed, null, enhance, autoLevel);
            blobName = `echogate-mix-mastered-${Date.now()}.wav`;

        } else {
            // Individual Exports
            let targetBuffer: AudioBuffer | null = null;
            let targetCurve: Float32Array | null = null;
            
            if (type.startsWith('a')) { targetBuffer = files.a.buffer; targetCurve = stats.gainCurveA; }
            if (type.startsWith('b')) { targetBuffer = files.b.buffer; targetCurve = stats.gainCurveB; }
            if (type.startsWith('c') && files.c) { targetBuffer = files.c.buffer; targetCurve = stats.gainCurveC!; }
            
            if (targetBuffer && targetCurve) {
                 finalBuffer = await applyProcessingChain(targetBuffer, targetCurve, enhance, autoLevel);
                 blobName = `echogate-${type}-${enhance ? 'enhanced' : 'raw'}.wav`;
            }
        }

        if (finalBuffer) {
            let markers: any[] = [];
            if (options.detectFillers) {
                setExportProgressState({ message: "Detecting Filler Words (AI)...", progress: 20 });
                markers = await detectFillerWords(finalBuffer, (pct) => {
                    setExportProgressState({ message: "Detecting Filler Words (AI)...", progress: 20 + (pct * 0.7) });
                });
            }

            setExportProgressState({ message: "Generating WAV File...", progress: 95 });

            const blob = bufferToWave(finalBuffer, finalBuffer.length, markers);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = blobName;
            a.click();
            
            const msg = markers.length > 0 ? `Exported with ${markers.length} markers` : "Export Complete!";
            setShowToast({message: msg, type: 'success'});
            setTimeout(() => setShowToast(null), 5000);
        }

    } catch(err) {
        console.error("Export Failed", err);
        setShowToast({message: "Export Failed.", type: 'error'});
        setTimeout(() => setShowToast(null), 3000);
    } finally {
        setAppState(AppState.READY);
        setExportProgressState(null);
    }
  };

  // 5. AI Analysis
  const handleAIAnalysis = async () => {
    if (!files.a?.buffer || !files.b?.buffer) return;
    setGeminiStatus(GeminiStatus.GENERATING);
    const result = await analyzePodcastContent(files.a.buffer, files.b.buffer, files.c?.buffer || undefined);
    setGeminiResult(result);
    setGeminiStatus(GeminiStatus.COMPLETE);
  };
  
  const resetApp = () => {
      stopPlayback(true);
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        try { audioCtxRef.current.close(); } catch (e) { /* noop */ }
        audioCtxRef.current = null;
      }
      setFiles({ a: null, b: null, c: null });
      setStats(null);
      setAppState(AppState.IDLE);
      setIsEditorOpen(false);
      setCurrentTime(0);
      setDuration(0);
      setGeminiResult('');
      setGeminiStatus(GeminiStatus.IDLE);
      setUploadProgress(0);
  }

  // Active status helper
  const getActiveStatus = (track: 'a'|'b'|'c') => {
    if (!stats || !duration || isBypassed) return isBypassed;
    const index = Math.floor((currentTime / duration) * stats.gainCurveA.length);
    if (track === 'a') return (stats.gainCurveA[index] || 0) > 0.5;
    if (track === 'b') return (stats.gainCurveB[index] || 0) > 0.5;
    if (track === 'c' && stats.gainCurveC) return (stats.gainCurveC[index] || 0) > 0.5;
    return false;
  };

  const hasFiles = files.a || files.b || files.c;
  const fileCount = [files.a, files.b, files.c].filter(Boolean).length;
  const canStart = fileCount >= 2;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 flex flex-col relative overflow-x-hidden">
      
      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-6 right-6 z-[70] animate-in fade-in slide-in-from-top-4 duration-300">
            <div className={`px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 border backdrop-blur-md ${
                showToast.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-red-500/10 border-red-500/50 text-red-400'
            }`}>
                {showToast.type === 'success' ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
                <span className="font-medium text-sm">{showToast.message}</span>
            </div>
        </div>
      )}
      
      {/* Processing Export Overlay */}
      {appState === AppState.PROCESSING_EXPORT && (
        <div className="fixed inset-0 z-[60] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center">
             <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl flex flex-col items-center max-w-sm w-full border border-slate-700">
                 <Loader2 className="animate-spin text-cyan-400 mb-4" size={48} />
                 <h2 className="text-xl font-bold text-white mb-2">Processing Export</h2>
                 {exportProgressState ? (
                     <div className="w-full text-center">
                         <p className="text-slate-400 text-sm mb-3">{exportProgressState.message}</p>
                         <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-cyan-500 transition-all duration-300" style={{ width: `${exportProgressState.progress}%` }}></div>
                         </div>
                     </div>
                 ) : <p className="text-slate-400">Rendering Audio...</p>}
             </div>
        </div>
      )}

      {/* ---------------- HERO / STAGING SECTION ---------------- */}
      {!isEditorOpen && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div className="space-y-4">
                 <h1 className="text-5xl md:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600">
                    EchoGate AI
                 </h1>
                 <p className="text-xl md:text-2xl text-slate-300 font-light">
                    Professional Podcast Bleed Removal & Auto-Mixing
                 </p>
                 <p className="text-slate-400 max-w-2xl mx-auto leading-relaxed">
                    Automatically clean up multi-track podcast recordings. Eliminate mic bleed, background noise, and crosstalk using intelligent signal comparison. 
                    Supports up to 3 speakers with AI-powered filler word detection and broadcast-ready mastering.
                 </p>
            </div>

            <div className="flex flex-col items-center gap-4 w-full max-w-md">
                
                {appState === AppState.LOADING ? (
                    // LOADING STATE
                    <div className="w-full bg-slate-800 border-2 border-slate-700 rounded-2xl p-10 flex flex-col items-center gap-6 animate-in fade-in duration-300 shadow-xl">
                         <Loader2 className="animate-spin text-cyan-400" size={48} />
                         <div className="space-y-2 w-full text-center">
                             <h3 className="text-lg font-bold text-white">Loading Audio Files...</h3>
                             <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-cyan-500 transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                             </div>
                             <p className="text-xs text-slate-500">{Math.round(uploadProgress)}%</p>
                         </div>
                    </div>
                ) : !hasFiles ? (
                    // EMPTY STATE
                    <label className="w-full group cursor-pointer">
                        <div className="bg-slate-800 border-2 border-dashed border-cyan-500/30 group-hover:border-cyan-400 rounded-2xl p-10 flex flex-col items-center gap-4 transition-all shadow-lg group-hover:shadow-cyan-900/20">
                            <div className="bg-cyan-500/10 p-4 rounded-full text-cyan-400 group-hover:scale-110 transition-transform">
                                <UploadCloud size={40} />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-lg font-bold text-white">Select Audio Files</h3>
                                <p className="text-sm text-slate-400">2–3 mono tracks, or 1 stereo file (L = Speaker 1, R = Speaker 2)</p>
                            </div>
                        </div>
                        <input type="file" multiple accept=".wav,.mp3" onChange={handleFilesSelected} className="hidden" />
                    </label>
                ) : (
                    // STAGING STATE (Files Loaded)
                    <div className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-xl animate-in fade-in duration-300">
                         <div className="flex justify-between items-center mb-4">
                             <h3 className="text-lg font-bold text-white">Files Loaded</h3>
                             <button onClick={clearFiles} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                                 <Trash2 size={12}/> Clear All
                             </button>
                         </div>
                         
                         <div className="space-y-3 mb-6">
                             {files.a && <div className="p-3 bg-slate-700/50 rounded-lg flex items-center gap-3 border-l-4 border-blue-500 text-left"><Mic size={16} className="text-blue-400 shrink-0"/><span className="truncate text-sm">{files.a.name}</span></div>}
                             {files.b && <div className="p-3 bg-slate-700/50 rounded-lg flex items-center gap-3 border-l-4 border-pink-500 text-left"><Mic size={16} className="text-pink-400 shrink-0"/><span className="truncate text-sm">{files.b.name}</span></div>}
                             {files.c && <div className="p-3 bg-slate-700/50 rounded-lg flex items-center gap-3 border-l-4 border-green-500 text-left"><Mic size={16} className="text-green-400 shrink-0"/><span className="truncate text-sm">{files.c.name}</span></div>}
                         </div>

                         <div className="space-y-3">
                             <button 
                                onClick={startProcessing}
                                disabled={!canStart}
                                className={`w-full py-3 rounded-lg font-bold shadow-lg flex items-center justify-center gap-2 transition-all ${
                                    canStart 
                                    ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-900/50' 
                                    : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                }`}
                             >
                                 <PlayCircle size={20} />
                                 Start Processing
                             </button>

                             {fileCount < 3 && (
                                <label className="block w-full text-center py-2 text-sm text-slate-400 hover:text-white cursor-pointer transition-colors border border-dashed border-slate-600 rounded-lg hover:bg-slate-700">
                                    <span className="flex items-center justify-center gap-2"><Plus size={14}/> Add Another File</span>
                                    <input type="file" multiple accept=".wav,.mp3" onChange={handleFilesSelected} className="hidden" />
                                </label>
                             )}
                         </div>
                         {!canStart && <p className="text-xs text-amber-500 mt-3">Upload at least 2 files to begin.</p>}
                    </div>
                )}
                
                <div className="flex gap-4 text-xs text-slate-500 uppercase tracking-widest mt-4">
                    <span className="flex items-center gap-1"><Users size={12}/> 2-3 Speakers</span>
                    <span className="flex items-center gap-1"><Wand2 size={12}/> AI Gating</span>
                    <span className="flex items-center gap-1"><Zap size={12}/> Auto Level</span>
                </div>
            </div>
        </div>
      )}

      {/* ---------------- MAIN EDITOR SECTION ---------------- */}
      {isEditorOpen && files.a && (
         <div className="p-6 md:p-12 max-w-7xl mx-auto w-full animate-in slide-in-from-bottom-8 duration-500">
            
            {/* Header Mini */}
            <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500">EchoGate AI</h2>
                <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
                    <span className={`w-2 h-2 rounded-full ${appState === AppState.PLAYING ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`}></span>
                    {appState}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                <div className="lg:col-span-2 space-y-6">
                    
                    {/* Analysis Loader */}
                    {appState === AppState.ANALYZING && (
                        <div className="bg-slate-800 rounded-xl p-8 text-center border border-slate-700 h-64 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300">
                            <Loader2 className="animate-spin text-purple-400 mb-4" size={48} />
                            <h3 className="text-xl font-bold mb-2">Analyzing Audio Dynamics</h3>
                            <p className="text-slate-400 mb-6">Generating smart gate profiles...</p>
                            <div className="w-full max-w-md h-2 bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-300" style={{ width: `${analysisProgress}%` }}></div>
                            </div>
                        </div>
                    )}

                    {/* Waveforms & Controls */}
                    {stats && (
                        <>
                            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 backdrop-blur-sm animate-in fade-in duration-500">
                                {files.a && <WaveformDisplay peaks={files.a.peaks} color={files.a.color} progress={currentTime/duration} label="Speaker 1" isActive={getActiveStatus('a')} onSeek={handleSeek} gainCurve={isBypassed ? undefined : stats?.gainCurveA} />}
                                {files.b && <WaveformDisplay peaks={files.b.peaks} color={files.b.color} progress={currentTime/duration} label="Speaker 2" isActive={getActiveStatus('b')} onSeek={handleSeek} gainCurve={isBypassed ? undefined : stats?.gainCurveB} />}
                                {files.c && <WaveformDisplay peaks={files.c.peaks} color={files.c.color} progress={currentTime/duration} label="Speaker 3" isActive={getActiveStatus('c')} onSeek={handleSeek} gainCurve={isBypassed ? undefined : stats?.gainCurveC} />}
                            </div>
                            
                            <Controls 
                                appState={appState} 
                                settings={settings}
                                isBypassed={isBypassed}
                                hasC={!!files.c}
                                onToggleBypass={handleToggleBypass}
                                onSettingsChange={setSettings}
                                onPlayPause={handlePlayPause}
                                onStop={handleStop}
                                onExport={handleExport}
                                onAnalyze={handleAIAnalysis}
                                onReset={resetApp}
                            />
                        </>
                    )}
                </div>

                {/* Sidebar */}
                {stats && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-700">
                         <CalibrationPanel calibration={stats.calibration} speakerCount={[files.a, files.b, files.c].filter(Boolean).length} />
                         <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 flex flex-col">
                            <div className="flex items-center gap-3 mb-6 border-b border-slate-700 pb-4">
                                <Bot className="text-purple-400" />
                                <div>
                                    <h2 className="font-bold text-lg">AI Assistant</h2>
                                    <p className="text-xs text-slate-400">Gemini 2.5 Flash</p>
                                </div>
                            </div>
                            
                            {geminiStatus === GeminiStatus.IDLE && (
                                <div className="text-center p-4 text-slate-500">
                                    <Wand2 size={40} className="mx-auto mb-2 opacity-20"/>
                                    <p className="text-sm">Ready to analyze conversation topics & tone.</p>
                                </div>
                            )}

                            {geminiStatus === GeminiStatus.GENERATING && (
                                <div className="text-center p-4">
                                    <Loader2 className="animate-spin mx-auto mb-2 text-purple-400" />
                                    <p className="text-sm text-purple-300">Listening & Analyzing...</p>
                                </div>
                            )}

                            {geminiStatus === GeminiStatus.COMPLETE && (
                                <div className="prose prose-invert prose-sm text-sm text-slate-300">
                                    {geminiResult.split('\n').map((l,i) => <p key={i}>{l}</p>)}
                                </div>
                            )}

                            <div className="mt-auto pt-6 border-t border-slate-700">
                                 <h3 className="text-xs font-bold uppercase text-slate-500 mb-3">Gate Statistics</h3>
                                 <div className="grid grid-cols-2 gap-4 text-center">
                                     <div className="bg-slate-900/50 p-2 rounded">
                                         <div className="text-xl font-mono text-cyan-400">{stats.totalSwitches}</div>
                                         <div className="text-[10px] text-slate-500 uppercase">Switches</div>
                                     </div>
                                     <div className="bg-slate-900/50 p-2 rounded">
                                         <div className="text-xl font-mono text-purple-400">{stats.overlapPercentage.toFixed(1)}%</div>
                                         <div className="text-[10px] text-slate-500 uppercase">Bleed</div>
                                     </div>
                                 </div>
                            </div>
                         </div>
                    </div>
                )}
            </div>
         </div>
      )}
      
      <footer className="mt-auto py-8 text-center text-slate-600 text-sm">
          Built by <a href="https://Yaniv.TV" target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-cyan-400 transition-colors">Yaniv Morozovsky</a>
      </footer>
    </div>
  );
}

export default App;