import { useState } from 'react';
import { useSessionController } from '../hooks/useSessionController';
import { CompactStub, WorkstationStub } from '../components/stubs/Compositions';
import { AssetStatus } from '../components/stubs/Panels';
export function App() {
  const [source,setSource] = useState<'live'|'synthetic_replay'>('live');
  const session = useSessionController(source);
  const [compact,setCompact] = useState(false);
  return <main><h1>ITap — phase 3 CV harness</h1><label>Source <select value={source} onChange={e=>setSource(e.target.value as typeof source)}><option value="live">Live camera</option><option value="synthetic_replay">Synthetic replay</option></select></label><p><strong>{source==='live'?'Live camera — video only; no microphone':'Synthetic replay — no live camera or microphone evidence'}</strong></p><p>Rehabilitation-inspired hackathon prototype. Not a validated clinical device.</p><AssetStatus {...session}/><label><input type="checkbox" checked={compact} onChange={e => setCompact(e.target.checked)}/> Compact stub composition</label>{compact ? <CompactStub {...session}/> : <WorkstationStub {...session}/>}</main>;
}
