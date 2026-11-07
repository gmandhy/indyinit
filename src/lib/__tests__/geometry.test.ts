import { describe, expect, it } from 'vitest';
import { containFit, imageToPixels, sourceToDisplay, displayToSource, canvasBackingSize } from '../coordinates';
import { flexionDeg, indexFlexionEstimates, palmBasis, orientationDeviationDeg, nextOrientationLock, smoothDisplay, thumbReachRatio } from '../biomechanics';
import { WorldLandmarkSchema, ImageLandmarkSchema } from '../schemas';
import { handFrame, rotateWorld } from './helpers';
const w = (x: number, y: number, z = 0) => WorldLandmarkSchema.parse({x,y,z});
describe('source/display spaces', () => {
  it('uses video pixels on nonsquare images and mirrors exactly once through contain fit', () => {
    const fit = containFit({width:1280,height:720},{width:600,height:600},true);
    const p = imageToPixels(ImageLandmarkSchema.parse({x:.25,y:.75,z:123}),fit.video);
    expect(p).toEqual({x:320,y:540});
    expect(sourceToDisplay(p,fit)).toEqual({x:450,y:384.375});
    expect(displayToSource(sourceToDisplay(p,fit),fit)).toEqual(p);
    expect(displayToSource({x:300,y:0},fit)).toBeNull();
    for (const mirrored of [true,false]) for (const viewport of [{width:300,height:800},{width:900,height:200}]) {
      const f=containFit(fit.video,viewport,mirrored);
      for (const x of [0,320,1280]) expect(displayToSource(sourceToDisplay({...p,x},f),f)?.x).toBeCloseTo(x);
    }
    expect(canvasBackingSize({width:600,height:300},2)).toEqual({width:1200,height:600});
  });
  it('rejects malformed dimensions, coordinates and DPR', () => {
    expect(()=>containFit({width:0,height:720},{width:600,height:600})).toThrow(/width/);
    expect(()=>imageToPixels(ImageLandmarkSchema.parse({x:1,y:0,z:0}),{width:NaN,height:1})).toThrow(/finite/);
    expect(()=>canvasBackingSize({width:1,height:1},0)).toThrow(/pixel/);
  });
});
describe('world estimates and palm proxy', () => {
  it('measures straight/right-angle bends invariant to translation, scale and rotation', () => {
    expect(flexionDeg(w(0,0),w(0,.03),w(0,.06))).toBeCloseTo(0);
    expect(flexionDeg(w(0,0),w(0,.03),w(.03,.03))).toBeCloseTo(90);
    const f=handFrame();
    expect(indexFlexionEstimates(f.worldLandmarks)).toEqual({pipFlexionDeg:0,dipFlexionDeg:0,mcpProxyFlexionDeg:0});
    const changed=rotateWorld(f.worldLandmarks,70,'x').map(p=>w(p.x*2+10,p.y*2-3,p.z*2+4));
    expect(indexFlexionEstimates(changed).pipFlexionDeg).toBeCloseTo(0);
    expect(thumbReachRatio(f.worldLandmarks,.08)).toBeGreaterThan(0);
  });

  it('uses the documented PIP/DIP topology and explicitly named MCP proxy',()=>{
    const world=handFrame().worldLandmarks.map(p=>({...p}));
    world[0]=w(.02,0);world[5]=w(0,0);world[6]=w(0,.02);world[7]=w(.02,.02);world[8]=w(.02,.04);
    const angles=indexFlexionEstimates(world);
    expect(angles.pipFlexionDeg).toBeCloseTo(90);expect(angles.dipFlexionDeg).toBeCloseTo(90);expect(angles.mcpProxyFlexionDeg).toBeCloseTo(90);
  });
  it('detects roll and tilt, uses orthonormal axes, and has strict hysteresis edges', () => {
    const f=handFrame(), b=palmBasis(f.worldLandmarks);
    expect(b.normal.z).toBeCloseTo(-1);
    for (const axis of ['x','y'] as const) expect(orientationDeviationDeg(b,palmBasis(rotateWorld(f.worldLandmarks,25,axis)))).toBeCloseTo(25);
    expect(nextOrientationLock(false,18)).toBe(false);
    expect(nextOrientationLock(false,18.01)).toBe(true);
    expect(nextOrientationLock(true,14)).toBe(true);
    expect(nextOrientationLock(true,13.99)).toBe(false);
    expect(()=>orientationDeviationDeg({...b,normal:{x:0,y:0,z:0}},b)).toThrow(/basis/);
  });
  it('throws descriptive errors for invalid length, nonfinite and degenerate math', () => {
    expect(()=>indexFlexionEstimates([])).toThrow(/21/);
    expect(()=>flexionDeg(w(0,0),w(0,0),w(1,1))).toThrow(/degenerate/i);
    expect(()=>palmBasis(Array.from({length:21},()=>w(0,0)))).toThrow(/degenerate/i);
    expect(()=>flexionDeg({...w(0,0),x:NaN},w(0,1),w(1,1))).toThrow(/finite/);
  });
  it('smooths by elapsed time, resets on gaps and keeps raw samples separate', () => {
    const a=smoothDisplay(null,0,0);
    expect(smoothDisplay(a,100,80)?.value).toBeCloseTo(100*(1-Math.exp(-1)));
    const half=smoothDisplay(a,100,40);
    expect(smoothDisplay(half,100,80)?.value).toBeCloseTo(smoothDisplay(a,100,80)!.value);
    expect(smoothDisplay(a,100,1000)?.value).toBe(100);
    expect(smoothDisplay(a,null,20)).toBeNull();
    expect(()=>smoothDisplay(a,20,-1)).toThrow(/time/i);
    expect(()=>smoothDisplay(a,20,0)).toThrow(/increasing/);
  });
});
