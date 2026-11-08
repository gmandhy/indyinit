import { createTelemetryCollector } from './telemetry';
import { SYNTHETIC_AUDIO_OFFSET_MS } from '../../fixtures/acousticEvents';
import type { AudioAdapter, AudioEvent } from '../adapters/audio';
import { createCoincidenceMatcher, estimateTimingCalibration } from '../lib/acousticTap';
import type { FusedEvent, TimingPair } from '../lib/acousticTap';
import type { VisualCandidate, DeskCalibration } from '../lib/deskVisual';
import { CalibrationSchema, AudioImpulseSchema, FrameSampleSchema } from '../lib/schemas';
import type { Calibration, FrameSample } from '../lib/schemas';
import { emptyFusion, initialSnapshot } from './contracts';
import type { AdapterEvent, DeskSnapshot, SessionAdapter, SessionController, SessionSnapshot } from './contracts';
import { createSessionMachine } from './sessionReducer';
import { createPalmCalibrator } from '../lib/calibration';
import { calibrationCompatibilityReason, createAirTargetEngine, DEFAULT_AIR_TARGET, reachableAirPath } from '../lib/spatialTargets';
import { createDeskCalibrator, createDeskVisualDetector, deskCompatibilityReason } from '../lib/deskVisual';
import type { AirCalibration } from '../lib/calibration';
import { containFit, displayToSource, sourcePixel } from '../lib/coordinates';
import { indexFlexionEstimates, smoothDisplay } from '../lib/biomechanics';
import type { SmoothedDisplay } from '../lib/biomechanics';
import { DESK_CONFIG, FRAME_CONFIG, FUSION_CONFIG, LIMITS, SESSION_CONFIG } from '../lib/config';
import { createDeskPadDetector, validateDeskPads } from '../lib/deskPads';
import { MathInputError, timeMs } from '../lib/mathValidation';
import type { Size } from '../lib/coordinates';
/** Orchestration only. Adapter owns scheduling/devices; pure engines own math and scoring. */
export function createSessionController(adapter:SessionAdapter,checkAssets?:()=>Promise<string>,now:()=>number=()=>performance.now(),video:Size={width:640,height:360},audio?:AudioAdapter):SessionController {
  const machine=createSessionMachine(now);
  const live=adapter.source==='live', label=live?'Live':'Synthetic';
  let snapshot=initialSnapshot(adapter.source),disposed=false,generation=0,audioGeneration=0,lastSequence=-1,lastTime=-1,lastPublish=-Infinity;
  function newPalmCalibrator(){return createPalmCalibrator(video,{},snapshot.selection.exercise==='desk_tap'?'desk_geometry':'open_hand');}
  let calibrator=newPalmCalibrator(),air:ReturnType<typeof createAirTargetEngine>|null=null,display:SmoothedDisplay|null=null;
  let deskCalibrator:ReturnType<typeof createDeskCalibrator>|null=null,deskDetector:ReturnType<typeof createDeskVisualDetector>|null=null,deskPalm:AirCalibration|null=null;
  let layout:'single'|'left_right'='single',savedPads:DeskCalibration[]=[];
  function makeDeskDetector(cal:Extract<Calibration,{exercise:'desk_tap'}>){
    if(layout==='single')return createDeskVisualDetector(cal);
    if(savedPads.length!==2)throw new MathInputError('Calibrate both Left and Right pads first.');
    return createDeskPadDetector(savedPads[0]!,savedPads[1]!);
  }
  let matcher:ReturnType<typeof createCoincidenceMatcher>|null=null,timingCalibration:DeskCalibration|null=null;
  let pairs:TimingPair[]=[],pairStart:number|null=null,pairVisuals:VisualCandidate[]=[],pairAudios:import('../lib/schemas').AudioImpulse[]=[];
  let collector:ReturnType<typeof createTelemetryCollector>|null=null,trialStart:number|null=null;
  function finishTrial(aborted=false){
    if(!collector||trialStart===null)return;
    const t=now(),end=trialStart+SESSION_CONFIG.trialMs;
    if(aborted){snapshot={...snapshot,result:t>=trialStart?collector.finish('aborted',Math.min(t,end)):null};collector=null;trialStart=null;}
    else if(t>end+(snapshot.selection.exercise==='desk_tap'?SESSION_CONFIG.deliveryGraceMs:0)){snapshot={...snapshot,result:collector.finish('completed',end)};collector=null;trialStart=null;}
  }
  function accepted(cycle:number,capture:number,rms:number|null,position?:VisualCandidate['position'],pad?:VisualCandidate['pad']){
    if(!collector?.tap(cycle,capture,rms))return;
    deskUpdate({acceptedTapCount:(snapshot.desk?.acceptedTapCount??0)+1,lastAccepted:{atMs:now(),mode:snapshot.selection.sensorMode==='fused'?'fused':'kinematic_only',...(position?{position}:{}),...(pad?{pad}:{})},...(pad==='left'?{leftTapCount:(snapshot.desk?.leftTapCount??0)+1}:pad==='right'?{rightTapCount:(snapshot.desk?.rightTapCount??0)+1}:{})},false);
  }
  const listeners=new Set<()=>void>();
  function trace(kind:'visual'|'acoustic'|'fused',timeMs:number){snapshot={...snapshot,fusion:{...snapshot.fusion,trace:[...snapshot.fusion.trace,{kind,timeMs}].slice(-32)}};}
  function matched(event:FusedEvent|null){if(!event)return;if(snapshot.selection.sensorMode==='fused')accepted(event.visual.cycle,event.visual.captureTimeMs,event.audio.rms,event.visual.position,event.visual.pad);trace('fused',event.visual.captureTimeMs);snapshot={...snapshot,fusion:{...snapshot.fusion,fusedCount:snapshot.fusion.fusedCount+1,lastFused:event}};}
  function visualEvent(candidate:VisualCandidate){
    collector?.visual(candidate.captureTimeMs);
    if(snapshot.selection.sensorMode==='kinematic_only'&&machine.acceptsCapture(candidate.captureTimeMs))accepted(candidate.cycle,candidate.captureTimeMs,null,candidate.position,candidate.pad);
    trace('visual',candidate.captureTimeMs);snapshot={...snapshot,fusion:{...snapshot.fusion,visualCount:snapshot.fusion.visualCount+1}};
    if(pairStart!==null&&candidate.captureTimeMs>=pairStart&&pairVisuals.length<2)pairVisuals.push(candidate);
    if(matcher)matched(matcher.visual(candidate,now()));
  }
  function receiveAudio(event:AudioEvent){
    if(disposed)return;
    if(event.type==='audio_status'){
      const changed=event.diagnostics.state!==snapshot.audio.state;
      if(event.diagnostics.state==='unavailable'&&snapshot.selection.sensorMode==='fused'&&['calibrating','calibrated','countdown','running','complete'].includes(machine.getState().phase))suspend('Microphone unavailable; fused setup/trial invalidated. Retry microphone and recalibrate, or explicitly select kinematic-only.');
      update({audio:event.diagnostics},changed);return;
    }
    if(!AudioImpulseSchema.safeParse(event.impulse).success){suspend('Invalid audio event; recalibrate.',true);return;}
    const t=now(),impulse=event.impulse;
    if(impulse.sampleTimeMs>t||t-impulse.sampleTimeMs>FUSION_CONFIG.deliveryLatenessMs){update({fusion:{...snapshot.fusion,rejectedAudioCount:snapshot.fusion.rejectedAudioCount+1,lastRejection:impulse.sampleTimeMs>t?'Future audio timestamp':'Audio delivery exceeded 250 ms'}},false);return;}
    trace('acoustic',impulse.sampleTimeMs);snapshot={...snapshot,fusion:{...snapshot.fusion,audioCount:snapshot.fusion.audioCount+1,lastAudio:impulse}};
    if(pairStart!==null&&impulse.sampleTimeMs>=pairStart&&pairAudios.length<2)pairAudios.push(impulse);
    try{if(matcher)matched(matcher.audio(impulse,t));}catch(error){if(!(error instanceof MathInputError))throw error;suspend(error.message);}
    update({},false);
  }

  const frameListeners=new Set<(sample:FrameSample)=>void>();
  let lastNotifiedFrame:FrameSample|null=null;
  const frameBuffer:SessionController['frameBuffer']={subscribeFrames(listener){frameListeners.add(listener);if(frameBuffer.current)listener(frameBuffer.current);return()=>{frameListeners.delete(listener);};},current:null,target:null,video,media:null,recordRender:()=>adapter.recordRender?.()};
  function update(patch:Partial<SessionSnapshot>,force=true){
    const state=machine.getState(),tNow=now();
    snapshot={...snapshot,...patch,deskLayout:layout,phase:state.phase,trial:state.countdownEndsAtMs===null?null:{countdownSeconds:Math.max(0,(state.countdownEndsAtMs-tNow)/1000),remainingSeconds:Math.max(0,((state.endsAtMs??state.countdownEndsAtMs+SESSION_CONFIG.trialMs)-tNow)/1000),settling:state.phase==='complete'&&collector!==null}};
    // Deliver each accepted sample once; low-rate UI polling must not reset capture-time holds.
    if(frameBuffer.current&&frameBuffer.current!==lastNotifiedFrame){lastNotifiedFrame=frameBuffer.current;for(const listener of frameListeners)listener(frameBuffer.current);}
    const t=timeMs(now());
    if(force||t-lastPublish>=LIMITS.snapshotIntervalMs){lastPublish=t;for(const listener of listeners)listener();}
  }
  function clearDesk(){savedPads=[];matcher?.reset();matcher=null;timingCalibration=null;pairs=[];pairStart=null;pairVisuals=[];pairAudios=[];snapshot={...snapshot,fusion:emptyFusion()};deskCalibrator?.invalidate('cancelled');deskDetector?.reset('cancelled',true);deskCalibrator=null;deskDetector=null;deskPalm=null;frameBuffer.desk=null;}
  function clear(){collector=null;trialStart=null;frameBuffer.current=null;frameBuffer.target=null;lastSequence=-1;lastTime=-1;air=null;display=null;calibrator=newPalmCalibrator();clearDesk();}
  function fail(message:string){finishTrial(true);generation++;adapter.stop();audioGeneration++;audio?.stop();clear();snapshot={...snapshot,audio:audio?.getDiagnostics()??snapshot.audio};frameBuffer.media=null;machine.send('fault');update({diagnostics:{...snapshot.diagnostics,...adapter.getDiagnostics?.()},message,calibration:null,calibrationStatus:'not_started',air:null,desk:null,target:null,tracking:'not_started',metrics:initialSnapshot(adapter.source).metrics});}
  function suspend(message:string,invalidateAudio=false){
    finishTrial(true);const previous=machine.getState().phase;
    display=null;air?.invalidate(message);frameBuffer.target=null;clearDesk();machine.send('tracking_lost');
    // Camera loss invalidates visual geometry and fusion queues, not microphone noise/clock calibration.
    if(invalidateAudio)audio?.reset();
    update({message,calibration:null,calibrationStatus:'not_started',air:air?.getState()??null,desk:null,target:null,metrics:{...snapshot.metrics,rawEstimatedPipDeg:null,estimatedPipDeg:null,estimatedDipDeg:null,estimatedMcpProxyDeg:null}},machine.getState().phase!==previous);
  }
  function deskUpdate(patch:Partial<DeskSnapshot>,force=true){
    const desk:DeskSnapshot={placing:false,region:null,setup:null,visual:null,visualCandidateCount:0,lastCandidate:null,acceptedTapCount:0,lastAccepted:null,...snapshot.desk,...patch};
    frameBuffer.desk={...(desk.pads?{pads:desk.pads}:{}),region:desk.region,visual:desk.visual,lastCandidate:desk.lastCandidate,lastAccepted:desk.lastAccepted};
    if(force)update({desk});else snapshot={...snapshot,desk};
  }
  function freshDeskCommand(){
    if(disposed||machine.getState().phase!=='calibrating'||!deskPalm)return false;
    const s=frameBuffer.current;
    if(!s||s.validity!=='valid'||now()-s.captureTimeMs>FRAME_CONFIG.maxAgeMs){suspend('Fresh visible hand required; recalibrate.');return false;}
    return true;
  }
  function receive(event:AdapterEvent){
    if(event.type==='error'){fail(event.message);return;}
    if(event.type==='end'){
      if(['running','countdown'].includes(machine.getState().phase))suspend('Synthetic input ended before the trial deadline; trial aborted.');
      else if(machine.getState().phase==='calibrating'){machine.send('cancel');update({calibrationStatus:'not_started',message:'Synthetic fixture ended before calibration. Reset to replay.'});}
      return;
    }
    if(event.type==='audio'){receiveAudio(event);return;}
    if(event.type==='visual'){if(!live&&snapshot.selection.exercise==='air_targets'){visualEvent(event.candidate);update({},false);}return;}
    const parsed=FrameSampleSchema.safeParse(event.sample);
    if(!parsed.success){
      // A malformed transport contract is actionable; do not fabricate a valid sample.
      fail('Invalid frame at adapter boundary');return;
    }
    const sample=parsed.data,t=timeMs(now());
    const stale=sample.sequence<=lastSequence||sample.captureTimeMs<=lastTime||t-sample.captureTimeMs>FRAME_CONFIG.maxAgeMs;
    if(sample.captureTimeMs>t){fail('Frame capture time is in the future');return;}
    if(stale){
      air?.observe(sample);display=null;frameBuffer.current=null;frameBuffer.target=null;
      if(machine.getState().phase==='calibrating')calibrator.observe(sample,t);
      if(deskPalm){suspend('Stale desk input; recalibrate.');return;}
      if(['running','countdown'].includes(machine.getState().phase))suspend('Stale input; trial aborted. Recalibrate.');
      update({tracking:'invalid',message:'Stale input discarded; scoring suspended.',metrics:{...snapshot.metrics,rawEstimatedPipDeg:null,estimatedPipDeg:null,estimatedDipDeg:null,estimatedMcpProxyDeg:null}},false);return;
    }
    const gap=lastTime>=0&&sample.captureTimeMs-lastTime>FRAME_CONFIG.maxGapMs;
    lastSequence=sample.sequence;lastTime=sample.captureTimeMs;frameBuffer.current=sample;
    const phaseBefore=machine.getState().phase;
    machine.send('tick');
    const phase=machine.getState().phase;
    const diagnostics={...snapshot.diagnostics,...adapter.getDiagnostics?.(),replayFrames:snapshot.diagnostics.replayFrames+(live?0:1),resultAgeMs:t-sample.captureTimeMs};
    if((sample.validity!=='valid'||gap)&&['countdown','running'].includes(phase)){collector?.frame(sample.captureTimeMs,false,null);suspend('Tracking loss or gap; trial aborted. Recalibrate.');update({tracking:sample.validity,diagnostics});return;}
    try{
      let metrics=snapshot.metrics;
      if(sample.validity==='valid'){
        const estimates=indexFlexionEstimates(sample.worldLandmarks);
        display=smoothDisplay(display,estimates.pipFlexionDeg,sample.captureTimeMs);
        metrics={...metrics,rawEstimatedPipDeg:estimates.pipFlexionDeg,estimatedPipDeg:display!.value,estimatedDipDeg:estimates.dipFlexionDeg,estimatedMcpProxyDeg:estimates.mcpProxyFlexionDeg};
      }else{display=null;metrics={...metrics,rawEstimatedPipDeg:null,estimatedPipDeg:null,estimatedDipDeg:null,estimatedMcpProxyDeg:null};}
      collector?.frame(sample.captureTimeMs,sample.validity==='valid',metrics.rawEstimatedPipDeg);
      if(phase==='calibrating'){
        if(timingCalibration&&deskDetector){
          const visual=deskDetector.observe(sample,t,video);
          if(!visual.calibrationValid){suspend(`Timing calibration lost: ${visual.reason}`);return;}
          if(visual.candidate)visualEvent(visual.candidate);
          deskUpdate({visual,lastCandidate:visual.candidate??snapshot.desk?.lastCandidate??null},false);
          update({metrics,tracking:sample.validity,diagnostics},false);return;
        }
        if(deskPalm){
          const reason=deskCompatibilityReason(sample,deskPalm,video);
          if(reason||gap){suspend(`Desk calibration invalidated: ${reason??'tracking_gap'}. Recalibrate.`);update({tracking:sample.validity,diagnostics});return;}
          if(deskCalibrator){
            const setup=deskCalibrator.observe(sample,t,video);
            if(setup.stage==='invalid'){suspend(`Desk calibration invalidated: ${setup.reason}. Recalibrate.`);update({tracking:sample.validity,diagnostics});return;}
            deskUpdate({setup},false);update({calibrationMessage:setup.reason,metrics,tracking:sample.validity,diagnostics},false);
          }else update({metrics,tracking:sample.validity,diagnostics},false);
          return;
        }
        const state=calibrator.observe(sample,t);
        if(state.calibration){
          if(snapshot.selection.exercise==='desk_tap'){
            deskPalm=state.calibration;deskUpdate({placing:true});
            update({calibrationMessage:'Palm scale captured. Click the viewport to place the desk ring under the resting index fingertip.',message:'Use an oblique view that shows lift and return. Place one ring; then capture rest.',metrics,tracking:sample.validity,diagnostics});return;
          }
          machine.send('calibrated');update({calibration:state.calibration,calibrationStatus:'valid',calibrationMessage:`${state.sampleCount} ${label.toLowerCase()} samples over ${state.elapsedMs.toFixed(0)} ms`,message:`${label} palm calibrated. Start a countdown.`,metrics,tracking:sample.validity,diagnostics});return;
        }
        update({calibrationMessage:`${state.reason}: ${state.sampleCount} samples, ${state.elapsedMs.toFixed(0)} ms. ${state.detail??''}`,metrics,tracking:sample.validity,diagnostics},false);return;
      }
      if(phase==='running'&&machine.acceptsCapture(sample.captureTimeMs)&&air){
        const state=air.observe(sample);frameBuffer.target=state;collector?.air(state);
        if(!state.calibrationValid){suspend(`Calibration invalidated: ${state.reason}. Recalibrate.`);update({tracking:sample.validity,diagnostics});return;}
        metrics={...metrics,acceptedCount:state.completedReps};
        update({air:state,target:{id:state.targetId,state:state.accepted?'accepted':'active'},metrics,tracking:sample.validity,diagnostics,message:`${label} air target: ${state.reason}. ${state.requiresRelease?'Exit the ring before rearming.':''}`},phase!==phaseBefore);return;
      }
      // Contact lookahead may arrive in the bounded grace after the trial deadline.
      // Candidate eligibility is checked at the extremum capture time, not confirmation time.
      const trial=machine.getState();
      if(deskDetector&&(phase==='running'||phase==='complete')&&trial.startedAtMs!==null&&trial.endsAtMs!==null&&sample.captureTimeMs>=trial.startedAtMs&&t<=trial.endsAtMs+SESSION_CONFIG.deliveryGraceMs){
        const visual=deskDetector.observe(sample,t,video);
        if(!visual.calibrationValid){suspend(`Desk calibration invalidated: ${visual.reason}. Recalibrate.`);update({tracking:sample.validity,diagnostics});return;}
        const candidate=visual.candidate&&machine.acceptsCapture(visual.candidate.captureTimeMs)?visual.candidate:null;
        if(candidate)visualEvent(candidate);
        deskUpdate({visual:{...visual,candidate},visualCandidateCount:(snapshot.desk?.visualCandidateCount??0)+(candidate?1:0),lastCandidate:candidate??snapshot.desk?.lastCandidate??null},false);
        update({metrics,tracking:sample.validity,diagnostics,message:phase==='complete'?'Desk trial complete. Event coincidences are diagnostic evidence, not proof of physical contact.':`Desk visual: ${visual.reason}`},phase!==phaseBefore);return;
      }
      if(phase==='calibrated'||phase==='countdown'){
        // Validate the frozen calibration before allowing a trial; never adapt its scale during use.
        if(snapshot.calibration?.exercise==='air_targets'&&sample.validity==='valid'){
          const reason=calibrationCompatibilityReason(sample,snapshot.calibration);
          if(reason){suspend(`Calibration invalidated: ${reason}. Recalibrate.`);update({tracking:sample.validity,diagnostics});return;}
        }else if(snapshot.calibration?.exercise==='desk_tap'){
          const reason=layout==='left_right'&&savedPads.length===2?(savedPads.some(cal=>!deskCompatibilityReason(sample,cal,video))?null:deskCompatibilityReason(sample,snapshot.calibration,video)):deskCompatibilityReason(sample,snapshot.calibration,video);
          if(reason||gap){suspend(`Desk calibration invalidated: ${reason??'tracking_gap'}. Recalibrate.`);update({tracking:sample.validity,diagnostics});return;}
        }else if(sample.validity!=='valid'){suspend('Hand lost after calibration; recalibrate.');update({tracking:sample.validity,diagnostics});return;}
      }
      update({metrics,tracking:sample.validity,diagnostics,message:phase==='complete'?`${label} trial complete. Local results appear after the matching grace.`:snapshot.message},phase!==phaseBefore);
    }catch(error){
      if(!(error instanceof MathInputError))throw error;
      display=null;frameBuffer.current={sequence:sample.sequence,captureTimeMs:sample.captureTimeMs,selectedHand:sample.selectedHand,validity:'invalid',reason:'malformed'};
      air?.invalidate('invalid_math');frameBuffer.target=null;
      if(phase==='calibrating'&&!deskPalm){calibrator=newPalmCalibrator();update({tracking:'invalid',metrics:{...snapshot.metrics,rawEstimatedPipDeg:null,estimatedPipDeg:null,estimatedDipDeg:null,estimatedMcpProxyDeg:null},calibrationMessage:error.message,message:`Invalid math: ${error.message}`},false);}
      else{suspend(`Invalid math: ${error.message}`);update({tracking:'invalid'},false);}
    }
  }
  const controller:SessionController={
    frameBuffer,getSnapshot:()=>snapshot,
    setDeskLayout(next){if(disposed)return;if(next!=='single'&&next!=='left_right')throw new Error('Invalid desk layout');layout=next;controller.selectExercise({exercise:'desk_tap',sensorMode:snapshot.selection.exercise==='desk_tap'?snapshot.selection.sensorMode as 'fused'|'kinematic_only':'fused'});update({deskLayout:layout});},
    tick(){
      if(disposed)return;
      const phase=machine.getState().phase,t=timeMs(now());
      if(pairStart!==null&&t-pairStart>DESK_CONFIG.maxCycleMs){pairStart=null;pairVisuals=[];pairAudios=[];update({fusion:{...snapshot.fusion,timingRecording:false},calibrationMessage:'Timing recording exceeded 5 seconds; retry one spaced tap.'});}
      if(deskPalm&&lastTime>=0&&t-lastTime>FRAME_CONFIG.maxAgeMs){frameBuffer.current=null;suspend('Stalled desk input; recalibrate.');update({tracking:'invalid'});return;}
      if(['calibrated','countdown','running'].includes(phase)&&lastTime>=0&&t-lastTime>FRAME_CONFIG.maxAgeMs){
        frameBuffer.current=null;frameBuffer.target=null;suspend('Stale input; trial aborted. Recalibrate.');update({tracking:'invalid'});return;
      }
      if(lastTime>=0&&t-lastTime>FRAME_CONFIG.maxAgeMs){
        frameBuffer.current=null;display=null;
        if(machine.getState().phase==='calibrating')calibrator=newPalmCalibrator();
        update({tracking:'invalid',calibrationMessage:snapshot.calibrationStatus==='collecting'?'Stalled input; calibration window reset.':snapshot.calibrationMessage,metrics:{...snapshot.metrics,rawEstimatedPipDeg:null,estimatedPipDeg:null,estimatedDipDeg:null,estimatedMcpProxyDeg:null}},false);
      }
      machine.send('tick');
      matcher?.advance(t);
      const trial=machine.getState();
      if(deskDetector&&trial.phase==='complete'&&trial.endsAtMs!==null&&t>trial.endsAtMs+SESSION_CONFIG.deliveryGraceMs){const visual=deskDetector.reset('Trial ended.');deskDetector=null;matcher?.reset();matcher=null;deskUpdate({visual},false);}
      finishTrial();
      update({diagnostics:{...snapshot.diagnostics,...adapter.getDiagnostics?.()}},false);
      if(machine.getState().phase!==phase)update({message:machine.getState().phase==='complete'?`${label} trial complete. Local results appear after the matching grace.`:`${label} ${snapshot.selection.exercise==='desk_tap'?'visual desk':'air'} trial running.`});
    },
    setHidden(hidden){if(disposed||!hidden)return;audioGeneration++;audio?.stop();update({audio:audio?.getDiagnostics()??snapshot.audio});const phase=machine.getState().phase;
      if(['calibrating','calibrated','countdown','running'].includes(phase)||collector!==null){suspend('Tab hidden; recalibration and a fresh countdown are required.');frameBuffer.current=null;frameBuffer.target=null;}
    },
    async startMicrophone(){
      if(disposed)return;
      if(!live||!audio){update({audio:{...snapshot.audio,state:'unavailable',message:live?'Audio adapter unavailable; explicitly select kinematic-only.':'Replay uses synthetic compact events; no microphone.'}});return;}
      if(snapshot.selection.sensorMode==='fused'&&['calibrating','calibrated','countdown','running','complete'].includes(machine.getState().phase))suspend('Microphone restart requires a fresh calibration.');
      const token=++audioGeneration;await audio.start(event=>{if(!disposed&&token===audioGeneration)receiveAudio(event);});
    },
    beginTimingPair(){
      if(disposed||!timingCalibration||pairStart!==null||pairs.length>=FUSION_CONFIG.maxPairs||live&&snapshot.audio.state!=='ready')return;
      pairStart=now();pairVisuals=[];pairAudios=[];deskDetector=makeDeskDetector(timingCalibration);
      update({fusion:{...snapshot.fusion,timingRecording:true},calibrationMessage:'Do one spaced lift/tap/return. Wait 250 ms after return, then save. Avoid speech or other impacts.'});
    },
    saveTimingPair(){
      if(disposed||pairStart===null)return;
      const t=now(),visual=pairVisuals[0],impulse=pairAudios[0];
      if(t-pairStart>DESK_CONFIG.maxCycleMs){pairStart=null;update({fusion:{...snapshot.fusion,timingRecording:false},calibrationMessage:'Timing recording exceeded 5 seconds. Retry.'});return;}
      if(visual&&t-visual.captureTimeMs<FUSION_CONFIG.deliveryLatenessMs){update({calibrationMessage:'Wait for the 250 ms delivery budget before saving.'});return;}
      pairStart=null;
      if(pairVisuals.length!==1||pairAudios.length!==1||!visual||!impulse){update({fusion:{...snapshot.fusion,timingRecording:false},calibrationMessage:'Ambiguous/missing timing pair: exactly one visual candidate and one acoustic onset required. Retry.'});return;}
      const pair={visualTimeMs:visual.captureTimeMs,audioTimeMs:impulse.sampleTimeMs};
      if(pairs.length&&pair.visualTimeMs-pairs.at(-1)!.visualTimeMs<FUSION_CONFIG.minPairSpacingMs){update({fusion:{...snapshot.fusion,timingRecording:false},calibrationMessage:'Space taps by at least 600 ms. Retry.'});return;}
      pairs.push(pair);update({fusion:{...snapshot.fusion,timingPairs:pairs.length,timingRecording:false},calibrationMessage:`${pairs.length} timing pairs. Record 3–5, then finish timing calibration.`});
    },
    finishTimingCalibration(){
      if(disposed||!timingCalibration||pairStart!==null)return;
      try{const timing=estimateTimingCalibration(pairs),calibration=CalibrationSchema.parse({...timingCalibration,sensorMode:'fused',audio:timing});
        deskDetector=null;timingCalibration=null;deskPalm=null;pairs=[];machine.send('calibrated');
        update({calibration,calibrationStatus:'valid',fusion:{...snapshot.fusion,timingRequired:false},calibrationMessage:`Audio minus visual onset offset ${timing.offsetMs.toFixed(1)} ms; maximum residual ${timing.residualSpreadMs.toFixed(1)} ms.`,message:'Fused calibration ready. Coincidence does not prove physical contact.'});
      }catch(error){if(!(error instanceof MathInputError))throw error;pairs=[];update({fusion:{...snapshot.fusion,timingPairs:0},calibrationMessage:`${error.message}. Timing pairs cleared; retry.`});}
    },
    subscribe(listener){if(disposed)return()=>{};listeners.add(listener);return()=>{listeners.delete(listener);};},
    async startDevices(){
      if(disposed||!['idle','error'].includes(machine.getState().phase))return;
      const token=++generation;machine.send('request');update({message:live?'Checking assets and requesting camera only; proving worker inference.':'Preparing synthetic replay; no permissions requested.'});
      try{
        await adapter.prepare();if(disposed||generation!==token)return;
        let diagnostics=snapshot.diagnostics;
        if(checkAssets){try{diagnostics={...diagnostics,assets:'verified',assetMessage:await checkAssets()};}catch(error){diagnostics={...diagnostics,assets:'missing',assetMessage:error instanceof Error?error.message:'Asset check failed; run npm run assets:prepare.'};}}
        if(disposed||generation!==token)return;
        if(live){
          const media=adapter.getVideo?.();if(!media)throw new Error('Prepared camera has no video source');
          video={width:media.videoWidth,height:media.videoHeight};frameBuffer.video=video;frameBuffer.media=media;calibrator=newPalmCalibrator();
        }
        machine.send('prepared');update({diagnostics:{...diagnostics,...adapter.getDiagnostics?.()},message:live?(snapshot.selection.exercise==='desk_tap'?'Camera ready. Hold your hand still and fully in view, then calibrate.':'Camera ready. Hold one open palm still, then calibrate.'):'Synthetic adapter ready. Calibrate to play the input fixture.'});
        if(live)adapter.play(event=>{if(!disposed&&generation===token)receive(event);});
      }catch(error){if(!disposed&&generation===token)fail(error instanceof Error?error.message:'Adapter preparation failed');}
    },
    calibrate(){
      if(disposed||collector!==null||!['ready','calibrated','complete'].includes(machine.getState().phase))return;
      if(snapshot.selection.exercise==='desk_tap'&&live&&snapshot.selection.sensorMode==='fused'&&snapshot.audio.state!=='ready'){update({calibrationStatus:'unavailable',message:'Start microphone separately and complete quiet calibration, or explicitly select kinematic-only.'});return;}
      const token=live?generation:++generation;if(!live)adapter.stop();clear();machine.send('calibrate');
      update({result:null,calibration:null,calibrationStatus:'collecting',air:null,desk:null,target:null,metrics:initialSnapshot(adapter.source).metrics,diagnostics:{...snapshot.diagnostics,replayFrames:0},message:`Collecting three seconds of stable ${label.toLowerCase()} ${snapshot.selection.exercise==='desk_tap'?'palm geometry':'open-palm input'}.`});
      if(live)return;
      if(snapshot.selection.exercise==='air_targets')matcher=createCoincidenceMatcher(SYNTHETIC_AUDIO_OFFSET_MS,{startMs:now(),endMs:now()+60000});
      try{adapter.play(event=>{if(!disposed&&generation===token)receive(event);});}catch(error){fail(error instanceof Error?error.message:'Adapter playback failed');}
    },
    cancelCalibration(){
      if(disposed||!['calibrating','calibrated','countdown','running','complete'].includes(machine.getState().phase))return;
      finishTrial(true);if(!live){generation++;adapter.stop();}clear();machine.send('cancel');
      update({calibration:null,calibrationStatus:'not_started',calibrationMessage:'Cancelled; all pending calibration/dwell/contact state cleared.',air:null,desk:null,target:null,metrics:initialSnapshot(adapter.source).metrics,message:'Cancelled. Recalibrate for a fresh trial.'});
    },
    placeDeskRing(point,viewport){
      if(!freshDeskCommand()||!snapshot.desk)return;
      const center=displayToSource(point,containFit(video,viewport,true));
      if(!center){update({calibrationMessage:'Click inside the video, outside the letterbox.'});return;}
      try{
        const region={center,radiusPixels:deskPalm!.palmPixels*DESK_CONFIG.ringRadiusPalmUnits};
        const palm=deskPalm!,next=createDeskCalibrator(palm,region),saved=savedPads;clearDesk();savedPads=saved;deskPalm=palm;
        // Preserve the palm owner while replacing all ring-dependent state.
        deskCalibrator=next;
        deskUpdate({placing:false,region,setup:next.getState(),visual:null,visualCandidateCount:0,lastCandidate:null});
        update({calibrationMessage:next.getState().reason});
      }catch(error){if(!(error instanceof MathInputError))throw error;update({calibrationMessage:error.message});}
    },
    captureDeskRest(){if(!freshDeskCommand()||!deskCalibrator)return;const setup=deskCalibrator.captureRest();deskUpdate({setup});update({calibrationMessage:setup.reason});},
    beginDeskCycle(){if(!freshDeskCommand()||!deskCalibrator)return;const setup=deskCalibrator.beginCycle();deskUpdate({setup});update({calibrationMessage:setup.reason});},
    saveDeskCycle(){if(!freshDeskCommand()||!deskCalibrator)return;const setup=deskCalibrator.finishCycle();deskUpdate({setup});update({calibrationMessage:setup.reason});},
    finishDeskCalibration(){
      if(!freshDeskCommand()||!deskCalibrator||layout==='left_right'&&savedPads.length>=2)return;
      const setup=deskCalibrator.finish();
      if(setup.stage==='invalid'){suspend(`Desk calibration rejected: ${setup.reason}. Recalibrate.`);return;}
      deskUpdate({setup});
      if(!setup.calibration){update({calibrationMessage:setup.reason});return;}
      if(layout==='left_right'){
        if(savedPads.length===1){try{validateDeskPads(savedPads[0]!,setup.calibration);}catch(error){if(!(error instanceof MathInputError))throw error;deskCalibrator=null;deskUpdate({placing:true,setup:null,region:null});update({calibrationMessage:error.message});return;}}
        savedPads.push(setup.calibration);
        deskUpdate({pads:savedPads.map((cal,i)=>({id:i===0?'left':'right',region:{...cal.desk.region,center:sourcePixel(cal.desk.region.center.x,cal.desk.region.center.y)}}))});
        if(savedPads.length===1){deskCalibrator=null;deskUpdate({placing:true,region:null,setup:null});update({calibrationMessage:'Left pad saved. Move to the RIGHT side of the video, click under the resting fingertip, then capture rest and 3–5 cycles again.'});return;}
      }
      if(snapshot.selection.sensorMode==='fused'){
        timingCalibration=setup.calibration;deskDetector=makeDeskDetector(setup.calibration);pairs=[];
        update({fusion:{...snapshot.fusion,timingRequired:true},calibrationMessage:'Visual geometry ready. Record 3–5 additional single spaced timing taps; one visual and one audio onset per recording.',message:'Guided audio/visual timing calibration required.'});return;
      }
      deskPalm=null;machine.send('calibrated');
      update({calibration:setup.calibration,calibrationStatus:'valid',calibrationMessage:setup.reason,message:'Desk visual calibration ready. Start a 15-second visual-candidate trial; no audio verification.'});
    },
    replayTap(){if(!disposed&&!live)adapter.replayTap?.();},
    startExercise(){
      if(disposed)return;
      if(machine.getState().phase!=='calibrated'||!snapshot.calibration)return;
      const calibration=snapshot.calibration;
      try{
        if(calibration.exercise==='air_targets'){
          const sample=frameBuffer.current;
          if(live&&(!sample||sample.validity!=='valid'||now()-sample.captureTimeMs>FRAME_CONFIG.maxAgeMs)){suspend('Fresh visible hand required; recalibrate.');return;}
          air=createAirTargetEngine(calibration,live?reachableAirPath(calibration,sample as Extract<FrameSample,{validity:'valid'}>):[DEFAULT_AIR_TARGET],now);
          frameBuffer.target=null;update({air:air.getState(),metrics:{...snapshot.metrics,acceptedCount:0}});
        }else if(calibration.exercise==='desk_tap'){
          if(live&&calibration.sensorMode==='fused'&&snapshot.audio.state!=='ready'){suspend('Microphone is not calibrated; restart setup.');return;}
          deskDetector=makeDeskDetector(calibration);
          matcher?.reset();matcher=null;
          snapshot={...snapshot,fusion:emptyFusion()};deskUpdate({visual:deskDetector.getState(),visualCandidateCount:0,lastCandidate:null,acceptedTapCount:0,lastAccepted:null,leftTapCount:0,rightTapCount:0});
        }else return;
        machine.send('start');
        trialStart=machine.getState().countdownEndsAtMs!;collector=createTelemetryCollector(calibration,adapter.source,crypto.randomUUID(),trialStart);
        snapshot={...snapshot,result:null};
        if(calibration.sensorMode==='fused'){const start=machine.getState().countdownEndsAtMs!;matcher=createCoincidenceMatcher(calibration.audio.offsetMs,{startMs:start,endMs:start+SESSION_CONFIG.trialMs});}
        update({message:`${label} countdown: three seconds. ${calibration.exercise==='desk_tap'?(calibration.sensorMode==='fused'?'Visual/audio coincidence; lift, tap and release.':'Kinematic-only; lift, return and release.'):'Reach, dwell continuously, then exit.'}`});
      }catch(error){if(!(error instanceof MathInputError))throw error;suspend(error.message);}
    },
    stop(){if(disposed)return;finishTrial(true);const result=snapshot.result;generation++;adapter.stop();audioGeneration++;audio?.stop();clear();frameBuffer.media=null;machine.send('stop');update({...initialSnapshot(adapter.source),result,selection:snapshot.selection,diagnostics:{...snapshot.diagnostics,...adapter.getDiagnostics?.()},message:live?'Stopped. Camera and inference resources released. Start camera again.':'Stopped. Start replay again.'});},
    reset(){if(disposed)return;if(live){controller.stop();update({result:null,message:'Reset cleared calibration and stopped camera. Start camera for fresh observations.'});return;}generation++;adapter.stop();clear();machine.send('reset');update({...initialSnapshot(adapter.source),selection:snapshot.selection,diagnostics:{...snapshot.diagnostics,replayFrames:0},message:'Reset. Calibrate for a fresh synthetic trial.'});},
    selectExercise(selection){
      if(disposed)return;
      if(!(selection.exercise==='air_targets'&&selection.sensorMode==='vision_only')&&!(selection.exercise==='desk_tap'&&['fused','kinematic_only'].includes(selection.sensorMode)))throw new Error('Invalid exercise/sensor mode');
      finishTrial(true);const result=snapshot.result;machine.send('mode_changed');
      adapter.selectExercise?.(selection);
      if(live&&frameBuffer.media){
        // Explicit fallback/mode changes abort the trial without discarding working CV.
        clear();audioGeneration++;audio?.stop();
        update({...initialSnapshot(adapter.source),result,selection,diagnostics:snapshot.diagnostics,message:'Selection changed; camera continues. Calibration, audio and counters cleared.'});
      }else{controller.reset();update({result,selection,message:'Selection changed; calibration and counters cleared.'});}

    },
    dispose(){if(disposed)return;disposed=true;generation++;audioGeneration++;adapter.dispose();audio?.dispose();clear();frameBuffer.media=null;listeners.clear();frameListeners.clear();},
  };
  return controller;
}
