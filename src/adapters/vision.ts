import manifest from '../../docs/assets-manifest.json';
import type { CapturedFrame } from './camera';
import type { TrackingWorkerRequest, TrackingWorkerResponse } from './visionProtocol';
import { FRAME_CONFIG, VISION_CONFIG } from '../lib/config';
import type { FrameSample } from '../lib/schemas';
/** Local-only integrity preflight. No runtime CDN or media requests. */
export async function verifyLocalAssets(signal: AbortSignal): Promise<string> {
  for (const asset of manifest.assets) {
    const response = await fetch(`/${asset.path}`, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`Missing asset /${asset.path}. Run npm run assets:prepare, then npm run assets:verify.`);
    const bytes = await response.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== asset.sha256) throw new Error(`Invalid asset /${asset.path}. Run npm run assets:prepare, then npm run assets:verify.`);
  }
  return `Local asset checksums verified (${manifest.tasksVisionVersion}).`;
}
export interface VisionWorker {
  onmessage: ((event: MessageEvent<TrackingWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: TrackingWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}
export interface VisionTransport {
  readonly ready: Extract<TrackingWorkerResponse, { type: 'ready' }>;
  infer(bitmap: ImageBitmap, frame: CapturedFrame): Promise<Extract<TrackingWorkerResponse, { type: 'sample' }>>;
  dispose(): void;
}
export interface VisionDependencies { worker(): VisionWorker; probe(): Promise<ImageBitmap>; origin: string }
export const browserVisionDependencies = (): VisionDependencies => ({
  worker: () => new Worker(new URL('../workers/handTracking.worker.ts', import.meta.url), { type: 'module' }),
  probe: () => { const canvas = document.createElement('canvas'); canvas.width = VISION_CONFIG.widthPixels; canvas.height = VISION_CONFIG.heightPixels; return createImageBitmap(canvas); },
  origin: location.origin,
});
/** Ready means the actual transferred bitmap passed detectForVideo in the worker.
 * Graceful dispose allows close()/bitmap finally; bounded termination handles hung WASM. */
export function createVisionTransport(signal: AbortSignal, onFault: (message: string) => void, deps: VisionDependencies = browserVisionDependencies()): Promise<VisionTransport> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Vision cancelled', 'AbortError')); return; }
    const worker = deps.worker();
    let closed = false, settled = false, stage: 'initializing'|'probing'|'ready' = 'initializing';
    let pending: { frame: CapturedFrame; resolve: (sample: Extract<TrackingWorkerResponse, { type: 'sample' }>) => void; reject: (error: Error) => void } | null = null;
    let resultTimer: ReturnType<typeof setTimeout> | undefined, shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    const startupTimer = setTimeout(() => fail('MediaPipe initialization/probe exceeded 30 seconds. Check local assets and browser worker/WebGL support.'), VISION_CONFIG.startupDeadlineMs);
    function terminate() { clearTimeout(shutdownTimer); worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); }
    function dispose() {
      if (closed) return; closed = true;
      signal.removeEventListener('abort', dispose); clearTimeout(startupTimer); clearTimeout(resultTimer);
      const error = new DOMException('Vision cancelled', 'AbortError');
      if (!settled) { settled = true; reject(error); }
      pending?.reject(error); pending = null;
      shutdownTimer = setTimeout(terminate, VISION_CONFIG.shutdownDeadlineMs);
      try { worker.postMessage({ type: 'dispose' }); } catch { terminate(); }
    }
    function fail(message: string) {
      if (closed) return;
      const wasReady = settled;
      if (!settled) { settled = true; reject(new Error(message)); }
      pending?.reject(new Error(message)); pending = null; dispose();
      if (wasReady) onFault(message);
    }
    worker.onerror = event => fail(`Vision worker error: ${event.message || 'Failed to load worker'}. Stop and retry.`);
    worker.onmessageerror = () => fail('Vision worker message could not be decoded. Stop and retry.');
    worker.onmessage = event => {
      const response = event.data;
      if (response.type === 'disposed') { terminate(); return; }
      if (closed) return;
      if (response.type === 'error') { fail(response.message); return; }
      if (response.type === 'initialized') {
        if(stage!=='initializing'){fail('Unexpected worker initialization response');return;}stage='probing';
        void Promise.resolve().then(()=>deps.probe()).then(bitmap => {
          if (closed) { bitmap.close(); return; }
          try { worker.postMessage({ type: 'probe', bitmap }, [bitmap]); }
          catch (error) { bitmap.close(); fail(`Bitmap transfer probe failed: ${String(error)}`); }
        }).catch(error => fail(`Cannot create bitmap probe: ${String(error)}`));
      } else if (response.type === 'ready') {
        if (settled||stage!=='probing') { fail('Unexpected worker readiness response before bitmap probe'); return; }
        if(!Number.isFinite(response.probeDurationMs)||response.probeDurationMs<0){fail('Invalid bitmap probe timing');return;}
        stage='ready';
        settled = true; clearTimeout(startupTimer);
        resolve({ ready: response, dispose, infer(bitmap, frame) {
          if (closed || pending) { bitmap.close(); return Promise.reject(new Error(closed ? 'Vision transport closed' : 'Inference already in flight')); }
          return new Promise((res, rej) => {
            pending = { frame, resolve: res, reject: rej };
            resultTimer = setTimeout(() => fail('Vision worker stalled for 5 seconds. Stop and retry; no queued frames were retained.'), VISION_CONFIG.resultDeadlineMs);
            try { worker.postMessage({ type: 'frame', ...frame, bitmap }, [bitmap]); }
            catch (error) { bitmap.close(); fail(`Frame transfer failed: ${String(error)}`); }
          });
        } });
      } else if (response.type === 'sample') {
        if (!pending || response.sample.sequence !== pending.frame.sequence || response.sample.captureTimeMs !== pending.frame.captureTimeMs) { fail('Vision worker returned an unexpected sequence/timestamp'); return; }
        clearTimeout(resultTimer); const owned = pending; pending = null; owned.resolve(response);
      }
    };
    signal.addEventListener('abort', dispose, { once: true });
    try { worker.postMessage({ type: 'init', origin: deps.origin }); }
    catch (error) { fail(`Cannot initialize vision worker: ${String(error)}`); }
  });
}

