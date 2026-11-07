import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { ControllerCommands, FrameBuffer, SessionSnapshot } from '../../engine/contracts';
import { canvasBackingSize } from '../../lib/coordinates';
import { drawReplayPreview } from '../../rendering/replayPreview';
export interface ViewProps { snapshot: SessionSnapshot; commands: ControllerCommands; frameBuffer: RefObject<FrameBuffer> }
export function Controls({ snapshot: s, commands: c }: ViewProps) {
  const live=s.source==='live';
  return <section aria-labelledby="controls"><h2 id="controls">Controls</h2>
    <label>Exercise <select value={s.selection.exercise+':'+s.selection.sensorMode} onChange={e => {
      const value = e.target.value;
      c.selectExercise(value === 'air_targets:vision_only' ? { exercise: 'air_targets', sensorMode: 'vision_only' } : { exercise: 'desk_tap', sensorMode: value === 'desk_tap:fused' ? 'fused' : 'kinematic_only' });
    }}><option value="air_targets:vision_only">Air / vision only</option><option value="desk_tap:fused">Desk / fused</option><option value="desk_tap:kinematic_only">Desk / kinematic only</option></select></label>
    <div><button disabled={!['idle','error'].includes(s.phase)} onClick={() => void c.startDevices()}>{live?'Start camera':'Start replay adapter'}</button><button disabled={!['ready','calibrated','complete'].includes(s.phase)} onClick={c.calibrate}>{live?'Calibrate palm':'Calibrate synthetic palm'}</button><button disabled={live || s.phase !== 'calibrated'} onClick={c.startExercise}>{live?'Live air trials (phase 4)':'Start synthetic trial'}</button><button onClick={c.stop}>Stop</button><button onClick={c.reset}>Reset</button></div>
  </section>;
}
export function Status({ snapshot: s }: ViewProps) {
  return <section aria-labelledby="status"><h2 id="status">Calibration and status</h2><p role="status">{s.phase}: {s.message}</p><p>Calibration: {s.calibrationStatus}. Tracking: {s.tracking}. Sensor selection: {s.selection.sensorMode} ({s.source}).</p><p>{s.calibrationMessage}</p><p>Estimated index PIP: {s.metrics.estimatedPipDeg?.toFixed(1) ?? 'not measured'}°. DIP estimate: {s.metrics.estimatedDipDeg?.toFixed(1) ?? 'not measured'}°. MCP proxy estimate: {s.metrics.estimatedMcpProxyDeg?.toFixed(1) ?? 'not measured'}°.</p><p>Air reps: {s.metrics.acceptedCount ?? 'not measured'}. Attempts: {s.air?.attempts ?? 'not measured'}. Blocked attempts: {s.air?.blockedAttempts ?? 'not measured'}. Lockout events: {s.air?.lockoutEvents ?? 'not measured'}. Palm orientation deviation proxy: {s.air?.deviationDeg?.toFixed(1) ?? 'not measured'}° {s.air?.locked ? 'locked' : ''}.</p><p>Live air exercises are phase 4. Desk calibration, microphone, and results export are pending later phases.</p></section>;
}
export function Viewport({ frameBuffer, snapshot: s }: ViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let callback = 0;
    const draw = () => {
      const element=canvas.current,context=element?.getContext('2d');
      if(element&&context){
        const viewport={width:element.clientWidth,height:element.clientHeight};
        if(viewport.width>0&&viewport.height>0){const dpr=window.devicePixelRatio||1,backing=canvasBackingSize(viewport,dpr);
          if(element.width!==backing.width||element.height!==backing.height){element.width=backing.width;element.height=backing.height;}
          context.setTransform(dpr,0,0,dpr,0,0);drawReplayPreview(context,frameBuffer.current,viewport,performance.now());frameBuffer.current.recordRender?.();
        }
      }
      callback=requestAnimationFrame(draw);
    };
    callback = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(callback);
  }, [frameBuffer]);
  return <section aria-labelledby="viewport"><h2 id="viewport">{s.source==='live'?'Live camera viewport':'Synthetic replay viewport'}</h2><p>Video and skeleton use the same mirrored contain-fit coordinates. Hold one open palm still and fully in view. Model handedness: {frameBuffer.current.current?.validity==='valid'?frameBuffer.current.current.selectedHand:'not observed'}.</p><canvas ref={canvas} width={640} height={360} aria-label={s.source==='live'?'Mirrored live video and hand skeleton':'Artificial fixture landmarks, not live camera data'} /></section>;
}
export function Diagnostics({ snapshot: s }: ViewProps) {
  const d=s.diagnostics, value=(n:number|null|undefined)=>n?.toFixed(1)??'not measured';
  return <details><summary>Diagnostics</summary><dl>
    <dt>Fixture frames received</dt><dd>{d.replayFrames}</dd>
    <dt>Render / inference FPS</dt><dd>{value(d.renderFps)} / {value(d.inferenceFps)}</dd>
    <dt>Last inference duration / capture-to-result age (ms)</dt><dd>{value(d.inferenceDurationMs)} / {value(d.resultAgeMs)}</dd>
    <dt>Rolling p95 result age (ms)</dt><dd>{value(d.p95ResultAgeMs)}; {d.measuredResults??0} results ({d.trackedResults??0} tracked) over {value(d.measurementSeconds)} seconds (60-second maximum window)</dd>
    <dt>Delegate / throttle</dt><dd>{d.delegate} / {d.throttleMs??0} ms minimum interval. {d.fallbackReason??''}</dd>
    <dt>Pipeline</dt><dd>{d.pipeline??'not started'}. {d.pipelineProof??''}</dd>
    <dt>Camera / source dimensions</dt><dd>{d.camera??'not started'} / {d.sourceWidth??'—'} × {d.sourceHeight??'—'}</dd>
    <dt>Browser</dt><dd>{d.browser??'not started'}</dd>
    <dt>Scheduling / capture clock</dt><dd>{d.scheduling??'not started'} / {d.captureClock??'not started'}. Presentation/observation timestamps are browser frame-time proxies, not verified sensor exposure times.</dd>
  </dl><p>Demo hardware targets: 60 render FPS, ≥24 inference FPS, p95 age ≤120 ms. CPU fallback is explicitly capped at 20 Hz and needs tuning/retest to meet the inference gate. A blank-bitmap pipeline probe does not verify tracking accuracy or live hardware acceptance.</p></details>;
}
export function AssetStatus({ snapshot: s }: ViewProps) { return <p role="status">Assets: {s.diagnostics.assets}. {s.diagnostics.assetMessage}</p>; }
export function Results({ snapshot: s }: ViewProps) {
  return <section aria-labelledby="results"><h2 id="results">Results</h2><p>{s.result ? 'Validated session summary available.' : 'Validated summary, taps, rates, and ROM aggregation: not available yet (phase 6).'}</p><button disabled>Export validated summary (phase 6)</button></section>;
}
