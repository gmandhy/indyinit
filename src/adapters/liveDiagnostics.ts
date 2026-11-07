import { VISION_CONFIG } from '../lib/config';
/** Bounded numeric-only rolling window. No media/landmarks/device IDs are recorded. */
export function createLiveMeasurements(now: () => number) {
  const started = now();
  let renders: number[] = [], results: { at: number; age: number; tracked:boolean }[] = [], duration: number | null = null;
  return {
    render(at: number) { renders.push(at); if (renders.length > 10000) renders.shift(); },
    inference(durationMs: number, ageMs: number, validity: 'valid'|'absent'|'invalid' = 'absent') { duration = durationMs; results.push({ at: now(), age: ageMs, tracked:validity==='valid' }); if (results.length > 10000) results.shift(); },
    read() {
      const t = now(), cutoff = Math.max(started, t - VISION_CONFIG.measurementWindowMs), elapsed = t - cutoff;
      renders = renders.filter(at => at >= cutoff); results = results.filter(item => item.at >= cutoff);
      const ages = results.map(item => item.age).sort((a, b) => a - b);
      return { measurementSeconds: elapsed / 1000, renderFps: elapsed >= 1000 ? renders.length * 1000 / elapsed : null,
        inferenceFps: elapsed >= 1000 ? results.length * 1000 / elapsed : null, inferenceDurationMs: duration,
        resultAgeMs: results.at(-1)?.age ?? null, p95ResultAgeMs: ages.length ? ages[Math.ceil(ages.length * .95) - 1]! : null,
        measuredResults: results.length, trackedResults:results.filter(item=>item.tracked).length };
    },
  };
}
