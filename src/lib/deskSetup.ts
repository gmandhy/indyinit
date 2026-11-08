import type { SessionSnapshot } from '../engine/contracts';
export interface DeskSetupStep {
  id:string; kind:'camera'|'microphone'|'palm'|'placement'|'rest'|'cycles'|'timing'|'ready';
  title:string; instruction:string; complete:boolean;
}
/** Presentation of measured controller state only. Acknowledging a card never calibrates a device. */
export function deskSetupSteps(s:SessionSnapshot):DeskSetupStep[] {
  const live=s.source==='live',fused=s.selection.sensorMode==='fused',two=s.deskLayout==='left_right';
  const valid=s.calibrationStatus==='valid'&&s.calibration?.exercise==='desk_tap';
  const palm=s.desk!==null||valid, saved=s.desk?.pads?.length??0,stage=s.desk?.setup?.stage;
  const steps:DeskSetupStep[]=[{id:'camera',kind:'camera',title:live?'Position your camera':'Start synthetic replay',instruction:live?'Aim the camera diagonally at your hand and table so it can see your finger lift and return. Keep the camera fixed and the tapping area in view.':'This is an artificial fixture. No camera or microphone evidence is collected.',complete:!['idle','requesting','error'].includes(s.phase)}];
  if(live&&fused)steps.push({id:'microphone',kind:'microphone',title:'Check your microphone',instruction:'Start the microphone, then keep quiet until background calibration finishes. Camera and microphone permission are requested separately.',complete:s.audio.state==='ready'});
  steps.push({id:'palm',kind:'palm',title:'Calibrate your hand position',instruction:'Keep your hand fully visible and hold it still for three seconds. This step measures palm size and orientation; finger-joint angle estimates do not block desk setup.',complete:palm});
  for(const [index,pad] of (two?['Left','Right']:['Desk']).entries()){
    const done=two?saved>index:valid||s.fusion.timingRequired;
    const current=!two||saved===index;
    const prefix=pad.toLowerCase();
    steps.push(
      {id:`${prefix}-placement`,kind:'placement',title:`Place the ${pad.toLowerCase()} pad`,instruction:`Rest your index fingertip on the ${two?pad.toLowerCase()+' side of the mirrored video':'table'}. Click the video under it to place the ring. ${two&&index===1?'Keep the rings and their lift paths separate.':''}`,complete:done||current&&s.desk?.region!=null},
      {id:`${prefix}-rest`,kind:'rest',title:`Capture ${pad.toLowerCase()} resting position`,instruction:'With your fingertip resting inside the ring, capture rest and hold still until the app accepts it.',complete:done||current&&['ready_cycle','recording','valid'].includes(stage??'')},
      {id:`${prefix}-cycles`,kind:'cycles',title:`Practice taps on ${pad.toLowerCase()}`,instruction:'Start recording with your fingertip resting. Lift once, tap, then hold still briefly and save. Save at least three cycles, then finish this pad’s calibration.',complete:done||current&&stage==='valid'},
    );
  }
  if(fused)steps.push({id:'timing',kind:'timing',title:'Match sound and fingertip timing',instruction:`Record 3–5 isolated timing taps${two?', alternating Left and Right':''}. Leave about one second between taps. After each tap, pause briefly before saving the pair. Once three pairs are accepted, finish timing calibration.`,complete:valid});
  steps.push({id:'ready',kind:'ready',title:'Setup complete',instruction:`Your ${two?'Left and Right pads are':'desk pad is'} calibrated. Start the trial, wait for the countdown, then lift, tap inside a ring, and release. Accepted counts update during the running trial.`,complete:valid});
  return steps;
}

export function deskSetupMessage(message:string):string {
  if(message.includes('insufficient_cycle_samples'))return 'That recording was too short. Start at rest, lift, return, hold still, then save again.';
  if(message.includes('insufficient_projected_motion'))return 'The camera could not see enough lift. Adjust to an oblique view and record another cycle.';
  if(message.includes('unstable_rest'))return 'Your resting fingertip moved. Hold it still inside the ring and capture rest again.';
  if(message.includes('NotAllowedError'))return 'Permission was denied. Allow device access in your browser, then retry.';
  return message;
}
