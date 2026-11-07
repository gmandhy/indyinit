import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { modelSample } from '../adapters/visionProtocol';
import type { Delegate, TrackingWorkerRequest, TrackingWorkerResponse } from '../adapters/visionProtocol';
import { VISION_CONFIG } from '../lib/config';
// Scoped worker surface; keep DOM and worker globals out of the shared TS global namespace.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<TrackingWorkerRequest>) => void) | null;
  postMessage(message: TrackingWorkerResponse): void;
  close(): void;
};
let landmarker: HandLandmarker | null = null, disposed = false, origin = '', delegate: Delegate = 'GPU', fallbackReason: string | null = null;
let lastTime = -1, lastSequence = -1;
function release() { landmarker?.close(); landmarker = null; }
async function initialize(selected: Delegate) {
  release();
  const files = await FilesetResolver.forVisionTasks(`${origin}/mediapipe/wasm`, true);
  if (disposed) return;
  const owned = await HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: `${origin}/models/hand_landmarker.task`, delegate: selected },
    canvas: new OffscreenCanvas(VISION_CONFIG.widthPixels, VISION_CONFIG.heightPixels),
    runningMode: 'VIDEO', numHands: 1,
    minHandDetectionConfidence: VISION_CONFIG.confidence, minHandPresenceConfidence: VISION_CONFIG.confidence, minTrackingConfidence: VISION_CONFIG.confidence,
  });
  if (disposed) { owned.close(); return; }
  landmarker = owned; delegate = selected;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
scope.onmessage = event => { void handle(event.data); };
async function handle(request: TrackingWorkerRequest) {
  if (request.type === 'dispose') { disposed = true; release(); scope.postMessage({ type: 'disposed' }); scope.close(); return; }
  if (disposed) { if ('bitmap' in request) request.bitmap.close(); return; }
  try {
    if (request.type === 'init') {
      origin = request.origin;
      try { await initialize('GPU'); }
      catch (error) { fallbackReason = `GPU initialization failed: ${message(error)}`; await initialize('CPU'); }
      if (!disposed) scope.postMessage({ type: 'initialized' });
    } else if (request.type === 'probe') {
      try {
        const start = performance.now();
        try { if (!landmarker) throw new Error('Landmarker unavailable'); landmarker.detectForVideo(request.bitmap, 0); }
        catch (error) {
          if (delegate === 'CPU') throw error;
          fallbackReason = `GPU bitmap probe failed: ${message(error)}`;
          await initialize('CPU');
          if (disposed) return;
          landmarker!.detectForVideo(request.bitmap, 0);
        }
        if (!disposed) scope.postMessage({ type: 'ready', delegate, fallbackReason, probeDurationMs: performance.now() - start });
      } finally { request.bitmap.close(); }
    } else {
      try {
        if (!landmarker) throw new Error('Landmarker unavailable');
        if (request.sequence <= lastSequence || request.captureTimeMs <= lastTime) throw new Error('Nonmonotonic inference input');
        lastSequence = request.sequence; lastTime = request.captureTimeMs;
        const start = performance.now(), result = landmarker.detectForVideo(request.bitmap, request.captureTimeMs);
        scope.postMessage({ type: 'sample', sample: modelSample(result, request.sequence, request.captureTimeMs), durationMs: performance.now() - start });
      } finally { request.bitmap.close(); }
    }
  } catch (error) { release(); if (!disposed) scope.postMessage({ type: 'error', message: `Local MediaPipe worker failed: ${message(error)}. Verify assets; Stop and retry. Worker/OffscreenCanvas/WebGL2 support is required.` }); }
}
