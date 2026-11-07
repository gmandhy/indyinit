import { AUDIO_CONFIG as A, FUSION_CONFIG as F } from './config';
import { finite, MathInputError, median, positive, timeMs, validatePositiveConfig } from './mathValidation';
import type { AudioImpulse } from './schemas';
import type { VisualCandidate } from './deskVisual';

export interface AcousticStatus { phase:'calibrating'|'ready'|'failed'; reason:string; rms:number; noiseRms:number; thresholdRms:number; elapsedMs:number }
/** PCM never crosses this boundary. One sliding, sample-count window, independent of render/block rate.
 * Event time is the first threshold crossing; amplitude is the subsequent window RMS peak.
 * Sustained input must release before rearming, including after the peak deadline. */
export function createAcousticDetector(sampleRate:number, overrides:Partial<{[K in keyof typeof A]:number}>={}) {
  positive(sampleRate,'sample rate');
  const c={...A,...overrides};validatePositiveConfig(c);
  if(c.releaseRatio>=1||c.noiseMultiplier<=1||c.minThresholdRms>1||c.maxNoiseRms>1||c.clipMagnitude>1)throw new MathInputError('Invalid acoustic thresholds');
  const n=Math.round(sampleRate*c.windowMs/1000);
  if(n<1||n>192000)throw new MathInputError('Invalid RMS window length');
  let ring=new Float64Array(n),cursor=0,filled=0,sum=0,nextFrame:number|null=null,startFrame=0;
  let quietEnergy=0,quietSamples=0,quietPeak=0,sequence=0,lastOnset=-Infinity,active:{frame:number;peak:number}|null=null,armed=true;
  let state:AcousticStatus={phase:'calibrating',reason:'Keep quiet during background calibration.',rms:0,noiseRms:0,thresholdRms:c.minThresholdRms,elapsedMs:0};
  function fail(reason:string){state={...state,phase:'failed',reason};active=null;}
  return {
    getState:()=>({...state}),
    process(samples:Float32Array,firstFrame:number):AudioImpulse[] {
      if(!Number.isSafeInteger(firstFrame)||firstFrame<0||samples.length===0)throw new MathInputError('Nonempty samples and nonnegative integer frame required');
      // Validate whole block before mutating state.
      for(const v of samples){finite(v,'PCM');if(Math.abs(v)>1)throw new MathInputError('PCM outside full scale');}
      if(nextFrame!==null&&firstFrame!==nextFrame)throw new MathInputError(`Discontinuous audio sample clock: expected frame ${nextFrame}, received ${firstFrame}, block ${samples.length}; reset required`);
      if(nextFrame===null)startFrame=firstFrame;
      nextFrame=firstFrame+samples.length;
      const events:AudioImpulse[]=[];
      for(let i=0;i<samples.length;i++){
        const v=samples[i]!,frame=firstFrame+i;
        if(state.phase==='failed')continue;
        if(Math.abs(v)>=c.clipMagnitude){fail('clipped_input: lower microphone gain and recalibrate');continue;}
        sum+=v*v-ring[cursor]!;ring[cursor]=v*v;cursor=(cursor+1)%n;filled=Math.min(n,filled+1);
        const rms=Math.sqrt(Math.max(0,sum)/filled),elapsedMs=(frame-startFrame+1)/sampleRate*1000;
        state.rms=rms;state.elapsedMs=elapsedMs;
        if(state.phase==='calibrating'){
          quietEnergy+=v*v;quietSamples++;quietPeak=Math.max(quietPeak,rms);
          if(elapsedMs>=c.quietMs){
            const noise=Math.sqrt(quietEnergy/quietSamples),threshold=Math.max(c.minThresholdRms,c.noiseMultiplier*noise);
            if(noise>c.maxNoiseRms||quietPeak>Math.max(c.minThresholdRms,c.noiseMultiplier*noise))fail('noisy_calibration: use a quiet interval and retry');
            else state={...state,phase:'ready',reason:'Quiet background calibrated.',noiseRms:noise,thresholdRms:threshold};
          }
          continue;
        }
        const t=frame/sampleRate*1000,release=state.thresholdRms*c.releaseRatio;
        if(active){
          active.peak=Math.max(active.peak,rms);
          if(rms<=release||t-active.frame/sampleRate*1000>=c.maxImpulseMs){
            events.push({sequence:sequence++,sampleTimeMs:active.frame/sampleRate*1000,rms:active.peak});active=null;
          }
          continue; // impulse tail/refractory is never background training
        }
        if(!armed){if(rms<=release)armed=true;else continue;}
        if(rms>=state.thresholdRms&&t-lastOnset>=c.refractoryMs){active={frame,peak:rms};lastOnset=t;armed=false;continue;}
        if(rms<release&&t-lastOnset>=c.refractoryMs){
          const alpha=1-Math.exp(-1000/sampleRate/c.noiseTauMs),noise=state.noiseRms+alpha*(rms-state.noiseRms);
          state.noiseRms=noise;state.thresholdRms=Math.max(c.minThresholdRms,c.noiseMultiplier*noise);
        }
      }
      return events;
    },
  };
}

export interface FusedEvent { visual:VisualCandidate; audio:AudioImpulse; deltaMs:number }
interface Delivered<T> { event:T; rawTime:number; correctedTime:number }
/** Online nearest queued neighbour, deterministic ties by corrected time then sequence.
 * Cannot choose an event that has not arrived. Reset creates a new owner/session; IDs are
 * retained for that owner's bounded trial. Capacity exhaustion fails closed, never evicts dedup IDs. */
