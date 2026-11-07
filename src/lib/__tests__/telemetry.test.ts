import {describe,it,expect} from 'vitest';
import {createTelemetryCollector,telemetryJson,localSummary,parseTelemetryJson} from '../../engine/telemetry';
import {createPalmCalibrator} from '../calibration';
import {syntheticHandFrame} from '../../../fixtures/syntheticHand';
import {CalibrationSchema} from '../schemas';
const id='ac639b41-890c-4f0a-b578-11b0a57997fd';
function calibration(){const c=createPalmCalibrator({width:640,height:360});for(let i=0;i<=60;i++)c.observe(syntheticHandFrame(i*50,i),i*50);return c.getState().calibration!;}
export function deskCalibration(mode:'fused'|'kinematic_only'='fused'){return CalibrationSchema.parse({...calibration(),exercise:'desk_tap',sensorMode:mode,desk:{region:{center:{x:320,y:153},radiusPixels:28},rest:{x:320,y:153},wristRest:{x:320,y:288},contactDirection:{x:0,y:1},contactBand:{minPalmUnits:-.025,maxPalmUnits:.025},excursionPalmUnits:.375,wristTolerancePalmUnitsPerSecond:.25},...(mode==='fused'?{audio:{offsetMs:25,residualSpreadMs:0}}:{})});}
describe('capture-time telemetry',()=>{
 it('reconciles exclusive windows, out-of-order taps, population rhythm and matched amplitudes',()=>{
  const c=createTelemetryCollector(deskCalibration(),'synthetic_replay',id,1000);
  for(const [i,t] of [0,4999,5000,9999,10000,14999].entries()){c.visual(1000+t);c.tap(i,1000+t,i%2?.3:.1);}
  c.tap(0,13000,.9);expect(c.tap(99,16000,.1)).toBe(false);
  c.frame(1000,true,20);c.frame(1100,false,null);c.frame(16000,true,180);
  const r=c.finish('completed',16000)!;expect(r).toMatchObject({quality:{totalFrames:2,validFrames:1,trackingCoverage:.5,rejectedCandidates:0},metrics:{acceptedTapCount:6,verifiedTapCount:6,frequencyHz:.4,earlyHz:.4,lateHz:.4,rateChangePct:0}});
  if(r.exercise!=='desk_tap')throw Error();expect(r.metrics.meanAcousticRms).toBeCloseTo(.2);expect(r.metrics.acousticCv).toBeCloseTo(.5);expect(r.metrics.rhythmJitterMs).toBeCloseTo(2448.51,1);
  expect(parseTelemetryJson(telemetryJson(r))).toEqual(r);expect(localSummary(r)).toContain('Synthetic replay / fused');
 });
 it('sorts timestamps and keeps empty/aborted/fallback statistics truthful',()=>{
  const c=createTelemetryCollector(deskCalibration('kinematic_only'),'live',id,0);
  for(const [i,t] of [3000,1000,2000].entries()){c.visual(t);c.tap(i,t,null);}c.visual(3500);
  const r=c.finish('aborted',4000)!;expect(r).toMatchObject({status:'aborted',quality:{rejectedCandidates:1,maxPalmDeviationDeg:null},metrics:{verifiedTapCount:0,kinematicTapCount:3,frequencyHz:.75,earlyHz:null,lateHz:null,rateChangePct:null,rhythmJitterMs:0,meanAcousticRms:null,acousticCv:null}});
  const empty=createTelemetryCollector(deskCalibration(),'live',id,0);expect(empty.finish('aborted',0)).toBeNull();expect(empty.finish('completed',15000)).toMatchObject({metrics:{earlyHz:0,lateHz:0,rateChangePct:null,rhythmJitterMs:null,meanAcousticRms:null,acousticCv:null}});
 });
 it('uses raw valid ROM and no invented baseline; rejects invalid observations',()=>{
  const c=createTelemetryCollector(calibration(),'live',id,0);expect(c.finish('completed',15000)).toMatchObject({metrics:{romDeg:null,minPipFlexionDeg:null,baselineComparison:null}});
  c.frame(0,true,10);c.frame(50,true,70);c.frame(100,false,null);expect(c.finish('completed',15000)).toMatchObject({metrics:{romDeg:60,meanPipFlexionDeg:40}});
  expect(()=>c.frame(200,true,NaN)).toThrow();expect(()=>c.tap(1,200,.2)).toThrow('sensor mode');
 });
});
