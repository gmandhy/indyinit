import { syntheticDiagnosticEvents } from '../../fixtures/acousticEvents';
import { syntheticFrames, syntheticHandFrame } from '../../fixtures/syntheticHand';
import type { AdapterEvent, ExerciseSelection, SessionAdapter } from '../engine/contracts';
/** Artificial source observations only. Desk lifts use the actual calibration/contact/fusion engines.
 * One tap command produces a bounded motion path and an onset +25 ms after fixture contact. */
export function createReplayAdapter(now: () => number): SessionAdapter {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed=false,generation=0,tapStart:number|null=null;
  let selection:ExerciseSelection={exercise:'air_targets',sensorMode:'vision_only'};
  const stop=()=>{generation++;clearTimeout(timer);timer=undefined;tapStart=null;};
  return {
    source:'synthetic_replay',
    selectExercise(next){selection=next;tapStart=null;},
    replayTap(){if(!disposed&&selection.exercise==='desk_tap'&&tapStart===null)tapStart=now();},
    async prepare(){if(disposed)throw new Error('Replay adapter disposed');},
    play(emit){
      if(disposed)throw new Error('Replay adapter disposed');stop();
      const token=generation,anchor=now();let index=0;
      const next=()=>{
        if(disposed||token!==generation)return;
        const source=syntheticFrames[index];if(!source){emit({type:'end'});return;}
        const remaining=anchor+source.captureTimeMs-now();
        if(remaining>0){timer=setTimeout(next,Math.ceil(remaining));return;}
        const capture=anchor+source.captureTimeMs,sequence=index++;
        let sample={...source,captureTimeMs:capture};
        let events:AdapterEvent[]=[];
        if(selection.exercise==='desk_tap'){
          const frame=syntheticHandFrame(capture,sequence),step=tapStart===null?-1:Math.floor((capture-tapStart)/50);
          // Three initial resting frames, projected 30 px excursion, return at step 8,
          // and >=3 resting endpoints. Audio is delivered on the confirmation frame.
          const lifts=[0,0,0,0,15,30,30,15,0,0,0,0,0,0];
          const lift=step<0?0:lifts[step]??0;
          sample={...frame,imageLandmarks:frame.imageLandmarks.map((p,i)=>i===8?{...p,y:p.y-lift/360}:p)};
          if(step===9&&selection.sensorMode==='fused')events=[{type:'audio',impulse:{sequence,sampleTimeMs:capture-25,rms:.2}}];
          if(step>=lifts.length)tapStart=null;
        }else events=syntheticDiagnosticEvents(source.captureTimeMs,anchor);
        emit({type:'frame',sample});if(disposed||token!==generation)return;
        for(const event of events){emit(event);if(disposed||token!==generation)return;}
        timer=setTimeout(next,Math.max(0,Math.ceil(anchor+(syntheticFrames[index]?.captureTimeMs??source.captureTimeMs+50)-now())));
      };next();
    },stop,dispose(){disposed=true;stop();},
  };
}
