import { createCamera, scheduleCameraFrames } from './camera';
import type { CameraOwner, CaptureClock } from './camera';
import { createInferencePump, createVisionTransport, verifyLocalAssets } from './vision';
import type { VisionTransport } from './vision';
import { createLiveMeasurements } from './liveDiagnostics';
import type { AdapterEvent, SessionAdapter, SessionSnapshot } from '../engine/contracts';
import { VISION_CONFIG } from '../lib/config';
export interface LiveDependencies {
  now(): number;
  camera(fault: (message: string) => void): CameraOwner;
  assets(signal: AbortSignal): Promise<string>;
  vision(signal: AbortSignal, fault: (message: string) => void): Promise<VisionTransport>;
  schedule: typeof scheduleCameraFrames;
  bitmap(video: HTMLVideoElement): Promise<ImageBitmap>;
}
const browserDependencies = (): LiveDependencies => ({ now: () => performance.now(), camera: createCamera, assets: verifyLocalAssets,
  vision: createVisionTransport, schedule: scheduleCameraFrames, bitmap: video => createImageBitmap(video) });
/** One preparation owns all resources. stop invalidates it before cancelling asynchronous work. */
export function createLiveAdapter(deps: LiveDependencies = browserDependencies()): SessionAdapter {
  let disposed = false, generation = 0, abort: AbortController | null = null, camera: CameraOwner | null = null, vision: VisionTransport | null = null;
  let cancelFrames: (() => void) | null = null, pump: ReturnType<typeof createInferencePump> | null = null;
  let sink: ((event: AdapterEvent) => void) | null = null, measurements: ReturnType<typeof createLiveMeasurements> | null = null;
  let diagnostics: Partial<SessionSnapshot['diagnostics']> = {}, clock: CaptureClock | 'not_started' = 'not_started';
  function stop() {
    generation++; sink = null; cancelFrames?.(); cancelFrames = null; pump?.close(); pump = null;
    abort?.abort(); abort = null; camera?.close(); camera = null; vision?.dispose(); vision = null;
    if (measurements) diagnostics = { ...diagnostics, ...measurements.read() }; measurements = null;
  }
  return {
    source: 'live', stop, dispose() { if (disposed) return; disposed = true; stop(); },
    getVideo: () => camera?.video ?? null,
    getDiagnostics: () => ({ ...diagnostics, ...measurements?.read(), captureClock: clock }),
    recordRender: () => measurements?.render(deps.now()),
    async prepare() {
      if (disposed) throw new Error('Live adapter disposed');
      stop(); const token = generation, ownedAbort = new AbortController(); abort = ownedAbort;
      diagnostics = { assets: 'unchecked', assetMessage: 'Checking pinned local assets.' }; clock = 'not_started';
      let preparationFault: string | null = null;
      const fault = (message: string) => { if (token !== generation || disposed) return; const emit = sink; if(!emit)preparationFault=message; stop(); emit?.({ type: 'error', message }); };
      try {
        const assetMessage = await deps.assets(ownedAbort.signal);
        if (token !== generation || disposed) return;
        diagnostics = { assets: 'verified', assetMessage };
        const ownedCamera = deps.camera(fault); camera = ownedCamera;
        await ownedCamera.open(ownedAbort.signal);
        if (token !== generation || disposed) { ownedCamera.close(); if(preparationFault)throw new Error(preparationFault); return; }
        const ownedVision = await deps.vision(ownedAbort.signal, fault);
        if (token !== generation || disposed) { ownedVision.dispose(); if(preparationFault)throw new Error(preparationFault); return; }
        vision = ownedVision;
        diagnostics = { ...diagnostics, delegate: vision.ready.delegate, pipeline: 'worker / transferred ImageBitmap / OffscreenCanvas',
          pipelineProof: `detectForVideo bitmap probe passed (${vision.ready.probeDurationMs.toFixed(1)} ms)`,
          fallbackReason: vision.ready.fallbackReason, camera: ownedCamera.video.srcObject instanceof MediaStream ? (ownedCamera.video.srcObject.getVideoTracks()[0]?.label || 'Camera') : 'Camera',
          browser: navigator.userAgent, sourceWidth: ownedCamera.video.videoWidth, sourceHeight: ownedCamera.video.videoHeight,
          scheduling: typeof ownedCamera.video.requestVideoFrameCallback === 'function' ? 'requestVideoFrameCallback' : 'requestAnimationFrame (deduplicated)',
          throttleMs: vision.ready.delegate === 'CPU' ? VISION_CONFIG.cpuMinIntervalMs : 0 };
      } catch (error) {
        if(preparationFault)throw new Error(preparationFault);
        if (token !== generation || disposed) return;
        const assetsFailed = diagnostics.assets !== 'verified'; stop();
        if (assetsFailed) diagnostics = { ...diagnostics, assets: 'missing', assetMessage: error instanceof Error ? error.message : 'Local assets unavailable' };
        throw error;
      }
    },
    play(emit) {
      if (disposed || !camera || !vision || abort?.signal.aborted) throw new Error('Start camera before streaming');
      if (cancelFrames) throw new Error('Camera streaming already active');
      sink = emit; const token = generation, ownedCamera = camera, ownedVision = vision;
      measurements = createLiveMeasurements(deps.now);
      const ownedPump = createInferencePump({ bitmap: () => deps.bitmap(ownedCamera.video), infer: (bitmap, frame) => ownedVision.infer(bitmap, frame),
        now: deps.now, minIntervalMs: diagnostics.throttleMs ?? 0,
        result: sample => { if (token === generation) emit({ type: 'frame', sample }); },
        measurement: (duration, age, validity) => measurements?.inference(duration, age, validity),
        fault: message => { if (token === generation) { stop(); emit({ type: 'error', message }); } },
      }); pump = ownedPump;
      cancelFrames = deps.schedule(ownedCamera.video, frame => ownedPump.submit(frame), value => { clock = value; }, deps.now);
    },
  };
}
