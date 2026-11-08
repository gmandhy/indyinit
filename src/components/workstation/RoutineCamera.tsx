import { Viewport } from '../stubs/Panels';
import type { ViewProps } from '../stubs/Panels';

/** Guided practice shares the session's device owner and mirrored renderer. */
export function RoutineCamera(props: ViewProps) {
  const { snapshot: s, commands } = props;
  const canStart = s.phase === 'idle' || s.phase === 'error';
  return <div className="camera-panel">
    <div className="camera-toolbar"><span className="source-badge">Live camera</span><div>
      <button disabled={!canStart} onClick={() => void commands.startDevices()}>{s.phase === 'requesting' ? 'Starting camera…' : 'Start camera'}</button>
      <button disabled={s.phase === 'idle'} onClick={commands.stop}>Stop camera</button>
    </div></div>
    <Viewport {...props} placeRing={false}/>
    {s.phase === 'idle' && <div className="camera-placeholder"><span aria-hidden="true">✋</span><h3>Start your camera</h3></div>}
    {s.phase==='error'&&<p className="routine-camera-status" role="status">{s.message}</p>}
  </div>;
}
