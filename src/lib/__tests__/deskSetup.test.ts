import { describe,it,expect } from 'vitest';
import { deskSetupSteps,deskSetupMessage } from '../deskSetup';
import { initialSnapshot } from '../../engine/contracts';
import type { DeskSnapshot,SessionSnapshot } from '../../engine/contracts';
import { sourcePixel } from '../coordinates';
const base=():SessionSnapshot=>({...initialSnapshot('live'),selection:{exercise:'desk_tap',sensorMode:'fused'},deskLayout:'left_right'});
const desk=():DeskSnapshot=>({placing:false,region:{center:sourcePixel(500,300),radiusPixels:30},setup:{stage:'ready_cycle',reason:'Test observations',samples:10,cycles:3,calibration:null,measuredExcursionPixels:[30,30,30]},acceptedTapCount:0,lastAccepted:null,visual:null,visualCandidateCount:0,lastCandidate:null});
const step=(s:SessionSnapshot,id:string)=>deskSetupSteps(s).find(t=>t.id===id)!;
describe('desk setup cards reflect controller evidence',()=>{
  it('gives a retry instruction for a rejected short recording',()=>{expect(deskSetupMessage('insufficient_cycle_samples')).toContain('hold still, then save again');});
  it('requires camera and microphone readiness independently',()=>{
    const s=base();expect(step(s,'camera').complete).toBe(false);expect(step(s,'microphone').complete).toBe(false);
    const ready={...s,phase:'ready' as const};expect(step(ready,'camera').complete).toBe(true);expect(step(ready,'microphone').complete).toBe(false);
    expect(step({...ready,audio:{...ready.audio,state:'ready'}},'microphone').complete).toBe(true);
  });
  it('does not treat three saved cycles or timing pairs as finished calibration',()=>{
    const s={...base(),phase:'calibrating' as const,desk:desk()};
    expect(step(s,'left-placement').complete).toBe(true);expect(step(s,'left-rest').complete).toBe(true);expect(step(s,'left-cycles').complete).toBe(false);
    expect(step({...s,fusion:{...s.fusion,timingPairs:3,timingRequired:true}},'timing').complete).toBe(false);
    expect(step(s,'ready').complete).toBe(false);
  });
  it('preserves Left completion while requiring independent Right observations',()=>{
    const d={...desk(),placing:true,region:null,setup:null,pads:[{id:'left' as const,region:desk().region!}]};
    const s={...base(),phase:'calibrating' as const,desk:d};
    for(const id of ['left-placement','left-rest','left-cycles'])expect(step(s,id).complete).toBe(true);
    for(const id of ['right-placement','right-rest','right-cycles'])expect(step(s,id).complete).toBe(false);
  });
  it('revokes palm and pad completion when the controller invalidates setup',()=>{
    const s={...base(),phase:'ready' as const,desk:null};
    for(const id of ['palm','left-placement','left-rest','left-cycles','right-placement','timing','ready'])expect(step(s,id).complete).toBe(false);
  });
  it('omits unavailable device tasks for replay and kinematic-only use',()=>{
    const s={...base(),source:'synthetic_replay' as const,deskLayout:'single' as const,selection:{exercise:'desk_tap' as const,sensorMode:'kinematic_only' as const}};
    const steps=deskSetupSteps(s);expect(steps.some(t=>t.kind==='microphone'||t.kind==='timing')).toBe(false);
    expect(steps.filter(t=>t.kind==='placement').map(t=>t.id)).toEqual(['desk-placement']);
  });
});
