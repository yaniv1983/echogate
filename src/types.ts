export interface AudioFile {
  id: string;
  file: File;
  name: string;
  duration: number;
  buffer: AudioBuffer | null;
  peaks: number[];
  color: string;
}

export interface ProcessingSettings {
  thresholdDb: number;
  isolationDb: number;
  attackMs: number;
  releaseMs: number;
  enableNoiseGate: boolean;

  // v2 — richer decision + smoother output
  duckDb: number;                // soft-duck depth (0 = hard mute, 18 = -18 dB)
  useCrossCorrelation: boolean;  // time-of-arrival winner detection
  useSpectralCue: boolean;       // HF/LF presence comparison
  lookAheadMs: number;           // pre-emptive gate opening for speech onsets
  multiHoldMs: number;           // min overlap duration before both gates open
  hysteresisDb: number;          // bias for currently-active speaker
}

export interface CalibrationProfile {
  floorDb: number[];
  speechDb: number[];
  // bleedDb[i][j] = level of channel j in dB while only speaker i is talking
  bleedDb: number[][];
  // leadLagSamples[i][j] = lag (in samples) of channel j relative to i during speaker i solo;
  // positive => i leads j (i is the direct mic)
  leadLagSamples: number[][];
  directPresenceDb: number[];
  bleedPresenceDb: number[];
  sampleRate: number;
  soloWindowCount: number[];
}

export interface ProcessingOptions {
  enhance: boolean;
  autoLevel: boolean;
  detectFillers: boolean;
}

export interface FillerMarker {
  word: string;
  start: number;
  end: number;
}

export interface DetectedLevels {
  floorA: number;
  floorB: number;
  floorC?: number;
  speechA: number;
  speechB: number;
  speechC?: number;
}

export interface GatingResult {
  gainCurveA: Float32Array;
  gainCurveB: Float32Array;
  gainCurveC?: Float32Array;
  totalSwitches: number;
  overlapPercentage: number;
  detectedLevels?: DetectedLevels;
  curveSampleRate: number;
  calibration?: CalibrationProfile;
}

export interface ProcessingState {
  message: string;
  progress: number;
}

export enum AppState {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  ANALYZING = 'ANALYZING',
  READY = 'READY',
  PLAYING = 'PLAYING',
  PROCESSING_EXPORT = 'PROCESSING_EXPORT',
}

export enum GeminiStatus {
  IDLE = 'IDLE',
  GENERATING = 'GENERATING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR',
}
