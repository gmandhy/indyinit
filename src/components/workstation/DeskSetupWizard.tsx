import { useEffect, useRef, useState } from 'react';
import type { ViewProps } from '../stubs/Panels';
import { deskSetupSteps, deskSetupMessage } from '../../lib/deskSetup';
import { AUDIO_CONFIG } from '../../lib/config';
import './deskTapFeedback.css';

export function DeskSetupWizard({snapshot:s,commands:c}:ViewProps) {
  const steps=deskSetupSteps(s),firstIncomplete=steps.findIndex(step=>!step.complete);
  const [acknowledged,setAcknowledged]=useState(0);
  const limit=firstIncomplete<0?steps.length-1:firstIncomplete;
  const index=Math.min(acknowledged,limit,steps.length-1),step=steps[index]!;
  const title=useRef<HTMLHeadingElement>(null);
  // Invalidated evidence revokes later acknowledgements; Continue cannot restore it.
  useEffect(()=>{if(acknowledged>limit)setAcknowledged(limit);},[acknowledged,limit]);
  useEffect(()=>{title.current?.focus();},[step.id]);
  const stage=s.desk?.setup?.stage,cycles=s.desk?.setup?.cycles??0;
  const replay=s.source==='synthetic_replay';
  return <section className="task-panel card desk-wizard" aria-labelledby="desk-step-title">
    <div className="section-heading"><span className="eyebrow">Desk setup</span><span>Task {index+1} of {steps.length}</span></div>
    <progress aria-label="Desk setup progress" max={steps.length} value={index+(step.complete?1:0)}/>
    <h2 id="desk-step-title" ref={title} tabIndex={-1}>{step.title}</h2>
    <p>{step.instruction}</p>
    {step.complete&&<div className="desk-step-success" role="status"><strong>✓ {step.kind==='ready'?'Setup confirmed':'Task complete'}</strong><p>{step.kind==='ready'?'Calibration checks passed. You can begin the trial.':'The app accepted this step. Confirm to continue.'}</p></div>}
    {!step.complete&&<div className="desk-step-actions">
      {step.kind==='camera'&&<button className="primary" disabled={s.phase==='requesting'} onClick={()=>void c.startDevices()}>{s.phase==='requesting'?'Starting…':replay?'Start replay adapter':'Start camera'}</button>}
      {step.kind==='microphone'&&<><p role="status">Microphone: {s.audio.state}. {deskSetupMessage(s.audio.message)}</p>{s.audio.state==='calibrating'&&<progress aria-label="Quiet microphone calibration" max={AUDIO_CONFIG.quietMs} value={Math.min(AUDIO_CONFIG.quietMs,s.audio.level?.elapsedMs??0)}/>}<button className="primary" disabled={['requesting','calibrating'].includes(s.audio.state)} onClick={()=>void c.startMicrophone()}>Start / retry microphone (keep quiet)</button></>}
      {step.kind==='palm'&&<button className="primary" disabled={!['ready','calibrated','complete'].includes(s.phase)} onClick={c.calibrate}>{replay?'Calibrate synthetic palm':'Calibrate palm / begin setup'}</button>}
      {step.kind==='placement'&&<div className="desk-placement-hint">{s.deskLayout==='left_right'?(step.id.startsWith('left')?'← Click the left tapping position in the video.':'Click the right tapping position in the video. →'):'Click your resting fingertip in the video.'}</div>}
      {step.kind==='rest'&&<><button className="primary" disabled={stage!=='awaiting_rest'} onClick={c.captureDeskRest}>Capture resting fingertip</button>{stage==='resting'&&<p role="status">Hold still… collecting resting observations.</p>}</>}
      {step.kind==='cycles'&&<><p role="status">{cycles} of 3 required cycles saved{cycles>0?' ✓':''}. Up to 5 may be recorded.</p><progress aria-label="Saved visual cycles" max={3} value={Math.min(cycles,3)}/><button disabled={stage!=='ready_cycle'||cycles>=5} onClick={c.beginDeskCycle}>Record one lift / return</button><button disabled={stage!=='recording'} onClick={c.saveDeskCycle}>Save this cycle</button><button className="primary" disabled={stage!=='ready_cycle'||cycles<3} onClick={c.finishDeskCalibration}>Finish visual calibration</button></>}
      {step.kind==='timing'&&<><p role="status">{s.fusion.timingPairs} of 3 required timing pairs saved{s.fusion.timingPairs>0?' ✓':''}.</p><progress aria-label="Saved timing pairs" max={3} value={Math.min(s.fusion.timingPairs,3)}/><button disabled={s.fusion.timingRecording||s.fusion.timingPairs>=5||!replay&&s.audio.state!=='ready'} onClick={c.beginTimingPair}>Record timing tap</button><button disabled={!s.fusion.timingRecording} onClick={c.saveTimingPair}>Save timing pair</button><button className="primary" disabled={s.fusion.timingRecording||s.fusion.timingPairs<3} onClick={c.finishTimingCalibration}>Finish timing calibration</button></>}
      {replay&&(stage==='recording'&&step.kind==='cycles'||s.fusion.timingRecording&&step.kind==='timing')&&<button onClick={c.replayTap}>Replay one lift / tap</button>}
      {step.kind!=='microphone'&&<p className="desk-step-message" role="status">{deskSetupMessage(step.kind==='camera'||s.calibrationStatus==='not_started'&&s.phase==='ready'?s.message:s.calibrationMessage)}</p>}
    </div>}
    <div className="desk-step-navigation">
      {step.kind==='ready'?<button className="primary" disabled={!step.complete} onClick={c.startExercise}>{replay?'Start synthetic trial':s.selection.sensorMode==='fused'?'Start fused trial':'Start kinematic trial'}</button>:<button className="primary" disabled={!step.complete} onClick={()=>setAcknowledged(index+1)}>Confirm and continue</button>}
      <button onClick={c.reset}>Restart setup</button><button onClick={c.stop}>Stop devices</button>
    </div>
    <small>{replay?'Synthetic replay — no live camera or microphone evidence.':'Camera and audio stay on this device.'}</small>
  </section>;
}
