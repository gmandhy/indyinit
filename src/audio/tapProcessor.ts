import type { AudioImpulse } from '../lib/schemas';
/** Worklet message contract only. Phase 5 implements and compiles the processor. Never post PCM. */
export type TapProcessorMessage = { type: 'impulse'; impulse: AudioImpulse } | { type: 'level'; sampleTimeMs: number; rms: number } | { type: 'error'; message: string };
