import { syntheticFrames } from '../../fixtures/syntheticHand';
import type { AdapterEvent, SessionAdapter } from '../engine/contracts';
/** Browser scheduling only; no exercise/scoring algorithms. One bounded fixture, cancellable. */
export function createReplayAdapter(now: () => number): SessionAdapter {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let generation = 0;
  const stop = () => { generation++; clearTimeout(timer); timer = undefined; };
  return {
    source: 'synthetic_replay',
    async prepare() { if (disposed) throw new Error('Replay adapter disposed'); },
    play(emit: (event: AdapterEvent) => void) {
      if (disposed) throw new Error('Replay adapter disposed');
      stop();
      const token=generation;
      const anchor = now();
      let index = 0;
      const next = () => {
        if (disposed || token!==generation) return;
        const sample = syntheticFrames[index];
        if (!sample) { emit({ type: 'end' }); return; }
        // Browser timers can wake before a fractional performance-clock deadline.
        // Recheck the capture deadline rather than emitting a future timestamp.
        const remainingMs=anchor+sample.captureTimeMs-now();
        if(remainingMs>0){timer=setTimeout(next,Math.ceil(remainingMs));return;}
        index++;
        emit({ type: 'frame', sample: { ...sample, captureTimeMs: anchor+sample.captureTimeMs } });
        if(disposed||token!==generation)return;
        const delay = Math.max(0, Math.ceil(anchor+(syntheticFrames[index]?.captureTimeMs ?? sample.captureTimeMs+50)-now()));
        timer = setTimeout(next, delay);
      };
      next();
    },
    stop,
    dispose() { disposed = true; stop(); },
  };
}
