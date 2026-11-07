/** Phase 5: sampleTimeMs = audio sample time + this explicit shared-clock anchor. No PCM in snapshots. */
export interface AudioClockAnchor { readonly audioTimeSeconds: number; readonly sessionTimeMs: number }
export const AUDIO_IMPLEMENTATION = 'not_implemented' as const;
