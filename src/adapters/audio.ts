import { AUDIO_CONFIG } from '../lib/config';
import workletUrl from '../audio/tapProcessor.ts?worker&url';
import type { TapProcessorCommand, TapProcessorMessage } from '../audio/tapProtocol';
import type { AcousticStatus } from '../lib/acousticTap';
import { AudioImpulseSchema } from '../lib/schemas';
import type { AudioImpulse } from '../lib/schemas';
export interface AudioClockAnchor { readonly audioTimeSeconds:number; readonly sessionTimeMs:number; readonly uncertaintyMs:number }
export interface AudioDiagnostics {
  state:'not_started'|'requesting'|'calibrating'|'ready'|'unavailable'; message:string;
  sampleRate:number|null; blockFrames?:number; settings:string; clock:AudioClockAnchor|null; level:AcousticStatus|null;
}
export type AudioEvent = {type:'audio';impulse:AudioImpulse}|{type:'audio_status';diagnostics:AudioDiagnostics};
export interface AudioAdapter { start(emit:(event:AudioEvent)=>void):Promise<void>; reset():void; stop():void; dispose():void; getDiagnostics():AudioDiagnostics }
export interface AudioEnvironment {
  now:()=>number; secure:()=>boolean; media:Pick<MediaDevices,'getUserMedia'|'getSupportedConstraints'|'addEventListener'|'removeEventListener'>;
  context:()=>AudioContext; node:(context:AudioContext)=>AudioWorkletNode;
}
const initial=():AudioDiagnostics=>({state:'not_started',message:'Microphone has not been requested.',sampleRate:null,settings:'not measured',clock:null,level:null});
/** Camera-independent owner. start must be called directly from a user gesture: resume
 * is invoked before any permission/module await. Late permission results release their own tracks. */
