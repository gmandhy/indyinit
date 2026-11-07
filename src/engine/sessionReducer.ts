import type { SessionPhase } from './contracts';
import { SESSION_CONFIG } from '../lib/config';
import { MathInputError, timeMs, validatePositiveConfig } from '../lib/mathValidation';
export type { SessionPhase } from './contracts';
export type SessionEvent='request'|'prepared'|'calibrate'|'calibrated'|'start'|'tick'|'cancel'|'stop'|'reset'|'fault'|'tracking_lost'|'hidden'|'mode_changed';
export interface SessionState {
  readonly phase:SessionPhase; readonly resourcesReady:boolean; readonly calibrationValid:boolean;
  readonly countdownEndsAtMs:number|null; readonly startedAtMs:number|null; readonly endsAtMs:number|null; readonly endedAtMs:number|null;
  readonly status:'completed'|'aborted'|null;
}
const initial=():SessionState=>({phase:'idle',resourcesReady:false,calibrationValid:false,countdownEndsAtMs:null,startedAtMs:null,endsAtMs:null,endedAtMs:null,status:null});
/** Clock is injected; no timers, DOM, React or device ownership. tick never extends a missed deadline. */
export function createSessionMachine(now:()=>number,overrides:Partial<{countdownMs:number;trialMs:number;deliveryGraceMs:number}>={}) {
  const config={...SESSION_CONFIG,...overrides};validatePositiveConfig(config);
  let lastTime=timeMs(now()),state=initial();
  function readTime(){const t=timeMs(now());if(t<lastTime)throw new MathInputError('Session clock must be monotonic');lastTime=t;return t;}
  function send(event:SessionEvent):SessionState {
    const t=readTime();
    const active=state.phase==='running'||state.phase==='countdown';
    if(event==='stop'){state=initial();return state;}
    if(event==='reset'||event==='cancel'){state={...initial(),phase:state.resourcesReady?'ready':'idle',resourcesReady:state.resourcesReady};return state;}
    if(event==='fault'){state={...initial(),phase:'error',resourcesReady:state.resourcesReady,status:active?'aborted':state.status,endedAtMs:active?t:state.endedAtMs};return state;}
    if(event==='hidden'||event==='mode_changed'||event==='tracking_lost'){
      state={...initial(),phase:state.resourcesReady?'ready':'idle',resourcesReady:state.resourcesReady,status:active?'aborted':state.status,endedAtMs:active?t:state.endedAtMs};return state;
    }
    if(event==='tick'){
      if(state.phase==='countdown'&&t>=state.countdownEndsAtMs!){const start=state.countdownEndsAtMs!;state={...state,phase:'running',startedAtMs:start,endsAtMs:start+config.trialMs};}
      if(state.phase==='running'&&t>=state.endsAtMs!)state={...state,phase:'complete',endedAtMs:state.endsAtMs,status:'completed'};
      return state;
    }
    const transitions:Partial<Record<SessionEvent,readonly SessionPhase[]>>={request:['idle','error'],prepared:['requesting'],calibrate:['ready','calibrated','complete'],calibrated:['calibrating'],start:['calibrated']};
    if(!transitions[event]?.includes(state.phase))throw new MathInputError(`Invalid session transition ${event} from ${state.phase}`);
    switch(event){
      case 'request':state={...initial(),phase:'requesting'};break;
      case 'prepared':state={...state,phase:'ready',resourcesReady:true};break;
      case 'calibrate':state={...initial(),phase:'calibrating',resourcesReady:true};break;
      case 'calibrated':state={...state,phase:'calibrated',calibrationValid:true};break;
      case 'start':if(!state.calibrationValid)throw new MathInputError('Calibration required');state={...state,phase:'countdown',countdownEndsAtMs:t+config.countdownMs};break;
    }
    return state;
  }
  return {getState:()=>state,send,
    acceptsCapture(captureTimeMs:number):boolean {
      timeMs(captureTimeMs);const t=readTime();
      return state.status!=='aborted'&&state.startedAtMs!==null&&state.endsAtMs!==null&&captureTimeMs<=t&&captureTimeMs>=state.startedAtMs&&captureTimeMs<state.endsAtMs&&t<=state.endsAtMs+config.deliveryGraceMs;
    },
  };
}
