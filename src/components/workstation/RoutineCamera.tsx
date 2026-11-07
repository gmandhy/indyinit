import { Viewport } from '../stubs/Panels';
import type { ViewProps } from '../stubs/Panels';

/** Preview shares the session's device owner; routine repetitions remain manual. */
export function RoutineCamera(props: ViewProps) {
  const { snapshot: s, commands } = props;
  const canStart = s.phase === 'idle' || s.phase === 'error';
  return <div className="camera-panel">
    <div className="camera-toolbar"><span className="source-badge">Live camera · manual practice</span><div>
      <button disabled={!canStart} onClick={() => void commands.startDevices()}>{s.phase === 'requesting' ? 'Starting camera…' : 'Start camera'}</button>
      <button disabled={s.phase === 'idle'} onClick={commands.stop}>Stop camera</button>
    </div></div>
    <Viewport {...props}/>
    {s.phase === 'idle' && <div className="camera-placeholder"><span aria-hidden="true">✋</span><h3>Your movement, in view</h3><p>Start the camera to see your hand while you practice.</p></div>}
    <p className="routine-camera-status" role="status">{s.message}</p>
    <p className="routine-camera-status">Camera preview only. Record repetitions yourself; wrist movement is not measured.</p>
  </div>;
}
