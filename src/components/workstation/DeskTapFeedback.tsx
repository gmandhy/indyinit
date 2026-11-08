import type { ViewProps } from '../stubs/Panels';
import './deskTapFeedback.css';

/** Relative microphone level, in decibels below full scale; never a force estimate. */
function levelDb(rms: number) { return Math.max(-60, 20 * Math.log10(Math.max(rms, .001))); }
export function DeskTapFeedback({ snapshot: s, commands }: ViewProps) {
  if (s.selection.exercise !== 'desk_tap') return <section className="desk-feedback card" aria-label="Desk tap setup">
    <h2>Tap the table</h2><p>{s.source==='live'?'Use two desk pads. The microphone detects the tap sound; the camera identifies Left or Right in the mirrored video.':'Synthetic replay uses one fixed ring. Choose Live camera for left/right pad setup.'}</p>
    <button onClick={() => commands.setDeskLayout(s.source==='live'?'left_right':'single')}>Set up desk taps</button>
  </section>;
  const fused = s.selection.sensorMode === 'fused', replay = s.source === 'synthetic_replay';
  const twoPads=s.deskLayout==='left_right';
  const level = s.audio.level, position = s.desk?.lastAccepted?.position;
  return <section className="desk-feedback card" aria-labelledby="desk-feedback-title">
    <div className="section-heading"><h2 id="desk-feedback-title">Table tap recognition</h2><span>{replay ? 'Synthetic replay' : fused ? 'Camera + microphone' : 'Camera only'}</span></div>
    <label>Desk layout <select aria-label="Desk layout" value={s.deskLayout} onChange={e=>commands.setDeskLayout(e.target.value as 'single'|'left_right')}><option value="single">Single ring</option><option value="left_right" disabled={replay}>Left / right pads{replay?' (live camera)':''}</option></select></label>
    <small>Changing layout clears calibration and stops the microphone. Restart it on the microphone task card.</small>
    <p>Follow the task card beside the camera. Confirm each completed task to continue. Accepted tap counts update after setup, during the running trial.</p>
    {twoPads&&<p>Calibrated pads: {s.desk?.pads?.length??0}/2.</p>}
    {!replay && fused && <div className="desk-microphone">
      <strong>Microphone: {s.audio.state.replaceAll('_', ' ')}</strong><p>{s.audio.message}</p>
      <label>Microphone level <meter aria-label="Microphone level" min={-60} max={0} value={level ? levelDb(level.rms) : -60}/></label>
      <small>{level ? `${levelDb(level.rms).toFixed(0)} dBFS · detection threshold ${levelDb(level.thresholdRms).toFixed(0)} dBFS (decibels below full scale)` : 'No level measured yet.'} Relative microphone amplitude, not force.</small>
    </div>}
    <dl className="desk-event-counts">
      <div><dt>Sounds detected</dt><dd><output aria-label="Detected tap sounds">{s.fusion.audioCount}</output></dd></div>
      <div><dt>Camera candidates</dt><dd><output aria-label="Camera tap candidates">{s.fusion.visualCount}</output></dd></div>
      <div><dt>{fused ? 'Accepted matched taps' : 'Accepted camera taps'}</dt><dd><output aria-label="Recognized table taps">{s.desk?.acceptedTapCount ?? 0}</output></dd></div>
    </dl>
    {twoPads&&<div className="desk-event-counts"><p>Left: <output aria-label="Left pad taps">{s.desk?.leftTapCount??0}</output></p><p>Right: <output aria-label="Right pad taps">{s.desk?.rightTapCount??0}</output></p><p>Last detected side: <output aria-label="Last tap side">{s.desk?.lastAccepted?.pad??'Not measured yet'}</output></p></div>}
    {twoPads&&s.desk?.visual&&<p role="status">{s.desk.visual.reason}</p>}
    <p><strong>Last accepted tap location: </strong><output aria-label="Last tap location">{position ? `x ${position.x.toFixed(0)}, y ${position.y.toFixed(0)} camera pixels` : 'Not measured yet'}</output>. The marker on the video uses the same mirrored coordinates as your hand.</p>
    {s.trial && <p>{s.phase === 'countdown' ? 'Wait for the countdown.' : s.phase === 'running' ? `${Math.ceil(s.trial.remainingSeconds)} seconds remaining. Lift and release between taps.` : 'Trial finished.'}</p>}
    {s.audio.state === 'unavailable' && fused && !replay && <p>Retry the microphone on its task card, or choose Desk / kinematic-only explicitly to practice with camera motion.</p>}
  </section>;
}
