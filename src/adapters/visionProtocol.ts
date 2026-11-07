import { FrameSampleSchema } from '../lib/schemas';
import type { FrameSample } from '../lib/schemas';
// Narrow only the fields consumed; SDK result landmarks may carry optional metadata.
interface ModelResult { landmarks: readonly (readonly { x:number; y:number; z:number }[])[]; worldLandmarks: readonly (readonly { x:number; y:number; z:number }[])[]; handedness: readonly (readonly { categoryName:string; score:number }[])[] }
export type Delegate = 'GPU' | 'CPU';
export type TrackingWorkerRequest =
  | { type: 'init'; origin: string }
  | { type: 'probe'; bitmap: ImageBitmap }
  | { type: 'frame'; sequence: number; captureTimeMs: number; bitmap: ImageBitmap }
  | { type: 'dispose' };
export type TrackingWorkerResponse =
  | { type: 'initialized' }
  | { type: 'ready'; delegate: Delegate; fallbackReason: string | null; probeDurationMs: number }
  | { type: 'sample'; sample: FrameSample; durationMs: number }
  | { type: 'disposed' }
  | { type: 'error'; message: string };
/** A malformed model result becomes explicit absence/invalidity, never zero landmarks. */
export function modelSample(result: ModelResult, sequence: number, captureTimeMs: number): FrameSample {
  const category = result.handedness[0]?.[0];
  const hand: 'Left' | 'Right' = category?.categoryName === 'Left' ? 'Left' : 'Right';
  const base = { sequence, captureTimeMs, selectedHand: hand };
  if (result.landmarks.length === 0) return { ...base, validity: 'absent', reason: 'no_hand' };
  const parsed = FrameSampleSchema.safeParse({ ...base, validity: 'valid', imageLandmarks: result.landmarks[0]?.map(({x,y,z})=>({x,y,z})), worldLandmarks: result.worldLandmarks[0]?.map(({x,y,z})=>({x,y,z})), handedness: { label: category?.categoryName, confidence: category?.score } });
  return parsed.success ? parsed.data : { ...base, validity: 'invalid', reason: 'malformed' };
}
