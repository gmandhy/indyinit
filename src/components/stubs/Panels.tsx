import { localSummary, telemetryJson } from '../../engine/telemetry';
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
    }}><option value="air_targets:vision_only">Air / vision only</option><option value="desk_tap:fused">Desk / fused coincidence</option><option value="desk_tap:kinematic_only">Desk / kinematic-only</option></select></label>
    <div><button disabled={!live||s.audio.state==='requesting'} onClick={()=>void c.startMicrophone()}>Start / retry microphone (keep quiet)</button><button disabled={!['idle','error'].includes(s.phase)} onClick={() => void c.startDevices()}>{live?'Start camera':'Start replay adapter'}</button><button disabled={s.trial?.settling||!['ready','calibrated','complete'].includes(s.phase)} onClick={c.calibrate}>{live?'Calibrate palm / begin setup':'Calibrate synthetic palm'}</button><button disabled={s.phase !== 'calibrated'} onClick={c.startExercise}>{live?(s.selection.exercise==='desk_tap'?(s.selection.sensorMode==='fused'?'Start fused trial':'Start kinematic trial'):'Start air trial'):'Start synthetic trial'}</button><button disabled={!['calibrating','calibrated','countdown','running','complete'].includes(s.phase)} onClick={c.cancelCalibration}>Cancel calibration / trial</button><button onClick={c.stop}>Stop</button><button onClick={c.reset}>Reset</button></div>
    {!live&&s.selection.exercise==='desk_tap'&&<p>Synthetic desk input: place the ring under the fixture fingertip, capture rest, then use <button onClick={c.replayTap}>Replay one lift / tap</button> once per visual cycle, timing pair, or trial tap. Artificial motion and +25 ms audio onset; no hardware evidence.</p>}
    {s.desk&&s.phase==='calibrating'&&<div><p>Desk setup: use a fixed oblique view with visible lift and return. {s.deskLayout==='left_right'?'Place Left in the mirrored video, capture rest and 3–5 cycles, then repeat for Right. Replacing the current ring clears its cycles; a saved Left pad stays available while setting up Right.':'Click inside the video to place or replace one ring under the resting fingertip. Placement again clears every guided cycle.'}</p><p>After capturing rest, record one lift and return per cycle. Start recording while resting; lift, return, hold still for at least three camera observations, then save. Record 3–5 cycles.</p>
      <button disabled={s.desk.setup?.stage!=='awaiting_rest'} onClick={c.captureDeskRest}>Capture resting fingertip</button>
      <button disabled={s.desk.setup?.stage!=='ready_cycle'||(s.desk.setup?.cycles??0)>=5} onClick={c.beginDeskCycle}>Record one lift / return</button>
      <button disabled={s.desk.setup?.stage!=='recording'} onClick={c.saveDeskCycle}>Save this cycle</button>
      <button disabled={s.desk.setup?.stage!=='ready_cycle'||(s.desk.setup?.cycles??0)<3} onClick={c.finishDeskCalibration}>Finish visual calibration</button>
      <p>Step: {s.desk.placing?'place ring':s.desk.setup?.stage}. Samples in step: {s.desk.setup?.samples??0}. Guided cycles: {s.desk.setup?.cycles??0}/3–5.</p></div>}
    {s.fusion.timingRequired&&<div><p>Timing setup: record 3–5 additional single taps, spaced ≥600 ms. Exactly one visual candidate and one acoustic onset per recording; avoid other sounds. Save ≥250 ms after contact.</p><button disabled={s.fusion.timingRecording||s.fusion.timingPairs>=5||live&&s.audio.state!=='ready'} onClick={c.beginTimingPair}>Record timing tap</button><button disabled={!s.fusion.timingRecording} onClick={c.saveTimingPair}>Save timing pair</button><button disabled={s.fusion.timingRecording||s.fusion.timingPairs<3} onClick={c.finishTimingCalibration}>Finish timing calibration</button><p>Timing pairs: {s.fusion.timingPairs}/3–5.</p></div>}
  </section>;
}
export function Status({ snapshot: s }: ViewProps) {
  return <section aria-labelledby="status"><h2 id="status">Calibration and status</h2><p>Microphone: {s.audio.state}. {s.audio.message}</p><p role="status">{s.phase}: {s.message}</p><p>Calibration: {s.calibrationStatus}. Tracking: {s.tracking}. Sensor selection: {s.selection.sensorMode} ({s.source}).</p><p>{s.calibrationMessage}</p><p>Estimated index PIP: {s.metrics.estimatedPipDeg?.toFixed(1) ?? 'not measured'}°. DIP estimate: {s.metrics.estimatedDipDeg?.toFixed(1) ?? 'not measured'}°. MCP proxy estimate: {s.metrics.estimatedMcpProxyDeg?.toFixed(1) ?? 'not measured'}°.</p><p>Air reps: {(s.selection.exercise==='air_targets'?s.metrics.acceptedCount:null) ?? 'not measured'}. Attempts: {s.air?.attempts ?? 'not measured'}. Blocked attempts: {s.air?.blockedAttempts ?? 'not measured'}. Lockout events: {s.air?.lockoutEvents ?? 'not measured'}. Palm orientation deviation proxy: {s.air?.deviationDeg?.toFixed(1) ?? 'not measured'}° {s.air?.locked ? 'locked' : ''}. Dwell: {s.air?.dwellElapsedMs.toFixed(0)??'not measured'} ms. {s.air?.requiresRelease?'Exit target to rearm.':''}</p>
    {s.desk&&<p>Visual candidates: {s.desk.visualCandidateCount}. Detector: {s.desk.visual?.phase??'not started'} ({s.desk.visual?.reason??'setup'}). Last contact extremum: {s.desk.lastCandidate?.captureTimeMs.toFixed(1)??'not measured'} ms; observed at {s.desk.lastCandidate?.observedAtMs.toFixed(1)??'not measured'} ms. These are camera motion candidates, not fused or verified taps.</p>}
    {s.selection.exercise==='desk_tap'&&<p>Desk accepted {s.selection.sensorMode==='fused'?'fused coincidences':'kinematic taps'}: <output aria-label="Accepted desk taps">{s.desk?.acceptedTapCount??0}</output>. {s.desk?.lastAccepted?'Lift/release before the next score.':''}</p>}<p>{s.trial?(s.phase==='countdown'?`Countdown: ${Math.ceil(s.trial.countdownSeconds)} s`:s.trial.settling?'Trial ended; settling bounded late matches (250 ms).':`Trial remaining: ${s.trial.remainingSeconds.toFixed(1)} s`):''}</p><p>Live P0 hardware acceptance remains pending, including palm calibration quality.</p></section>;
}
export function Viewport({ frameBuffer, snapshot: s, commands, instruction, placeRing=true }: ViewProps & { instruction?:string; placeRing?:boolean }) {
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
  return <section aria-labelledby="viewport"><h2 id="viewport">{s.source==='live'?'Live camera viewport':'Synthetic replay viewport'}</h2>{placeRing&&<p>Video and skeleton use the same mirrored contain-fit coordinates. {instruction??(s.selection.exercise==='desk_tap'?'Keep the fingertip, its lift/return, and the desk pads visible. Left and Right follow the mirrored video.':'Hold one open palm still and fully in view.')} Model handedness: {frameBuffer.current.current?.validity==='valid'?frameBuffer.current.current.selectedHand:'not observed'}.</p>}<canvas ref={canvas} width={640} height={360} onPointerDown={placeRing?e=>{const bounds=e.currentTarget.getBoundingClientRect();commands.placeDeskRing({x:e.clientX-bounds.left,y:e.clientY-bounds.top},{width:bounds.width,height:bounds.height});}:undefined} aria-label={s.source==='live'?(placeRing?'Mirrored live video and hand skeleton; click to place desk ring during setup':'Mirrored live video and hand skeleton for guided practice'):'Artificial fixture landmarks, not live camera data'} /></section>;
}
export function Diagnostics({ snapshot: s }: ViewProps) {
  const d=s.diagnostics, value=(n:number|null|undefined)=>n?.toFixed(1)??'not measured', rms=(n:number|null|undefined)=>n?.toFixed(4)??'not measured';
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
    <dt>Desk calibration / visual events</dt><dd>{s.desk?.setup?.measuredExcursionPixels.map(v=>v.toFixed(1)).join(', ')||'not measured'} source pixels per guided lift. {s.calibration?.exercise==='desk_tap'?`Direction (${s.calibration.desk.contactDirection.x.toFixed(3)}, ${s.calibration.desk.contactDirection.y.toFixed(3)}); excursion ${s.calibration.desk.excursionPalmUnits.toFixed(3)} palm; band [${s.calibration.desk.contactBand.minPalmUnits.toFixed(3)}, ${s.calibration.desk.contactBand.maxPalmUnits.toFixed(3)}]; wrist limit ${s.calibration.desk.wristTolerancePalmUnitsPerSecond.toFixed(3)} palm/s.`:''} q: {value(s.desk?.visual?.qPalmUnits)} palm; capture velocity: {value(s.desk?.visual?.velocityPalmUnitsPerSecond)} palm/s. </dd><dt>Audio clock / settings</dt><dd>{s.audio.sampleRate??'not measured'} Hz / {s.audio.blockFrames??'not measured'} samples per last block. {s.audio.settings}. Anchor: audio {s.audio.clock?.audioTimeSeconds.toFixed(6)??'not measured'} s ↔ performance {value(s.audio.clock?.sessionTimeMs)} ms; anchor quantum/bracketing estimate {value(s.audio.clock?.uncertaintyMs)} ms (input latency requires paired calibration).</dd><dt>Audio level / noise / threshold RMS</dt><dd>{rms(s.audio.level?.rms)} / {rms(s.audio.level?.noiseRms)} / {rms(s.audio.level?.thresholdRms)}; relative microphone amplitude, not force. Last impulse peak RMS: {rms(s.fusion.lastAudio?.rms)}.</dd><dt>Audio-minus-visual timing</dt><dd>{s.calibration?.sensorMode==='fused'?`${value(s.calibration.audio.offsetMs)} ms offset; ${value(s.calibration.audio.residualSpreadMs)} ms maximum residual`:'not measured'}. Onset convention; coincidence tolerance 80 ms, delivery budget 250 ms.</dd><dt>Visual / acoustic / fused diagnostic events</dt><dd>{s.fusion.visualCount} / {s.fusion.audioCount} / {s.fusion.fusedCount}. Discarded audio deliveries: {s.fusion.rejectedAudioCount} ({s.fusion.lastRejection??'none'}). Last acoustic onset: {value(s.fusion.lastAudio?.sampleTimeMs)} ms; last coincidence Δ: {value(s.fusion.lastFused?.deltaMs)} ms. {s.source==='synthetic_replay'?'Synthetic diagnostic fixture, independent of air target reps; no live evidence.':'Temporal coincidence cannot verify physical contact.'}</dd><dt>Bounded event trace (capture/sample ms)</dt><dd>{s.fusion.trace.map((event,i)=><span key={i}>{event.kind} {event.timeMs.toFixed(1)}; </span>)}</dd>
  </dl><p>Demo hardware targets: 60 render FPS, ≥24 inference FPS, p95 age ≤120 ms. CPU fallback is explicitly capped at 20 Hz and needs tuning/retest to meet the inference gate. A blank-bitmap pipeline probe does not verify tracking accuracy or live hardware acceptance.</p></details>;
}
export function AssetStatus({ snapshot: s }: ViewProps) { return <p role="status">Assets: {s.diagnostics.assets}. {s.diagnostics.assetMessage}</p>; }
export function Results({ snapshot: s }: ViewProps) {
  const result=s.result;
  function download(){
    if(!result)return;
    const url=URL.createObjectURL(new Blob([telemetryJson(result)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`itap-${result.source}-${result.sensorMode}-${result.sessionId}.json`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  return <section aria-labelledby="results"><h2 id="results">Results</h2>
    <p>{result?localSummary(result):s.trial?.settling?'Waiting for bounded late events.':'No result yet. Complete a trial; a started trial that is interrupted is labeled aborted.'}</p>
    {result&&<><p>Result identity: {result.source} / {result.sensorMode} / {result.status}. Estimated measurements; no clinical conclusion.</p>
      <table aria-label="Validated session metrics"><tbody>{Object.entries({...result.metrics,...result.quality}).map(([key,value])=><tr key={key}><th scope="row">{key}</th><td>{value===null?'not measured':typeof value==='number'?Number.isInteger(value)?value:value.toFixed(4):JSON.stringify(value)}</td></tr>)}</tbody></table>
      <p>Export contains only this validated summary. No baseline collected. Nothing is stored or submitted.</p></>}
    <button disabled={!result} onClick={download}>Export validated JSON</button></section>;
}
