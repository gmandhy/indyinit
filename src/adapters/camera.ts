/** Owned camera only: audio permission is never coupled to video. */
export interface CameraConfiguration { readonly width: number; readonly height: number }
export interface CameraOwner {
  readonly video: HTMLVideoElement;
  open(signal: AbortSignal): Promise<void>;
  close(): void;
}
export function cameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const reasons: Record<string, string> = {
    NotAllowedError: 'Camera permission denied. Allow camera access for this origin, then Start camera again.',
    NotFoundError: 'No camera found. Connect a camera, then retry.',
    NotReadableError: 'Camera is unavailable or busy in another application. Release it, then retry.',
    OverconstrainedError: 'Camera cannot satisfy the requested video settings. Try another camera.',
    SecurityError: 'Camera access requires HTTPS or localhost and an allowed camera policy.',
  };
  return reasons[name] ?? (error instanceof Error ? error.message : 'Unknown camera error');
}
export function createCamera(onError: (message: string) => void, deps = {
  getUserMedia: (constraints: MediaStreamConstraints) => {
    if(!navigator.mediaDevices?.getUserMedia)throw new DOMException('Camera API unavailable','SecurityError');
    return navigator.mediaDevices.getUserMedia(constraints);
  },
  video: () => document.createElement('video'),
}): CameraOwner {
  const video = deps.video();
  video.muted = true; video.playsInline = true;
  let stream: MediaStream | null = null, closed = false;
  const ended = () => onError('Camera track ended or device was disconnected. Start camera again.');
  const failed = () => onError('Camera playback failed. Stop and retry the camera.');
  let width=0,height=0;
  const resize = () => { if(video.videoWidth!==width||video.videoHeight!==height)onError(`Camera source dimensions changed (${width}×${height} -> ${video.videoWidth}×${video.videoHeight}). Restart and recalibrate.`); };
  function close() {
    if (closed) return;
    closed = true;
    video.removeEventListener('error', failed); video.removeEventListener('resize', resize);
    for (const track of stream?.getTracks() ?? []) { track.removeEventListener('ended', ended); track.stop(); }
    stream = null; video.pause(); video.srcObject = null; video.removeAttribute('src'); video.load();
  }
  return { video, close, async open(signal) {
    signal.addEventListener('abort', close, { once: true });
    if (signal.aborted || closed) throw new DOMException('Camera cancelled', 'AbortError');
    try {
      const acquired = await deps.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false });
      if (signal.aborted || closed) { for (const track of acquired.getTracks()) track.stop(); throw new DOMException('Camera cancelled', 'AbortError'); }
      stream = acquired;
      for (const track of stream.getTracks()) track.addEventListener('ended', ended);
      video.addEventListener('error', failed); video.srcObject = stream;
      await video.play();
      if (signal.aborted || closed) throw new DOMException('Camera cancelled', 'AbortError');
      if (!video.videoWidth || !video.videoHeight) throw new Error('Camera returned no video dimensions. Stop and retry.');
      // The first metadata resize has already happened; subsequent geometry changes invalidate setup.
      width=video.videoWidth;height=video.videoHeight;video.addEventListener('resize', resize);
    } catch (error) { close(); throw new Error(cameraError(error)); }
    finally { signal.removeEventListener('abort', close); }
  } };
}

export interface CapturedFrame { sequence: number; captureTimeMs: number }
export type CaptureClock = 'captureTime' | 'presentationTime' | 'observed_currentTime';
/** No timer queue. Each decoded frame is observed once; busy inference drops it. */
export function scheduleCameraFrames(video: HTMLVideoElement, onFrame: (frame: CapturedFrame) => void,
  onClock: (clock: CaptureClock) => void, now = () => performance.now(), raf = requestAnimationFrame, cancelRaf = cancelAnimationFrame) {
  let stopped = false, callback = 0, sequence = 0, lastMediaTime = -1, lastCapture = -1;
  const hasVfc = typeof video.requestVideoFrameCallback === 'function';
  function deliver(mediaTime: number, capture: number, clock: CaptureClock) {
    if (mediaTime === lastMediaTime || !Number.isFinite(mediaTime)) return;
    lastMediaTime = mediaTime;
    if (!Number.isFinite(capture) || capture < 0 || capture <= lastCapture || capture > now()) return;
    lastCapture = capture; onClock(clock); onFrame({ sequence: sequence++, captureTimeMs: capture });
  }
  function frame(t: number, metadata?: VideoFrameCallbackMetadata) {
    if (stopped) return;
    if (video.readyState >= 2) {
      const capture = metadata?.captureTime;
      if (capture !== undefined && Number.isFinite(capture) && capture >= 0 && capture <= now()) deliver(metadata!.mediaTime, capture, 'captureTime');
      else if (metadata) deliver(metadata.mediaTime, Math.min(metadata.presentationTime, t), 'presentationTime');
      else deliver(video.currentTime, t, 'observed_currentTime');
    }
    if (!stopped) callback = hasVfc ? video.requestVideoFrameCallback(frame) : raf(frame);
  }
  callback = hasVfc ? video.requestVideoFrameCallback(frame) : raf(frame);
  return () => { if (stopped) return; stopped = true; if (hasVfc) video.cancelVideoFrameCallback(callback); else cancelRaf(callback); };
}
