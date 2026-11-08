import { describe, expect, it } from 'vitest';
import { createPalmCalibrator } from '../calibration';
import { handFrame, rotateWorld } from './helpers';
const video={width:1000,height:1000};
function calibrate() { const c=createPalmCalibrator(video); for(let i=0;i<=60;i++) c.observe(handFrame(i*50,i),i*50); return c; }
describe('robust three-second palm calibration', () => {
  it('requires elapsed time and sample count and keeps world and pixel medians separate', () => {
    const c=calibrate(); expect(c.getState()).toMatchObject({status:'valid',calibration:{palmWorld:.08,hand:'Right'}});
    expect(c.getState().calibration?.palmPixels).toBeCloseTo(80);
    const sparse=createPalmCalibrator(video);
    for(let i=0;i<=30;i++) sparse.observe(handFrame(i*100,i),i*100);
    expect(sparse.getState()).toMatchObject({status:'collecting',reason:'insufficient_samples'});
    // The accepted calibration is frozen even if further observations differ.
    expect(c.observe(handFrame(3050,61,'Left'),3050).calibration?.hand).toBe('Right');
  });
  it.each([25,30,30.1,45])('handles an estimated %s degree open-palm bend at the 30 degree gate',degrees=>{
    const c=createPalmCalibrator(video),radians=degrees*Math.PI/180;
    for(let i=0;i<=60;i++){
      const f=handFrame(i*50,i),pip=f.worldLandmarks[6]!;
      const bent={...f,worldLandmarks:f.worldLandmarks.map((p,index)=>index===7||index===8?{...p,x:pip.x+(index-6)*.025*Math.sin(radians),y:pip.y+(index-6)*.025*Math.cos(radians)}:p)};
      c.observe(bent,i*50);
    }
    if(degrees<=30)expect(c.getState().status).toBe('valid');
    else expect(c.getState()).toMatchObject({status:'collecting',reason:'closed_pose',calibration:null});
  });
  it('accepts stable desk geometry with a 41 degree DIP estimate while preserving the air posture gate',()=>{
    const desk=createPalmCalibrator(video,{},'desk_geometry'),air=createPalmCalibrator(video);
    for(let i=0;i<=60;i++){
      const f=handFrame(i*50,i),dip=f.worldLandmarks[7]!,angle=41*Math.PI/180;
      const sample={...f,worldLandmarks:f.worldLandmarks.map((p,index)=>index===8?{...p,x:dip.x+.025*Math.sin(angle),y:dip.y+.025*Math.cos(angle)}:p)};
      desk.observe(sample,i*50);air.observe(sample,i*50);
    }
    expect(desk.getState().status).toBe('valid');
    expect(air.getState()).toMatchObject({reason:'closed_pose',calibration:null});
    expect(air.getState().detail).toContain('DIP estimate 41.0°');
  });
  it.each(['loss','small','unstable','stale'] as const)('still rejects %s input during desk geometry calibration',kind=>{
    const c=createPalmCalibrator(video,{},'desk_geometry');for(let i=0;i<30;i++)c.observe(handFrame(i*50,i),i*50);
    const f=handFrame(1500,30);
    if(kind==='loss')c.observe({sequence:30,captureTimeMs:1500,selectedHand:'Right',validity:'absent',reason:'no_hand'},1500);
    if(kind==='small')c.observe({...f,imageLandmarks:f.imageLandmarks.map(p=>({...p,y:.8-(.8-p.y)*.1}))},1500);
    if(kind==='unstable')c.observe({...f,imageLandmarks:f.imageLandmarks.map(p=>({...p,x:p.x+.1}))},1500);
    if(kind==='stale')c.observe(f,1800);
    expect(c.getState().calibration).toBeNull();expect(c.getState().sampleCount).toBeLessThanOrEqual(1);
  });
  it('uses medians rather than a single scale observation', () => {
    const c=createPalmCalibrator(video);
    for(let i=0;i<=60;i++) {
      const f=handFrame(i*50,i), scale=i%3===0?1.05:1;
      c.observe({...f,worldLandmarks:f.worldLandmarks.map(p=>({...p,x:p.x*scale,y:p.y*scale}))},i*50);
    }
    expect(c.getState().calibration?.palmWorld).toBeCloseTo(.08);
  });
  it('restarts for absence, stale data, hand switch, small palm, occlusion, pose and scale variation', () => {
    for(const kind of ['absence','stale','switch','small','occlusion','bent','roll','scale'] as const) {
      const c=createPalmCalibrator(video);
      for(let i=0;i<30;i++) c.observe(handFrame(i*50,i),i*50);
      const f=handFrame(1500,30);
      if(kind==='absence') c.observe({sequence:30,captureTimeMs:1500,selectedHand:'Right',validity:'absent',reason:'no_hand'},1500);
      if(kind==='stale') c.observe(f,1800);
      if(kind==='switch') c.observe(handFrame(1500,30,'Left'),1500);
      if(kind==='small') c.observe({...f,imageLandmarks:f.imageLandmarks.map(p=>({...p,y:.8-(.8-p.y)*.1}))},1500);
      if(kind==='occlusion') c.observe({...f,handedness:{label:'Right',confidence:.1}},1500);
      if(kind==='bent') c.observe({...f,worldLandmarks:f.worldLandmarks.map((p,i)=>i===7?{...p,x:.03,y:.085}:p)},1500);
      if(kind==='roll') c.observe({...f,worldLandmarks:rotateWorld(f.worldLandmarks,20,'y')},1500);
      if(kind==='scale') c.observe({...f,imageLandmarks:f.imageLandmarks.map(p=>({...p,y:.8-(.8-p.y)*2}))},1500);
      if(kind==='bent')expect(c.getState().detail).toMatch(/Index PIP estimate .*30° open-palm gate/);
      expect(c.getState().status,kind).not.toBe('valid');
      expect(c.getState().sampleCount,kind).toBeLessThanOrEqual(1);
    }
  });

  it('supports either selected hand with its own reflected image basis',()=>{
    const c=createPalmCalibrator(video);
    for(let i=0;i<=60;i++){
      const f=handFrame(i*50,i,'Left');
      c.observe({...f,imageLandmarks:f.imageLandmarks.map(p=>({...p,x:1-p.x}))},i*50);
    }
    expect(c.getState().calibration?.hand).toBe('Left');
    expect(c.getState().calibration?.imageBasis.transverse.x).toBeCloseTo(-1);
  });
  it('rejects malformed math, non-monotonic observation clocks, and bad configuration', () => {
    const c=createPalmCalibrator(video);
    expect(()=>c.observe({...handFrame(),worldLandmarks:[]},0)).toThrow(/21/);
    c.observe(handFrame(),0);
    expect(()=>c.observe(handFrame(1,1),-1)).toThrow(/time/i);
    expect(()=>createPalmCalibrator(video,{minSamples:0})).toThrow(/minSamples/);
  });
});
