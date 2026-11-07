import type { AirTargetState } from '../lib/spatialTargets';
import type { Size } from '../lib/coordinates';
import type { AudioImpulse, Calibration, FrameSample, SessionTelemetry } from '../lib/schemas';
export type ExerciseSelection = { exercise: 'air_targets'; sensorMode: 'vision_only' } | { exercise: 'desk_tap'; sensorMode: 'fused' | 'kinematic_only' };
export type SessionPhase = 'idle' | 'requesting' | 'ready' | 'calibrating' | 'calibrated' | 'countdown' | 'running' | 'complete' | 'error';
export interface SessionSnapshot {
  readonly source: 'live' | 'synthetic_replay';
  readonly selection: ExerciseSelection;
  readonly phase: SessionPhase;
  readonly message: string;
  readonly calibration: Calibration | null;
  readonly calibrationStatus: 'not_started' | 'unavailable' | 'collecting' | 'valid';
  readonly tracking: 'not_started' | FrameSample['validity'];
  readonly target: { readonly id: string; readonly state: 'idle' | 'active' | 'accepted' } | null;
  readonly air: AirTargetState | null;
  readonly calibrationMessage: string;
  readonly metrics: { readonly rawEstimatedPipDeg:number|null; readonly estimatedPipDeg: number | null; readonly estimatedDipDeg:number|null; readonly estimatedMcpProxyDeg:number|null; readonly acceptedCount: number | null };
  readonly diagnostics: SessionDiagnostics;
  readonly result: SessionTelemetry | null;
}
/** Numeric-only diagnostics; media never enters a UI snapshot. */
export interface SessionDiagnostics {
  readonly replayFrames: number;
  readonly renderFps: number | null;
  readonly inferenceFps: number | null;
  readonly inferenceDurationMs: number | null;
  readonly resultAgeMs: number | null;
  readonly delegate: 'not_started' | 'GPU' | 'CPU';
  readonly assets: 'unchecked' | 'verified' | 'missing';
  readonly assetMessage: string;
  readonly measurementSeconds?: number;
  readonly measuredResults?: number;
  readonly trackedResults?: number;
  readonly p95ResultAgeMs?: number | null;
  readonly pipeline?: string;
  readonly pipelineProof?: string;
  readonly fallbackReason?: string | null;
  readonly camera?: string;
  readonly browser?: string;
  readonly sourceWidth?: number;
  readonly sourceHeight?: number;
  readonly captureClock?: string;
  readonly scheduling?: string;
  readonly throttleMs?: number;
}
export interface ControllerCommands {
  tick(): void;
  setHidden(hidden:boolean):void;
  startDevices(): Promise<void>;
  calibrate(): void;
  startExercise(): void;
  stop(): void;
  reset(): void;
  selectExercise(selection: ExerciseSelection): void;
  dispose(): void;
}
export interface FrameBuffer { current: FrameSample | null; target?: AirTargetState | null; video?: Size; media?: HTMLVideoElement | null; recordRender?: () => void }
export interface SessionController extends ControllerCommands {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  readonly frameBuffer: FrameBuffer;
}
export type AdapterEvent = { type: 'frame'; sample: FrameSample } | { type: 'audio'; impulse: AudioImpulse } | { type: 'end' } | { type: 'error'; message: string };
/** Device access and browser scheduling belong in adapters. Events carry capture time, never media.
 * Implementations must cancel pending work on stop/dispose and release resources from late preparation.
 */
export interface SessionAdapter {
  readonly source: SessionSnapshot['source'];
  getVideo?(): HTMLVideoElement | null;
  getDiagnostics?(): Partial<SessionSnapshot['diagnostics']>;
  recordRender?(): void;
  prepare(): Promise<void>;
  play(emit: (event: AdapterEvent) => void): void;
  stop(): void;
  dispose(): void;
}
export function initialSnapshot(source: SessionSnapshot['source']): SessionSnapshot {
  return { source, selection: { exercise: 'air_targets', sensorMode: 'vision_only' }, phase: 'idle', message: source === 'live' ? 'Start camera to request video only. Microphone is not used in phase 3.' : 'Start the synthetic adapter. No camera or microphone is used.', calibration: null, calibrationStatus: 'not_started', tracking: 'not_started', target: null, air:null, calibrationMessage:'Not started', metrics: { rawEstimatedPipDeg:null, estimatedPipDeg: null, estimatedDipDeg:null, estimatedMcpProxyDeg:null, acceptedCount: null }, diagnostics: { replayFrames: 0, renderFps: null, inferenceFps: null, inferenceDurationMs: null, resultAgeMs: null, delegate: 'not_started', assets: 'unchecked', assetMessage: 'Asset verification has not run.' }, result: null };
}
