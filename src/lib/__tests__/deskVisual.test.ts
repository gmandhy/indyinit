import { describe, expect, it } from 'vitest';
import { createDeskCalibrator, createDeskVisualDetector } from '../deskVisual';
import type { DeskCalibration } from '../deskVisual';
import { createPalmCalibrator } from '../calibration';
import { handFrame } from './helpers';
import { containFit, displayToSource, sourcePixel, sourceToDisplay } from '../coordinates';
import { createAirTargetEngine, reachableAirPath, targetCircle } from '../spatialTargets';
function setup(direction={x:0,y:-1}) {
  const video={width:1000,height:1000},p=createPalmCalibrator(video);
  for(let i=0;i<=60;i++)p.observe(handFrame(i*50,i),i*50);
  const palm=p.getState().calibration!;let time=4000,seq=100;
  const rest=sourcePixel(500,665),ring={center:rest,radiusPixels:28};
  function frame(lift=0,opts:{wrist?:number;outside?:boolean;confidence?:number}={}) {
    time+=50;const f=handFrame(time,seq++);
    return {...f,handedness:{...f.handedness,confidence:opts.confidence??1},imageLandmarks:f.imageLandmarks.map((p,i)=>i===8?{...p,x:(rest.x+lift*direction.x+(opts.outside?50:0))/1000,y:(rest.y+lift*direction.y)/1000}:i===0?{...p,x:p.x+(opts.wrist??0)/1000}:p)};
  }
  const wizard=createDeskCalibrator(palm,ring);
  function feed(lift=0,opts:Parameters<typeof frame>[1]={}){const f=frame(lift,opts);return wizard.observe(f,time);}
  function restCapture(){wizard.captureRest();for(let i=0;i<=10;i++)feed();}
  function cycle(amplitude=30){wizard.beginCycle();for(const lift of [0,0,0,amplitude/2,amplitude,amplitude,amplitude/2,0,0,0])feed(lift);return wizard.finishCycle();}
  function calibrate(){restCapture();for(let i=0;i<3;i++)cycle();return wizard.finish().calibration!;}
  return {video,palm,ring,wizard,frame,feed,cycle,restCapture,calibrate,now:()=>time,advance:(ms:number)=>{time+=ms;}};
}
describe('guided visual calibration before live wiring',()=>{
  it('learns horizontal/oblique lift-to-contact direction, band, excursion and wrist tolerance from 3–5 cycles',()=>{
    for(const direction of [{x:0,y:-1},{x:1,y:0},{x:.6,y:-.8}]){
      const s=setup(direction),c=s.calibrate();expect(c).toBeTruthy();expect(c.sensorMode).toBe('kinematic_only');
      expect(c.desk.contactDirection.x).toBeCloseTo(-direction.x);expect(c.desk.contactDirection.y).toBeCloseTo(-direction.y);
      expect(c.desk.excursionPalmUnits).toBeCloseTo(30/80);expect(c.desk.contactBand.minPalmUnits).toBeCloseTo(-.025);expect(c.desk.contactBand.maxPalmUnits).toBeCloseTo(.025);
      expect(c.desk.wristTolerancePalmUnitsPerSecond).toBe(.25);expect(s.wizard.getState().measuredExcursionPixels).toHaveLength(3);
    }
    const s=setup();s.restCapture();s.cycle();s.wizard.finish();expect(s.wizard.getState().calibration).toBeNull();
    for(let i=0;i<4;i++)s.cycle();expect(s.wizard.getState().cycles).toBe(5);s.wizard.beginCycle();expect(s.wizard.getState().stage).toBe('ready_cycle');expect(s.wizard.finish().calibration).toBeTruthy();
  });
  it('rejects tiny projection, missing return, unstable rest, occlusion, gaps, camera/hand/scale changes and nonfinite math',()=>{
    const s=setup();s.restCapture();expect(s.cycle(2).reason).toMatch(/insufficient_projected/);expect(s.wizard.getState().cycles).toBe(0);
    s.wizard.beginCycle();for(const l of [0,0,0,30,30,30,30,30,30,30])s.feed(l);expect(s.wizard.finishCycle().reason).toMatch(/Return/);
    const unstable=setup();unstable.wizard.captureRest();unstable.feed();expect(unstable.feed(20).reason).toBe('unstable_rest');
    for(const kind of ['occlusion','gap','geometry','hand','scale','absence','stale'] as const){
      const t=setup();t.restCapture();t.cycle();let f=t.frame();
      if(kind==='occlusion')f={...f,handedness:{...f.handedness,confidence:.1}};
      if(kind==='hand')f={...f,selectedHand:'Left',handedness:{label:'Left',confidence:1}};
      if(kind==='scale')f={...f,imageLandmarks:f.imageLandmarks.map(p=>({...p,y:.8-(.8-p.y)*2}))};
      if(kind==='gap') {t.advance(200);f=t.frame();}
      const result=t.wizard.observe(kind==='absence'?{sequence:f.sequence,captureTimeMs:f.captureTimeMs,selectedHand:'Right',validity:'absent',reason:'no_hand'}:f,t.now()+(kind==='stale'?121:0),kind==='geometry'?{width:800,height:600}:t.video);
      expect(result,kind).toMatchObject({stage:'invalid',calibration:null,cycles:0});
    }
    const t=setup(),f=t.frame();expect(()=>t.wizard.observe({...f,captureTimeMs:NaN},t.now())).toThrow(/Malformed/);
  });
  it('rejects inconsistent direction and wrist translation rather than learning it as a finger lift',()=>{
    const s=setup();s.restCapture();s.cycle();s.cycle();s.cycle(-30);expect(s.wizard.finish().reason).toMatch(/inconsistent/);
    const t=setup();t.restCapture();t.wizard.beginCycle();t.feed(0);expect(t.feed(30,{wrist:10}).reason).toBe('wrist_motion');
  });
  it('enforces the projected amplitude floor, bounded recordings and measured contact-band spread',()=>{
    const s=setup();s.restCapture();expect(s.cycle(9.5).reason).toMatch(/insufficient_projected/);expect(s.cycle(10).cycles).toBe(1);
    s.wizard.beginCycle();for(let i=0;i<102;i++)s.feed();expect(s.wizard.getState()).toMatchObject({stage:'ready_cycle',cycles:1,reason:expect.stringContaining('too long')});
    const t=setup();t.restCapture();for(let i=0;i<3;i++){
      t.wizard.beginCycle();for(const lift of [0,0,0,15,30,30,15,-6,-6,-6])t.feed(lift);t.wizard.finishCycle();
    }
    expect(t.wizard.finish()).toMatchObject({stage:'invalid',reason:'contact_band_too_wide',calibration:null,cycles:0});
  });
});
describe('capture-time visual contact cycles',()=>{
  function detector(){const s=setup(),c=s.calibrate(),d=createDeskVisualDetector(c);return {...s,c,d,observe:(lift=0,opts:Parameters<typeof s.frame>[1]={},age=0)=>{const f=s.frame(lift,opts);return d.observe(f,s.now()+age);}};}
  it('emits once at the observed extremum after lookahead; holding, repeated delivery and rendering cannot score',()=>{
    const s=detector();expect(s.observe().phase).toBe('released');expect(s.observe(30).phase).toBe('lifted');expect(s.observe(15).phase).toBe('descending');
    expect(s.observe().phase).toBe('contactCandidate');const contactTime=s.now();const a=s.observe();
    expect(a).toMatchObject({phase:'released',candidates:1,candidate:{captureTimeMs:contactTime,observedAtMs:s.now()}});
    for(let i=0;i<10;i++)expect(s.observe().candidates).toBe(1);
    s.observe(30);s.observe(15);s.observe();expect(s.observe().candidates).toBe(2);
    const f=s.frame();s.d.observe(f,s.now());expect(s.d.observe(f,s.now())).toMatchObject({candidates:2,calibrationValid:false,reason:'stale'});
  });
  it('uses capture time despite delayed arrival and discards lookahead on cancellation/loss',()=>{
    const s=detector();s.observe(30,{},20);s.observe(15,{},10);s.observe(0,{},30);const contact=s.now();
    expect(s.observe(0,{},40).candidate?.captureTimeMs).toBe(contact);
    for(const kind of ['reset','loss','gap','wrist','outside','band'] as const){
      const t=detector();t.observe(30);t.observe(15);t.observe();
      if(kind==='reset')t.d.reset('cancelled');
      if(kind==='loss')t.d.observe({sequence:999,captureTimeMs:t.now()+1,selectedHand:'Right',validity:'absent',reason:'no_hand'},t.now()+1);
      if(kind==='gap')t.advance(150);
      if(kind==='wrist')t.observe(0,{wrist:5});
      if(kind==='outside')t.observe(0,{outside:true});
      if(kind==='band')t.observe(-8);
      expect(t.observe().candidates,kind).toBe(0);
    }
  });
  it('requires excursion, descending motion, ring overlap and contact-band hysteresis',()=>{
    const s=detector();for(const lift of [0,4,6,4,0,0,0])s.observe(lift);expect(s.d.getState().candidates).toBe(0);
    s.observe(30);s.observe(15);s.observe(0,{outside:true});s.observe();expect(s.d.getState().candidates).toBe(0);
    s.observe(30);s.observe(15);s.observe();expect(s.observe(3).phase).toBe('contactCandidate'); // outside entry band, within exit margin
    expect(s.observe(6).reason).toBe('contact_left_band_or_ring');expect(s.observe().candidates).toBe(0);
  });
  it('invalidates frozen geometry/hand/scale and rejects bad time or overlapping bands',()=>{
    const s=detector(),f=s.frame();expect(s.d.observe(f,s.now(),{width:800,height:600}).reason).toBe('video_changed');
    expect(()=>s.d.observe(f,s.now()-1)).toThrow(/monotonic/);
    const c={...s.c,desk:{...s.c.desk,contactBand:{minPalmUnits:-.35,maxPalmUnits:.01}}} as DeskCalibration;
    expect(()=>createDeskVisualDetector(c)).toThrow(/overlap/);
  });
  it('detects fixed-camera hand-basis changes and invalidates pending lookahead without a contact event',()=>{
    const s=detector();s.observe(30);s.observe(15);s.observe();const f=s.frame(),w=f.imageLandmarks[0]!,r=40*Math.PI/180;
    const rotated={...f,imageLandmarks:f.imageLandmarks.map(p=>({...p,x:w.x+(p.x-w.x)*Math.cos(r)-(p.y-w.y)*Math.sin(r),y:w.y+(p.x-w.x)*Math.sin(r)+(p.y-w.y)*Math.cos(r)}))};
    expect(s.d.observe(rotated,s.now())).toMatchObject({calibrationValid:false,candidate:null,reason:'hand_geometry_changed'});
    const t=detector(),future=t.frame();expect(()=>t.d.observe({...future,captureTimeMs:t.now()+1},t.now())).toThrow(/future/);
  });
});
describe('target/visual coordinate integration',()=>{
  it('places the ring through mirrored letterboxing, preserves source placement on viewport resize, and refuses letterbox clicks',()=>{
    const s=setup(),fit=containFit(s.video,{width:1000,height:600}),display=sourceToDisplay(s.ring.center,fit);
    expect(displayToSource(display,fit)).toEqual(s.ring.center);expect(displayToSource({x:0,y:0},fit)).toBeNull();
    const resized=containFit(s.video,{width:500,height:800});expect(displayToSource(sourceToDisplay(s.ring.center,resized),resized)).toEqual(s.ring.center);
  });
  it('builds a small frozen-basis reachable sequence and scores each target once with release',()=>{
    const s=setup(),path=reachableAirPath(s.palm,handFrame(s.now(),90)),engine=createAirTargetEngine(s.palm,path,s.now);
    expect(path.length).toBe(3);
    for(const target of path){
      const circle=targetCircle(target,s.palm,handFrame().imageLandmarks[0]!);
      for(let i=0;i<12;i++){const f=s.frame();engine.observe({...f,imageLandmarks:f.imageLandmarks.map((p,j)=>j===8?{...p,x:circle.center.x/1000,y:circle.center.y/1000}:p)});}
      const f=s.frame();engine.observe({...f,imageLandmarks:f.imageLandmarks.map((p,j)=>j===8?{...p,x:.1,y:.1}:p)});
    }
    expect(engine.getState()).toMatchObject({completedReps:3,attempts:3,requiresRelease:false});
  });
});
