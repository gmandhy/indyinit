import { AudioImpulseSchema, FrameSampleSchema } from '../lib/schemas';
import { initialSnapshot } from './contracts';
import type { AdapterEvent, SessionAdapter, SessionController, SessionSnapshot } from './contracts';
import { createSessionMachine } from './sessionReducer';
import { createPalmCalibrator } from '../lib/calibration';
import { calibrationCompatibilityReason, createAirTargetEngine, DEFAULT_AIR_TARGET } from '../lib/spatialTargets';
import { indexFlexionEstimates, smoothDisplay } from '../lib/biomechanics';
import type { SmoothedDisplay } from '../lib/biomechanics';
import { FRAME_CONFIG, LIMITS } from '../lib/config';
import { MathInputError, timeMs } from '../lib/mathValidation';
import type { Size } from '../lib/coordinates';
/** Orchestration only. Adapter owns scheduling/devices; pure engines own math and scoring. */
export function createSessionController(adapter:SessionAdapter,checkAssets?:()=>Promise<string>,now:()=>number=()=>performance.now(),video:Size={width:640,height:360}):SessionController {
  const machine=createSessionMachine(now);
  const live=adapter.source==='live', label=live?'Live':'Synthetic';
  let snapshot=initialSnapshot(adapter.source),disposed=false,generation=0,lastSequence=-1,lastTime=-1,lastPublish=-Infinity;
  let calibrator=createPalmCalibrator(video),air:ReturnType<typeof createAirTargetEngine>|null=null,display:SmoothedDisplay|null=null;
  const listeners=new Set<()=>void>();
  const frameBuffer:SessionController['frameBuffer']={current:null,target:null,video,media:null,recordRender:()=>adapter.recordRender?.()};
  function update(patch:Partial<SessionSnapshot>,force=true){
    snapshot={...snapshot,...patch,phase:machine.getState().phase};
    const t=timeMs(now());
    if(force||t-lastPublish>=LIMITS.snapshotIntervalMs){lastPublish=t;for(const listener of listeners)listener();}
  }
  function clear(){frameBuffer.current=null;frameBuffer.target=null;lastSequence=-1;lastTime=-1;air=null;display=null;calibrator=createPalmCalibrator(video);}
  function fail(message:string){generation++;adapter.stop();clear();frameBuffer.media=null;machine.send('fault');update({diagnostics:{...snapshot.diagnostics,...adapter.getDiagnostics?.()},message,calibration:null,calibrationStatus:'not_started',air:null,target:null,tracking:'not_started',metrics:initialSnapshot(adapter.source).metrics});}
  function suspend(message:string){
    const previous=machine.getState().phase;
    display=null;air?.invalidate(message);frameBuffer.target=null;machine.send('tracking_lost');
    update({message,calibration:null,calibrationStatus:'not_started',air:air?.getState()??null,target:null,metrics:{...snapshot.metrics,rawEstimatedPipDeg:null,estimatedPipDeg:null,estimatedDipDeg:null,estimatedMcpProxyDeg:null}},machine.getState().phase!==previous);
  }
  function receive(event:AdapterEvent){
    if(event.type==='error'){fail(event.message);return;}
    if(event.type==='end'){
      if(['running','countdown'].includes(machine.getState().phase))suspend('Synthetic input ended before the trial deadline; trial aborted.');
      else if(machine.getState().phase==='calibrating'){machine.send('cancel');update({calibrationStatus:'not_started',message:'Synthetic fixture ended before calibration. Reset to replay.'});}
      return;
    }
    if(event.type==='audio'){if(!AudioImpulseSchema.safeParse(event.impulse).success)fail('Invalid audio event at adapter boundary');return;}
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
      if(['running','countdown'].includes(machine.getState().phase))suspend('Stale input; trial aborted. Recalibrate.');
      update({tracking:'invalid',message:'Stale input discarded; scoring suspended.',metrics:{...snapshot.metrics,rawEstimatedPipDeg:null,estimatedPipDeg:null,estimatedDipDeg:null,estimatedMcpProxyDeg:null}},false);return;
    }
    const gap=lastTime>=0&&sample.captureTimeMs-lastTime>FRAME_CONFIG.maxGapMs;
    lastSequence=sample.sequence;lastTime=sample.captureTimeMs;frameBuffer.current=sample;
    const phaseBefore=machine.getState().phase;
    machine.send('tick');
    const phase=machine.getState().phase;
    const diagnostics={...snapshot.diagnostics,...adapter.getDiagnostics?.(),replayFrames:snapshot.diagnostics.replayFrames+(live?0:1),resultAgeMs:t-sample.captureTimeMs};
    if((sample.validity!=='valid'||gap)&&['countdown','running'].includes(phase)){suspend('Tracking loss or gap; trial aborted. Recalibrate.');update({tracking:sample.validity,diagnostics});return;}
    try{
      let metrics=snapshot.metrics;
      if(sample.validity==='valid'){
        const estimates=indexFlexionEstimates(sample.worldLandmarks);
        display=smoothDisplay(display,estimates.pipFlexionDeg,sample.captureTimeMs);
        metrics={...metrics,rawEstimatedPipDeg:estimates.pipFlexionDeg,estimatedPipDeg:display!.value,estimatedDipDeg:estimates.dipFlexionDeg,estimatedMcpProxyDeg:estimates.mcpProxyFlexionDeg};
      }else{display=null;metrics={...metrics,rawEstimatedPipDeg:null,estimatedPipDeg:null,estimatedDipDeg:null,estimatedMcpProxyDeg:null};}
      if(phase==='calibrating'){
        const state=calibrator.observe(sample,t);
        if(state.calibration){machine.send('calibrated');update({calibration:state.calibration,calibrationStatus:'valid',calibrationMessage:`${state.sampleCount} ${label.toLowerCase()} samples over ${state.elapsedMs.toFixed(0)} ms`,message:live?'Live palm calibrated. Air exercise integration is phase 4.':'Synthetic palm calibrated. Start a countdown; no live evidence.',metrics,tracking:sample.validity,diagnostics});return;}
        update({calibrationMessage:`${state.reason}: ${state.sampleCount} samples, ${state.elapsedMs.toFixed(0)} ms. ${state.detail??''}`,metrics,tracking:sample.validity,diagnostics},false);return;
      }
      if(phase==='running'&&machine.acceptsCapture(sample.captureTimeMs)&&air){
        const state=air.observe(sample);frameBuffer.target=state;
        if(!state.calibrationValid){suspend(`Calibration invalidated: ${state.reason}. Recalibrate.`);update({tracking:sample.validity,diagnostics});return;}
        metrics={...metrics,acceptedCount:state.completedReps};
        update({air:state,target:{id:state.targetId,state:state.accepted?'accepted':'active'},metrics,tracking:sample.validity,diagnostics,message:`Synthetic air target: ${state.reason}.`},phase!==phaseBefore);return;
      }
      if(phase==='calibrated'||phase==='countdown'){
        // Validate the frozen calibration before allowing a trial; never adapt its scale during use.
        if(snapshot.calibration?.exercise==='air_targets'&&sample.validity==='valid'){
          const reason=calibrationCompatibilityReason(sample,snapshot.calibration);
          if(reason){suspend(`Calibration invalidated: ${reason}. Recalibrate.`);update({tracking:sample.validity,diagnostics});return;}
        }else if(phase==='calibrated'&&sample.validity!=='valid'){suspend('Hand lost after calibration; recalibrate.');update({tracking:sample.validity,diagnostics});return;}
      }
      update({metrics,tracking:sample.validity,diagnostics,message:phase==='complete'?'Synthetic trial complete. Counters are fixture results; summary/export remains phase 6.':snapshot.message},phase!==phaseBefore);
    }catch(error){
      if(!(error instanceof MathInputError))throw error;
      display=null;frameBuffer.current={sequence:sample.sequence,captureTimeMs:sample.captureTimeMs,selectedHand:sample.selectedHand,validity:'invalid',reason:'malformed'};
      air?.invalidate('invalid_math');frameBuffer.target=null;
      if(phase==='calibrating'){calibrator=createPalmCalibrator(video);update({tracking:'invalid',metrics:{...snapshot.metrics,rawEstimatedPipDeg:null,estimatedPipDeg:null,estimatedDipDeg:null,estimatedMcpProxyDeg:null},calibrationMessage:error.message,message:`Invalid math: ${error.message}`},false);}
      else{suspend(`Invalid math: ${error.message}`);update({tracking:'invalid'},false);}
    }
  }
  const controller:SessionController={
    frameBuffer,getSnapshot:()=>snapshot,
    tick(){
      if(disposed)return;
      const phase=machine.getState().phase,t=timeMs(now());
      if(['calibrated','countdown','running'].includes(phase)&&lastTime>=0&&t-lastTime>FRAME_CONFIG.maxAgeMs){
        frameBuffer.current=null;frameBuffer.target=null;suspend('Stale input; trial aborted. Recalibrate.');update({tracking:'invalid'});return;
      }
      if(lastTime>=0&&t-lastTime>FRAME_CONFIG.maxAgeMs){
        frameBuffer.current=null;display=null;
        if(machine.getState().phase==='calibrating')calibrator=createPalmCalibrator(video);
        update({tracking:'invalid',calibrationMessage:snapshot.calibrationStatus==='collecting'?'Stalled input; calibration window reset.':snapshot.calibrationMessage,metrics:{...snapshot.metrics,rawEstimatedPipDeg:null,estimatedPipDeg:null,estimatedDipDeg:null,estimatedMcpProxyDeg:null}},false);
      }
      machine.send('tick');
      update({diagnostics:{...snapshot.diagnostics,...adapter.getDiagnostics?.()}},false);
      if(machine.getState().phase!==phase)update({message:machine.getState().phase==='complete'?'Synthetic trial complete. Summary/export remains phase 6.':'Synthetic air trial running.'});
    },
    setHidden(hidden){if(disposed||!hidden)return;const phase=machine.getState().phase;
      if(['calibrating','calibrated','countdown','running'].includes(phase)){suspend('Tab hidden; recalibration and a fresh countdown are required.');frameBuffer.current=null;frameBuffer.target=null;}
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
          video={width:media.videoWidth,height:media.videoHeight};frameBuffer.video=video;frameBuffer.media=media;calibrator=createPalmCalibrator(video);
        }
        machine.send('prepared');update({diagnostics:{...diagnostics,...adapter.getDiagnostics?.()},message:live?'Camera ready. Hold one open palm still, then calibrate.':'Synthetic adapter ready. Calibrate to play the input fixture.'});
        if(live)adapter.play(event=>{if(!disposed&&generation===token)receive(event);});
      }catch(error){if(!disposed&&generation===token)fail(error instanceof Error?error.message:'Adapter preparation failed');}
    },
    calibrate(){
      if(disposed||!['ready','calibrated','complete'].includes(machine.getState().phase))return;
      if(snapshot.selection.exercise==='desk_tap'){update({calibrationStatus:'unavailable',message:'Desk lift/contact calibration is phase 4; no desk scores are fabricated.'});return;}
      const token=live?generation:++generation;if(!live)adapter.stop();clear();machine.send('calibrate');
      update({calibration:null,calibrationStatus:'collecting',air:null,target:null,metrics:initialSnapshot(adapter.source).metrics,diagnostics:{...snapshot.diagnostics,replayFrames:0},message:`Collecting three seconds of stable ${label.toLowerCase()} open-palm input.`});
      if(live)return;
      try{adapter.play(event=>{if(!disposed&&generation===token)receive(event);});}catch(error){fail(error instanceof Error?error.message:'Adapter playback failed');}
    },
    startExercise(){
      if(disposed)return;
      if(live){update({message:'Live air targets are phase 4. Phase 3 proves tracking and palm calibration.'});return;}
      if(disposed||machine.getState().phase!=='calibrated'||snapshot.calibration?.exercise!=='air_targets')return;
      air=createAirTargetEngine(snapshot.calibration,[DEFAULT_AIR_TARGET],now);frameBuffer.target=null;machine.send('start');
      update({air:air.getState(),metrics:{...snapshot.metrics,acceptedCount:0},message:'Synthetic countdown: three seconds. Trial timing uses the injected monotonic clock.'});
    },
    stop(){if(disposed)return;generation++;adapter.stop();clear();frameBuffer.media=null;machine.send('stop');update({...initialSnapshot(adapter.source),selection:snapshot.selection,diagnostics:{...snapshot.diagnostics,...adapter.getDiagnostics?.()},message:live?'Stopped. Camera and inference resources released. Start camera again.':'Stopped. Start replay again.'});},
    reset(){if(disposed)return;if(live){controller.stop();update({message:'Reset cleared calibration and stopped camera. Start camera for fresh observations.'});return;}generation++;adapter.stop();clear();machine.send('reset');update({...initialSnapshot(adapter.source),selection:snapshot.selection,diagnostics:{...snapshot.diagnostics,replayFrames:0},message:'Reset. Calibrate for a fresh synthetic trial.'});},
    selectExercise(selection){
      if(disposed)return;
      if(!(selection.exercise==='air_targets'&&selection.sensorMode==='vision_only')&&!(selection.exercise==='desk_tap'&&['fused','kinematic_only'].includes(selection.sensorMode)))throw new Error('Invalid exercise/sensor mode');
      machine.send('mode_changed');controller.reset();update({selection,message:'Selection changed; calibration and counters cleared.'});
    },
    dispose(){if(disposed)return;disposed=true;generation++;adapter.dispose();clear();frameBuffer.media=null;listeners.clear();},
  };
  return controller;
}
