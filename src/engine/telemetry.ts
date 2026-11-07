import { SessionTelemetrySchema, parseTelemetryJson } from '../lib/schemas';
import type { Calibration, SessionTelemetry } from '../lib/schemas';
import type { AirTargetState } from '../lib/spatialTargets';
import { FUSION_CONFIG, SESSION_CONFIG } from '../lib/config';
import { finite, MathInputError, timeMs } from '../lib/mathValidation';
export { parseTelemetryJson, SessionTelemetrySchema };

/** Streaming aggregates only; no landmarks/media. Tap memory is bounded by fusion's cycle budget.
 * Capture timestamps define all windows; arrival order cannot alter statistics. No baseline storage. */
export function createTelemetryCollector(calibration:Calibration, source:SessionTelemetry['source'], sessionId:string, startMs:number) {
  timeMs(startMs);
  let total=0,valid=0,pipCount=0,pipSum=0,min=Infinity,max=-Infinity,deviation:number|null=null,visuals=0;
  let air:AirTargetState|null=null;
  const taps=new Map<number,{time:number;rms:number|null}>();
  const inTrial=(t:number)=>{timeMs(t);return t>=startMs&&t<startMs+SESSION_CONFIG.trialMs;};
  return {
    frame(t:number,isValid:boolean,pip:number|null){
      if(!inTrial(t))return;
      if(pip!==null){finite(pip,'PIP estimate');if(!isValid||pip<0||pip>180)throw new MathInputError('Invalid PIP observation');}
      total++;if(isValid)valid++;
      if(pip!==null){pipCount++;pipSum+=pip;min=Math.min(min,pip);max=Math.max(max,pip);}
    },
    air(state:AirTargetState){air=state;if(state.deviationDeg!==null)deviation=Math.max(deviation??0,state.deviationDeg);},
    visual(t:number){if(inTrial(t))visuals++;},
    tap(cycle:number,t:number,rms:number|null){
      if(!Number.isInteger(cycle)||cycle<0)throw new MathInputError('Invalid contact cycle');
      if(rms!==null){finite(rms,'acoustic RMS');if(rms<0||rms>1)throw new MathInputError('Invalid acoustic RMS');}
      if(!inTrial(t)||taps.has(cycle))return false;
      if(taps.size>=FUSION_CONFIG.maxSeen)throw new MathInputError('Telemetry contact budget exhausted; reset required');
      if(calibration.sensorMode==='fused'?rms===null:rms!==null)throw new MathInputError('Acoustic amplitude disagrees with sensor mode');
      taps.set(cycle,{time:t,rms});return true;
    },
    finish(status:SessionTelemetry['status'],endMs:number):SessionTelemetry|null {
      timeMs(endMs);if(endMs<startMs)throw new MathInputError('Trial end precedes start');
      const durationSeconds=(Math.min(endMs,startMs+SESSION_CONFIG.trialMs)-startMs)/1000;
      // A cancelled countdown or instantaneous stop has no positive observation interval.
      if(durationSeconds===0)return null;
      const attempts=calibration.exercise==='air_targets'?(air?.attempts??0):visuals;
      const blocked=calibration.exercise==='air_targets'?(air?.blockedAttempts??0):0;
      const common={schemaVersion:1,sessionId,source,hand:calibration.hand,configurationRevision:calibration.configurationRevision,status,durationSeconds,
        quality:{totalFrames:total,validFrames:valid,trackingCoverage:total?valid/total:0,attempts,blockedAttempts:blocked,lockoutEvents:air?.lockoutEvents??0,maxPalmDeviationDeg:deviation,compensationPct:attempts?100*blocked/attempts:null,rejectedCandidates:calibration.exercise==='desk_tap'?Math.max(0,visuals-taps.size):0}};
      if(calibration.exercise==='air_targets')return SessionTelemetrySchema.parse({...common,exercise:'air_targets',sensorMode:'vision_only',metrics:{completedReps:air?.completedReps??0,minPipFlexionDeg:pipCount?min:null,maxPipFlexionDeg:pipCount?max:null,meanPipFlexionDeg:pipCount?pipSum/pipCount:null,romDeg:pipCount?max-min:null,baselineComparison:null}});
      const sorted=[...taps.values()].sort((a,b)=>a.time-b.time);
      const intervals=sorted.slice(1).map((tap,i)=>tap.time-sorted[i]!.time);
      const early=sorted.filter(t=>t.time<startMs+5000).length/5,late=sorted.filter(t=>t.time>=startMs+10000).length/5;
      const amplitudes=sorted.flatMap(t=>t.rms===null?[]:[t.rms]);
      const mean=amplitudes.length?average(amplitudes):null;
      return SessionTelemetrySchema.parse({...common,exercise:'desk_tap',sensorMode:calibration.sensorMode,metrics:{acceptedTapCount:sorted.length,verifiedTapCount:calibration.sensorMode==='fused'?sorted.length:0,kinematicTapCount:calibration.sensorMode==='kinematic_only'?sorted.length:0,frequencyHz:sorted.length/durationSeconds,earlyHz:status==='completed'?early:null,lateHz:status==='completed'?late:null,rateChangePct:status==='completed'&&early>0?100*(late-early)/early:null,rhythmJitterMs:intervals.length>=2?sd(intervals):null,meanAcousticRms:mean,acousticCv:mean!==null&&mean>0?sd(amplitudes)/mean:null}});
    },
  };
}
function average(values:readonly number[]){return values.reduce((sum,n)=>sum+n,0)/values.length;}
function sd(values:readonly number[]){const mean=average(values);return Math.sqrt(average(values.map(n=>(n-mean)**2)));}
/** Validate again at download/summary boundaries. Local summaries make no diagnostic inference. */
export function telemetryJson(result:SessionTelemetry){return JSON.stringify(parseTelemetryJson(JSON.stringify(result)),null,2);}
export function localSummary(input:SessionTelemetry):string {
  const t=SessionTelemetrySchema.parse(input),m=t.metrics;
  const label=`${t.source==='live'?'Live':'Synthetic replay'} / ${t.sensorMode} / ${t.status}, ${t.durationSeconds.toFixed(2)} s.`;
  if(t.exercise==='air_targets')return `${label} ${t.metrics.completedReps} air reps. Estimated PIP ROM: ${t.metrics.romDeg?.toFixed(1)??'not measured'}°. Baseline: not collected.`;
  if(!('frequencyHz' in m))throw new Error('Expected desk metrics');
  return `${label} ${m.acceptedTapCount} ${t.sensorMode==='fused'?'fused coincidences':'kinematic taps'}; ${m.frequencyHz.toFixed(2)} Hz. Rate change: ${m.rateChangePct===null?'not measured':m.rateChangePct.toFixed(1)+'%'}. Relative microphone amplitude is not force. Coincidence does not prove physical contact.`;
}