export interface InferencePumpDependencies {
  bitmap(): Promise<ImageBitmap>;
  infer(bitmap: ImageBitmap, frame: CapturedFrame): Promise<{ sample: FrameSample; durationMs: number }>;
  now(): number;
  minIntervalMs: number;
  result(sample: FrameSample): void;
  measurement(durationMs: number, ageMs: number, validity: FrameSample['validity']): void;
  fault(message: string): void;
}
/** Busy includes bitmap creation, transfer and inference. Dropped frames never allocate a bitmap. */
export function createInferencePump(deps: InferencePumpDependencies) {
  let closed = false, busy = false, lastSubmitted = -Infinity, lastSequence = -1, lastCapture = -1, lastResult = -1;
  return { close() { closed = true; }, submit(frame: CapturedFrame) {
    if (closed || frame.sequence <= lastSequence || frame.captureTimeMs <= lastCapture) return;
    lastSequence = frame.sequence; lastCapture = frame.captureTimeMs;
    if (busy || frame.captureTimeMs - lastSubmitted < deps.minIntervalMs) return;
    busy = true; lastSubmitted = frame.captureTimeMs;
    void (async () => {
      try {
        const bitmap = await deps.bitmap();
        if (closed) { bitmap.close(); return; }
        // infer owns the bitmap on every path, including transfer failure.
        const response = await deps.infer(bitmap, frame);
        if (closed) return;
        const age = deps.now() - response.sample.captureTimeMs;
        if (!Number.isFinite(response.durationMs) || response.durationMs < 0 || age < 0 || !Number.isFinite(age)) throw new Error('Invalid inference timing');
        deps.measurement(response.durationMs, age, response.sample.validity);
        if (response.sample.sequence <= lastResult || response.sample.sequence !== frame.sequence || response.sample.captureTimeMs !== frame.captureTimeMs) throw new Error('Mismatched inference result');
        lastResult = response.sample.sequence;
        if (age <= FRAME_CONFIG.maxAgeMs) deps.result(response.sample);
      } catch (error) { if (!closed) deps.fault(error instanceof Error ? error.message : 'Inference failed'); }
      finally { busy = false; }
    })();
  } };
}