export function createAudioAdapter(environment?:AudioEnvironment):AudioAdapter {
  const env=environment??{now:()=>performance.now(),secure:()=>window.isSecureContext,media:navigator.mediaDevices,
    context:()=>new AudioContext(),node:(ctx:AudioContext)=>new AudioWorkletNode(ctx,'itap-tap',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:'explicit'})};
  let diagnostics=initial(),generation=0,epoch=0,disposed=false,context:AudioContext|null=null,stream:MediaStream|null=null,node:AudioWorkletNode|null=null,source:MediaStreamAudioSourceNode|null=null;
  let emit:(event:AudioEvent)=>void=()=>{},removeListeners:(()=>void)|null=null;
  function publish(){emit({type:'audio_status',diagnostics:{...diagnostics}});}
  function release(){
    generation++;epoch++;removeListeners?.();removeListeners=null;
    if(node){node.port.onmessage=null;node.onprocessorerror=null;node.port.close();node.disconnect();node=null;}
    source?.disconnect();source=null;stream?.getTracks().forEach(t=>t.stop());stream=null;
    const old=context;context=null;if(old){old.onstatechange=null;void old.close().catch(()=>{/* already closed; no media survives */});}
  }
  function unavailable(message:string){release();diagnostics={...diagnostics,state:'unavailable',message,clock:null,level:null};publish();}
  function reset(){
    epoch++;diagnostics={...diagnostics,level:null};
    if(context?.state==='running'&&node){
      const before=env.now(),audioTimeSeconds=context.currentTime,after=env.now();
      diagnostics={...diagnostics,state:'calibrating',message:'Keep quiet for 1.5 seconds.',clock:{audioTimeSeconds,sessionTimeMs:(before+after)/2,uncertaintyMs:(after-before)/2}};
      const command:TapProcessorCommand={type:'reset',epoch};node.port.postMessage(command);publish();
    }
  }
  return {
    getDiagnostics:()=>({...diagnostics}),reset,
    async start(sink){
      if(disposed)return;release();emit=sink;diagnostics={...initial(),state:'requesting',message:'Requesting microphone separately from camera.'};publish();
      const token=generation;
      let owned:AudioContext|null=null;
      try{
        if(!env.secure()||!env.media)throw new Error('Microphone requires HTTPS or localhost and mediaDevices');
        owned=env.context();context=owned;
        // Resume is deliberately invoked in the initiating click, even if permission is slow.
        const supported=env.media.getSupportedConstraints(),constraints:MediaTrackConstraints={channelCount:{ideal:1}};
        if(supported.echoCancellation)constraints.echoCancellation=false;
        if(supported.noiseSuppression)constraints.noiseSuppression=false;
        if(supported.autoGainControl)constraints.autoGainControl=false;
        const resumed=owned.resume();
        const permission=(()=>{try{return env.media.getUserMedia({video:false,audio:constraints});}catch(error){return Promise.reject(error);}})().then(acquired=>{
          // Own/release the stream as soon as permission resolves, even if resume is pending.
          if(disposed||generation!==token){acquired.getTracks().forEach(t=>t.stop());return;}
          stream=acquired;
        });
        // Fail immediately on either error; the permission continuation still releases late tracks.
        await Promise.all([resumed,permission]);
        if(disposed||generation!==token)return;
        if(owned.state!=='running')throw new Error('Audio context is suspended. Retry microphone from a click.');
        const track=stream!.getAudioTracks()[0];if(!track)throw new Error('No microphone track');
        const settings=track.getSettings();
        // Do not expose device/group IDs. Constraints are requests, these are actual settings.
        diagnostics={...diagnostics,sampleRate:owned.sampleRate,settings:JSON.stringify({supported:{echoCancellation:!!supported.echoCancellation,noiseSuppression:!!supported.noiseSuppression,autoGainControl:!!supported.autoGainControl},actual:{sampleRate:settings.sampleRate??null,channelCount:settings.channelCount??null,echoCancellation:settings.echoCancellation??null,noiseSuppression:settings.noiseSuppression??null,autoGainControl:settings.autoGainControl??null}})};
        await owned.audioWorklet.addModule(workletUrl);
        if(disposed||generation!==token)return;
        node=env.node(owned);source=owned.createMediaStreamSource(stream!);
        node.port.onmessage=(event:MessageEvent<TapProcessorMessage>)=>{
          if(disposed||generation!==token||event.data.epoch!==epoch)return;
          const data=event.data,anchor=diagnostics.clock;if(!anchor)return;
          if(data.type==='error'){unavailable(`Audio calibration/capture failed: ${data.message}. Retry microphone; kinematic-only requires explicit selection.`);return;}
          if(data.type==='level'){
            // Render-quantum clock can lead performance by one block. Detect substantial drift;
            // do not silently rewrite timestamps while queues contain calibrated events.
            const drift=Math.abs((owned!.currentTime-anchor.audioTimeSeconds)*1000-(env.now()-anchor.sessionTimeMs));
            if(drift>AUDIO_CONFIG.maxClockDriftMs){unavailable('Audio clock discontinuity; restart and recalibrate timing.');return;}
            diagnostics={...diagnostics,blockFrames:data.blockFrames,clock:{...anchor,uncertaintyMs:Math.max(anchor.uncertaintyMs,data.blockFrames/owned!.sampleRate*1000)},state:data.status.phase==='ready'?'ready':'calibrating',message:data.status.reason,level:data.status};publish();return;
          }
          const impulse={...data.impulse,sampleTimeMs:anchor.sessionTimeMs+(data.impulse.sampleTimeMs-anchor.audioTimeSeconds*1000)};
          if(!AudioImpulseSchema.safeParse(impulse).success||impulse.sampleTimeMs>env.now()){unavailable('Invalid/future sample-clock audio event; restart microphone and recalibrate.');return;}
          emit({type:'audio',impulse});
        };
        node.onprocessorerror=()=>unavailable('AudioWorklet processor failed; restart microphone.');
        const ended=()=>unavailable('Microphone ended/device changed; timing calibration invalidated.');
        track.addEventListener('ended',ended);track.addEventListener('mute',ended);env.media.addEventListener('devicechange',ended);
        removeListeners=()=>{track.removeEventListener('ended',ended);track.removeEventListener('mute',ended);env.media.removeEventListener('devicechange',ended);};
        owned.onstatechange=()=>{if(generation===token&&owned?.state!=='running')unavailable('Audio context suspended; restart microphone from a user action and recalibrate.');};
        reset();source.connect(node);node.connect(owned.destination); // processor writes zeros only
      }catch(error){if(!disposed&&generation===token)unavailable(error instanceof Error?`${error.name}: ${error.message}`:'Microphone unavailable');}
    },
    stop(){release();diagnostics=initial();},
    dispose(){disposed=true;release();diagnostics=initial();},
  };
}