export function createCoincidenceMatcher(offsetMs:number, window:{startMs:number;endMs:number}, overrides:Partial<{[K in keyof typeof F]:number}>={}) {
  finite(offsetMs,'offset');timeMs(window.startMs);timeMs(window.endMs);
  const c={...F,...overrides};validatePositiveConfig(c);
  if(Math.abs(offsetMs)>c.maxOffsetMs||window.endMs<=window.startMs||![c.maxQueue,c.maxSeen].every(Number.isSafeInteger))throw new MathInputError('Invalid fusion configuration');
  let visuals:Delivered<VisualCandidate>[]=[],audios:Delivered<AudioImpulse>[]=[],clock=-1,closed=false;
  const seenVisual=new Set<number>(),seenAudio=new Set<number>(),cycles=new Set<number>();
  function advance(nowMs:number){
    timeMs(nowMs);if(nowMs<clock)throw new MathInputError('Delivery clock must be monotonic');clock=nowMs;
    // An on-time queued event must survive until the latest eligible counterpart can arrive.
    // Each NEW delivery still has its own strict 250 ms budget in accept(). Otherwise a
    // +80 ms pair with maximally late audio would work in only one arrival order.
    const horizon=(e:Delivered<unknown>,partnerRawTime:number)=>Math.min(window.endMs,Math.max(e.rawTime,partnerRawTime))+c.deliveryLatenessMs;
    visuals=visuals.filter(e=>nowMs<=horizon(e,e.correctedTime+offsetMs+c.toleranceMs));
    audios=audios.filter(e=>nowMs<=horizon(e,e.correctedTime+c.toleranceMs));
  }
  function accept<T extends {sequence:number}>(event:T,rawTime:number,correctedTime:number,nowMs:number,seen:Set<number>){
    timeMs(rawTime);finite(correctedTime,'corrected time');
    if(!Number.isSafeInteger(event.sequence)||event.sequence<0)throw new MathInputError('Invalid event sequence');
    advance(nowMs);
    if(closed||seen.has(event.sequence)||rawTime>nowMs||nowMs-rawTime>c.deliveryLatenessMs||rawTime<window.startMs||rawTime>=window.endMs||correctedTime<window.startMs||correctedTime>=window.endMs)return false;
    if(seen.size>=c.maxSeen){closed=true;visuals=[];audios=[];throw new MathInputError('Fusion dedup capacity exhausted; reset required');}
    seen.add(event.sequence);return true;
  }
  function nearest<T extends {sequence:number}>(queue:Delivered<T>[],t:number){
    return queue.map((e,i)=>({e,i,d:Math.abs(e.correctedTime-t)})).filter(x=>x.d<=c.toleranceMs).sort((a,b)=>a.d-b.d||a.e.correctedTime-b.e.correctedTime||a.e.event.sequence-b.e.event.sequence)[0];
  }
  return {
    advance,
    pending:()=>({visual:visuals.length,audio:audios.length}),
    reset(){visuals=[];audios=[];seenVisual.clear();seenAudio.clear();cycles.clear();closed=true;},
    visual(event:VisualCandidate,nowMs:number):FusedEvent|null {
      timeMs(event.observedAtMs);
      if(!Number.isSafeInteger(event.cycle)||event.cycle<0||event.observedAtMs<event.captureTimeMs)throw new MathInputError('Invalid visual cycle/time');
      if(event.observedAtMs>nowMs)return null;
      if(!accept(event,event.captureTimeMs,event.captureTimeMs,nowMs,seenVisual)||cycles.has(event.cycle))return null;
      if(cycles.size>=c.maxSeen)throw new MathInputError('Cycle capacity exhausted');
      cycles.add(event.cycle);
      const match=nearest(audios,event.captureTimeMs);
      if(match){audios.splice(match.i,1);return {visual:event,audio:match.e.event,deltaMs:match.e.correctedTime-event.captureTimeMs};}
      if(visuals.length>=c.maxQueue)visuals.shift();
      visuals.push({event,rawTime:event.captureTimeMs,correctedTime:event.captureTimeMs});return null;
    },
    audio(event:AudioImpulse,nowMs:number):FusedEvent|null {
      finite(event.rms,'RMS');if(event.rms<0||event.rms>1)throw new MathInputError('Invalid RMS');
      const corrected=event.sampleTimeMs-offsetMs;
      if(!accept(event,event.sampleTimeMs,corrected,nowMs,seenAudio))return null;
      const match=nearest(visuals,corrected);
      if(match){visuals.splice(match.i,1);return {visual:match.e.event,audio:event,deltaMs:corrected-match.e.correctedTime};}
      if(audios.length>=c.maxQueue)audios.shift();
      audios.push({event,rawTime:event.sampleTimeMs,correctedTime:corrected});return null;
    },
  };
}

export interface TimingPair { visualTimeMs:number; audioTimeMs:number }
/** Operator-isolated single-event windows avoid circular offset-based pairing. */
export function estimateTimingCalibration(pairs:readonly TimingPair[]) {
  if(pairs.length<F.minPairs||pairs.length>F.maxPairs)throw new MathInputError('Record 3–5 unambiguous spaced timing pairs');
  let previous=-Infinity;
  const offsets=pairs.map(p=>{timeMs(p.visualTimeMs);timeMs(p.audioTimeMs);if(p.visualTimeMs-previous<F.minPairSpacingMs)throw new MathInputError('Space timing taps by at least 600 ms');previous=p.visualTimeMs;return p.audioTimeMs-p.visualTimeMs;});
  const offsetMs=median(offsets),residualSpreadMs=Math.max(...offsets.map(v=>Math.abs(v-offsetMs)));
  if(Math.abs(offsetMs)>F.maxOffsetMs||residualSpreadMs>F.maxResidualMs)throw new MathInputError('Uncertain timing calibration; retry spaced taps');
  return {offsetMs,residualSpreadMs};
}
